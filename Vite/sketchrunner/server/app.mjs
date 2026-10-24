import { createServer } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
import { WebSocketServer, WebSocket } from 'ws'

const key = () => randomBytes(24).toString('hex')
const equal = (a, b) => typeof a === 'string' && a.length === b.length &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b))
const send = (socket, message) => {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
}
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' }

export function createCameraServer({ dist, getPublicUrl = () => null, iceServers = [], maxAge = 2 * 60 * 60 * 1000 } = {}) {
  const rooms = new Map()
  const root = resolve(dist)
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=()')
    const json = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    try {
      const url = new URL(req.url, 'http://localhost')
      if (url.pathname === '/api/config' && req.method === 'GET') {
        return json(200, { publicUrl: getPublicUrl() })
      }
      if (url.pathname === '/api/sessions' && req.method === 'POST') {
        // Require a same-origin browser request. No CORS access is granted.
        const origin = req.headers.origin
        const publicHost = getPublicUrl() ? new URL(getPublicUrl()).host : null
        if (origin && ![req.headers.host, publicHost].includes(new URL(origin).host)) return json(403, { error: 'Origin rejected.' })
        if (rooms.size >= 64) return json(429, { error: 'Too many sessions. Close an old desktop session and try again.' })
        const id = key()
        const room = { desktopKey: key(), phoneKey: key(), desktop: null, phone: null, created: Date.now() }
        rooms.set(id, room)
        return json(201, { room: id, desktopKey: room.desktopKey, phoneKey: room.phoneKey })
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(405, { error: 'Method not allowed.' })
      if (url.pathname.startsWith('/api/')) return json(404, { error: 'Not found.' })
      const pathname = decodeURIComponent(url.pathname)
      const file = resolve(root, pathname === '/' || pathname === '/camera' ? 'index.html' : '.' + pathname)
      if (!file.startsWith(root + sep)) return json(403, { error: 'Forbidden.' })
      const bytes = await readFile(file)
      res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' })
      res.end(req.method === 'HEAD' ? undefined : bytes)
    } catch {
      json(404, { error: 'Not found. Run npm run build before starting the camera server.' })
    }
  })

  const wss = new WebSocketServer({ noServer: true, maxPayload: 65536 })
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/signal') return socket.destroy()
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
  })
  wss.on('connection', (socket) => {
    let room, role, id
    let alive = true
    const authTimeout = setTimeout(() => socket.close(4001, 'Pairing required.'), 10000)
    socket.on('pong', () => { alive = true })
    socket.isAlive = () => alive
    socket.markPing = () => { alive = false }
    socket.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString())
        if (!room) {
          const candidate = rooms.get(msg.room)
          if (msg.type !== 'join' || !['desktop', 'phone'].includes(msg.role) || !candidate ||
              Date.now() - candidate.created > maxAge || !equal(msg.key, candidate[`${msg.role}Key`])) {
            return socket.close(4001, 'Pairing link expired or invalid. Scan a new QR code.')
          }
          if (candidate[msg.role]?.readyState === WebSocket.OPEN) return socket.close(4002, 'This session already has a connected device.')
          room = candidate; role = msg.role; id = msg.room
          room[role] = socket
          clearTimeout(authTimeout)
          send(socket, { type: 'joined', iceServers })
          if (room.desktop?.readyState === WebSocket.OPEN && room.phone?.readyState === WebSocket.OPEN) {
            send(room.desktop, { type: 'peer-ready' })
            send(room.phone, { type: 'peer-ready' })
          }
          return
        }
        const other = room[role === 'desktop' ? 'phone' : 'desktop']
        if (msg.type === 'signal' && msg.data && typeof msg.data === 'object') {
          const data = msg.data
          if (data.description) {
            const expected = role === 'desktop' ? 'offer' : 'answer'
            if (data.description.type !== expected || typeof data.description.sdp !== 'string') return
            send(other, { type: 'signal', data: { description: data.description } })
          } else if (data.candidate && typeof data.candidate.candidate === 'string') {
            send(other, { type: 'signal', data: { candidate: data.candidate } })
          }
        }
      } catch {
        socket.close(4003, 'Invalid connection message.')
      }
    })
    socket.on('error', () => {})
    socket.on('close', () => {
      clearTimeout(authTimeout)
      if (!room || room[role] !== socket) return
      room[role] = null
      if (role === 'desktop') {
        rooms.delete(id)
        room.phone?.close(4000, 'Desktop disconnected. Scan its new QR code.')
      } else {
        send(room.desktop, { type: 'peer-left' })
      }
    })
  })
  const timer = setInterval(() => {
    for (const socket of wss.clients) {
      if (!socket.isAlive()) socket.terminate()
      else { socket.markPing(); socket.ping() }
    }
    for (const [id, room] of rooms) {
      if (Date.now() - room.created > maxAge) {
        rooms.delete(id)
        room.desktop?.close(4000, 'Session expired. Create a new pairing link.')
        room.phone?.close(4000, 'Session expired. Scan a new QR code.')
      }
    }
  }, 30000)
  timer.unref()
  return {
    server,
    async close() {
      clearInterval(timer)
      for (const socket of wss.clients) socket.terminate()
      await new Promise((done) => wss.close(done))
      server.closeAllConnections()
      await new Promise((done) => server.close(done))
    },
  }
}
