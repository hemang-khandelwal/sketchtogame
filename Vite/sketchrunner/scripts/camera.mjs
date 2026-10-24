import { createCameraServer } from '../server/app.mjs'
import { mkdir, writeFile, chmod, access } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
try { process.loadEnvFile(resolve(root, '.env')) } catch (error) { if (error.code !== 'ENOENT') throw error }
const version = '2026.10.3'
const assets = {
  'darwin-arm64': ['cloudflared-darwin-arm64.tgz', '1165d14b6f6360a3b8c283d7d1100024d6ec7cd9bc9e32519e96150645f3ec55'],
  'darwin-x64': ['cloudflared-darwin-amd64.tgz', '81b7b85f2376815c4f59b1aa323887b62e16ce8b67555c2e1577dc23f2a82000'],
  'win32-x64': ['cloudflared-windows-amd64.exe', '76b2805253d0d6ffacb092a7acfbee99e7af6917835c0c5410e23f3ef5052da2'],
  'linux-x64': ['cloudflared-linux-amd64', '053b80b0a23031a038fdbf3c073f59f82b8f1f152aa67971d7383ffafc0dbab0'],
}

async function getTunnelBinary() {
  if (process.env.CLOUDFLARED_PATH) return process.env.CLOUDFLARED_PATH
  const asset = assets[`${process.platform}-${process.arch}`]
  if (!asset) throw new Error('Install cloudflared for your computer and set CLOUDFLARED_PATH in .env.')
  const folder = resolve(root, '.camera-tools', version)
  const binary = resolve(folder, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared')
  try { await access(binary); return binary } catch {}
  await mkdir(folder, { recursive: true })
  console.log('Downloading the official Cloudflare tunnel client (first run only)…')
  const response = await fetch(`https://github.com/cloudflare/cloudflared/releases/download/${version}/${asset[0]}`, { signal: AbortSignal.timeout(120000) })
  if (!response.ok) throw new Error(`Tunnel download failed: HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (createHash('sha256').update(bytes).digest('hex') !== asset[1]) throw new Error('Tunnel download failed checksum verification.')
  if (asset[0].endsWith('.tgz')) {
    const archive = resolve(folder, asset[0])
    await writeFile(archive, bytes)
    await new Promise((done, reject) => {
      const child = spawn('tar', ['-xzf', archive, '-C', folder], { stdio: 'inherit' })
      child.on('error', reject)
      child.on('exit', (code) => code === 0 ? done() : reject(new Error('Could not unpack cloudflared.')))
    })
  } else await writeFile(binary, bytes)
  if (process.platform !== 'win32') await chmod(binary, 0o755)
  return binary
}

let publicUrl = process.env.PUBLIC_URL || null
if (publicUrl && new URL(publicUrl).protocol !== 'https:') throw new Error('PUBLIC_URL must start with https://')
const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }]
if (process.env.TURN_URLS) iceServers.push({
  urls: process.env.TURN_URLS.split(',').map((url) => url.trim()),
  username: process.env.TURN_USERNAME || '', credential: process.env.TURN_CREDENTIAL || '',
})
await access(resolve(root, 'dist/index.html'))
const app = createCameraServer({ dist: resolve(root, 'dist'), getPublicUrl: () => publicUrl, iceServers })
const port = Number(process.env.CAMERA_PORT || 8787)
await new Promise((done, reject) => {
  app.server.once('error', reject)
  app.server.listen(port, '127.0.0.1', done)
})
console.log(`Desktop: http://localhost:${port}`)
let tunnel
let stopping = false
async function stop() {
  if (stopping) return
  stopping = true
  tunnel?.kill()
  await app.close()
}
process.on('SIGINT', () => { void stop() })
process.on('SIGTERM', () => { void stop() })

if (!process.argv.includes('--local') && !publicUrl) {
  try {
    const binary = await getTunnelBinary()
    console.log('Creating a temporary HTTPS address. Keep this terminal open.')
    const startupTimer = setTimeout(() => {
      if (!publicUrl) console.error('Tunnel is taking longer than expected. Check your connection or use your own HTTPS tunnel with PUBLIC_URL in .env.')
    }, 45000)
    startupTimer.unref()
    tunnel = spawn(binary, ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate', '--protocol', 'http2'], { stdio: ['ignore', 'pipe', 'pipe'] })
    let tail = ''
    const output = (chunk) => {
      tail = (tail + chunk.toString()).slice(-8000)
      const match = tail.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)
      if (match && !publicUrl) {
        publicUrl = match[0]
        clearTimeout(startupTimer)
        console.log(`\nOPEN THIS ON THE DESKTOP: ${publicUrl}\nClick Connect phone, then scan the QR code on your smartphone.\n`)
      }
    }
    tunnel.stdout.on('data', output)
    tunnel.stderr.on('data', output)
    tunnel.on('error', (error) => console.error(`Tunnel could not start: ${error.message}`))
    tunnel.on('exit', (code) => {
      clearTimeout(startupTimer)
      if (!stopping) {
        publicUrl = null
        console.error(`HTTPS tunnel stopped (${code}). Restart npm run camera.\n${tail.slice(-1200)}`)
      }
    })
  } catch (error) {
    console.error(`Could not open HTTPS: ${error.message}`)
    console.error('Local preview remains available. Restart npm run camera to try again.')
  }
} else if (publicUrl) console.log(`HTTPS desktop: ${publicUrl}`)
else console.log('Local test mode. Phone access requires HTTPS; use npm run camera.')
