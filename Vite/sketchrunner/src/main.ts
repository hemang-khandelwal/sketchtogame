import './style.css'
import QRCode from 'qrcode'
import { connectCamera } from './connection'

const app = document.querySelector<HTMLDivElement>('#app')!
const phoneMode = location.pathname.replace(/\/$/, '') === '/camera'
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const header = `<header class="site-header"><a class="brand" href="/" aria-label="SketchRunner home"><span class="brand-icon">S<span>↗</span></span>SketchRunner<span class="beta">LAB</span></a><span class="header-note">Paper ideas. Playable worlds.</span></header>`
const phoneIcon = `<svg width="48" height="62" viewBox="0 0 48 62" fill="none" aria-hidden="true"><rect x="9" y="3" width="30" height="56" rx="7" stroke="currentColor" stroke-width="2"/><path d="M20 9h8M21 53h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="24" cy="30" r="8" stroke="currentColor" stroke-width="2"/><path d="M24 26v8m-4-4h8" stroke="currentColor" stroke-width="2"/></svg>`
let link: ReturnType<typeof connectCamera> | null = null
let cameraStream: MediaStream | null = null
let frameUrl: string | null = null
let generation = 0

function status(message: string, kind: 'ok' | 'error' | 'waiting' = 'waiting') {
  const node = el<HTMLParagraphElement>('connection-status')
  node.textContent = message
  node.dataset.kind = kind
}
function stopCamera() {
  generation++
  link?.close()
  link = null
  cameraStream?.getTracks().forEach((track) => track.stop())
  cameraStream = null
  const video = document.querySelector<HTMLVideoElement>('video')
  if (video) video.srcObject = null
}
window.addEventListener('pagehide', () => {
  stopCamera()
  if (frameUrl) URL.revokeObjectURL(frameUrl)
})

if (phoneMode) {
  app.innerHTML = `${header}
    <main class="phone-page">
      <p class="eyebrow">PHONE CAMERA</p><h1>Your paper.<br>Your next level.</h1>
      <p class="intro">Point your rear camera at the drawing. Your desktop will receive the live view.</p>
      <div class="phone-video-wrap"><video id="phone-video" autoplay playsinline muted></video><div class="camera-guide" aria-hidden="true"></div><span class="video-label">FIT YOUR DRAWING INSIDE THE FRAME</span></div>
      <p id="connection-status" class="status" role="status">Ready when you are.</p>
      <div class="button-row"><button id="start-camera" class="button primary">Start camera <span>↗</span></button><button id="stop-camera" class="button secondary" disabled>Stop</button></div>
      <p class="small-note">Keep this page open and your phone unlocked. Only video is shared—your microphone stays off.</p>
    </main>`
  const fragment = new URLSearchParams(location.hash.slice(1))
  const room = fragment.get('room')
  const key = fragment.get('key')
  const start = el<HTMLButtonElement>('start-camera')
  const stop = el<HTMLButtonElement>('stop-camera')
  if (!room || !key) {
    status('Open the desktop page, click Connect phone, then scan its QR code.', 'error')
    start.disabled = true
  } else if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    status('Camera access needs HTTPS. Scan the QR code from the page opened with npm run camera.', 'error')
    start.disabled = true
  }
  start.onclick = async () => {
    stopCamera()
    const attempt = generation
    start.disabled = true
    status('Allow camera access when your browser asks.')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } },
      })
      if (attempt !== generation) { stream.getTracks().forEach((track) => track.stop()); return }
      cameraStream = stream
      const video = el<HTMLVideoElement>('phone-video')
      video.srcObject = stream
      await video.play()
      if (attempt !== generation) return
      stop.disabled = false
      link = connectCamera({
        room: room!, key: key!, role: 'phone', stream,
        onStatus: status,
        onClose: () => {
          stopCamera()
          start.disabled = false
          stop.disabled = true
        },
      })
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        stopCamera()
        start.disabled = false
        stop.disabled = true
        status('Camera stopped. Tap Start camera to reconnect.', 'waiting')
      })
    } catch (error) {
      if (attempt !== generation) return
      stopCamera()
      start.disabled = false
      stop.disabled = true
      const name = error instanceof DOMException ? error.name : ''
      status(name === 'NotAllowedError'
        ? 'Camera permission was denied. Allow camera access in this website’s browser settings, then try again.'
        : name === 'NotReadableError'
          ? 'The camera is busy. Close other camera apps and try again.'
          : 'Camera could not start. Check browser permissions and try again.', 'error')
    }
  }
  stop.onclick = () => {
    stopCamera()
    start.disabled = false
    stop.disabled = true
    status('Camera stopped. Tap Start camera to reconnect.')
  }
} else {
  app.innerHTML = `${header}
    <main>
      <div class="hero"><div><p class="eyebrow">FROM YOUR NOTEBOOK TO YOUR SCREEN</p><h1>Every great level<br>starts with a <em>sketch.</em></h1><p class="intro">Connect your phone, frame your drawing, and capture the starting point for your game.</p></div><div class="step-chips"><span class="active"><b>01</b> Connect</span><span><b>02</b> Capture</span><span><b>03</b> Play</span></div></div>
      <div class="workspace">
        <section class="panel preview-panel" aria-labelledby="camera-heading">
          <div class="panel-heading"><h2 id="camera-heading">Drawing camera</h2><span id="live-badge" class="pill">OFFLINE</span></div>
          <div class="desktop-video-wrap"><video id="remote-video" autoplay playsinline muted></video><div id="video-placeholder" class="video-placeholder">${phoneIcon}<h3>A fresh perspective.</h3><p>Your phone’s camera will appear here.<br>Grab a pen and give your world a shape.</p></div><button id="play-video" class="button secondary playback-button" hidden>Tap to show live video</button></div>
          <div class="preview-footer"><p id="connection-status" class="status" role="status">Ready to connect your phone.</p><button id="capture-frame" class="button primary" disabled>Capture drawing <span>↗</span></button></div>
        </section>
        <aside class="panel pairing-panel"><p class="eyebrow">YOUR PHONE IS THE CAMERA</p><h2>Make the connection.</h2><p>Open a camera session, then scan the QR code with your smartphone.</p>
          <div id="pair-placeholder" class="qr-placeholder">${phoneIcon}<span>No app to download.</span></div>
          <canvas id="pair-qr" aria-label="Scan this QR code to connect your phone camera" hidden></canvas>
          <button id="connect-phone" class="button primary wide">Connect phone <span>↗</span></button>
          <div id="pair-actions" hidden><div class="button-row"><button id="copy-link" class="button secondary">Copy phone link</button><button id="disconnect" class="button secondary">Disconnect</button></div><a id="phone-link" class="phone-link" target="_blank" rel="noopener noreferrer">Open phone page ↗</a><p class="small-note">On your phone: tap Start camera, allow access, and keep the page open.</p></div>
          <div class="pairing-tip"><span>✦</span><p>Start with both devices on the same Wi-Fi. Keep the paper flat and well lit.</p></div>
        </aside>
      </div>
      <section id="capture-panel" class="panel capture-panel" hidden><div class="panel-heading"><div><p class="eyebrow">FRAME CAPTURED</p><h2>Your drawing, ready for the next step.</h2></div><a id="download-frame" class="button secondary" download="sketchrunner-drawing.png">Save image ↓</a></div><img id="captured-frame" alt="Drawing captured from the phone camera"/><p class="small-note">Saved in this browser only. Drawing recognition is not connected yet; the game below still uses your sample level.</p></section>
      <section class="game-section"><div class="panel-heading"><div><p class="eyebrow">THE PLAYGROUND</p><h2>Your game engine is ready.</h2></div><span class="pill">SAMPLE LEVEL</span></div><p class="small-note">Arrow keys to move · Space to jump · R to restart. Camera capture does not change this level yet.</p><div id="game"></div></section>
    </main><footer>Draw something worth playing.</footer>`
  const video = el<HTMLVideoElement>('remote-video')
  const connect = el<HTMLButtonElement>('connect-phone')
  const capture = el<HTMLButtonElement>('capture-frame')
  const placeholder = el<HTMLDivElement>('video-placeholder')
  const play = el<HTMLButtonElement>('play-video')
  let phoneUrl = ''
  function clearPairing() {
    stopCamera()
    capture.disabled = true
    placeholder.hidden = false
    play.hidden = true
    el('live-badge').textContent = 'OFFLINE'
    el('live-badge').classList.remove('live')
    el('pair-qr').hidden = true
    el('pair-actions').hidden = true
    el('pair-placeholder').hidden = false
    connect.hidden = false
    connect.disabled = false
    phoneUrl = ''
  }
  video.onplaying = () => { capture.disabled = video.videoWidth === 0 }
  play.onclick = () => { void video.play().then(() => { play.hidden = true }).catch(() => status('Video could not play. Reconnect your phone.', 'error')) }
  connect.onclick = async () => {
    clearPairing()
    const attempt = generation
    connect.disabled = true
    status('Opening a camera session…')
    try {
      const configResponse = await fetch('/api/config')
      if (!configResponse.ok || !configResponse.headers.get('content-type')?.includes('application/json')) throw new Error('Run npm run camera in your project terminal, then open the address it prints. The regular Vite server only previews the game.')
      const config = await configResponse.json()
      const origin = config.publicUrl || (location.protocol === 'https:' ? location.origin : null)
      if (!origin) throw new Error('The HTTPS link is not ready. Wait for npm run camera to print it, then try again.')
      const response = await fetch('/api/sessions', { method: 'POST' })
      const session = await response.json()
      if (!response.ok) throw new Error(session.error || 'Could not create a camera session.')
      if (attempt !== generation) return
      const url = new URL('/camera', origin)
      url.hash = new URLSearchParams({ room: session.room, key: session.phoneKey }).toString()
      phoneUrl = url.href
      await QRCode.toCanvas(el<HTMLCanvasElement>('pair-qr'), phoneUrl, { width: 248, margin: 2, color: { dark: '#0f172a', light: '#ffffff' } })
      if (attempt !== generation) return
      el('pair-qr').hidden = false
      el('pair-actions').hidden = false
      el('pair-placeholder').hidden = true
      connect.hidden = true
      el<HTMLAnchorElement>('phone-link').href = phoneUrl
      link = connectCamera({
        room: session.room, key: session.desktopKey, role: 'desktop', onStatus: status,
        onStream: (stream) => {
          video.srcObject = stream
          capture.disabled = true
          placeholder.hidden = Boolean(stream)
          play.hidden = true
          el('live-badge').textContent = stream ? 'LIVE CAMERA' : 'WAITING'
          el('live-badge').classList.toggle('live', Boolean(stream))
          if (stream) void video.play().catch(() => { play.hidden = false })
        },
        onClose: clearPairing,
      })
    } catch (error) {
      clearPairing()
      status(error instanceof Error ? error.message : 'Connection failed. Please try again.', 'error')
    }
  }
  el('disconnect').onclick = () => { clearPairing(); status('Disconnected. Connect your phone to start again.') }
  el('copy-link').onclick = async () => {
    try {
      await navigator.clipboard.writeText(phoneUrl)
      el('copy-link').textContent = 'Copied!'
      setTimeout(() => { el('copy-link').textContent = 'Copy phone link' }, 2000)
    } catch { status('Use the Open phone page link below, or scan the QR code.') }
  }
  capture.onclick = () => {
    if (!video.srcObject || video.readyState < 2 || !video.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')!.drawImage(video, 0, 0)
    canvas.toBlob((blob) => {
      if (!blob) { status('Could not capture this frame. Try again.', 'error'); return }
      if (frameUrl) URL.revokeObjectURL(frameUrl)
      frameUrl = URL.createObjectURL(blob)
      el<HTMLImageElement>('captured-frame').src = frameUrl
      el<HTMLAnchorElement>('download-frame').href = frameUrl
      el('capture-panel').hidden = false
      status(`Drawing captured · ${canvas.width} × ${canvas.height}. The live feed is still running.`, 'ok')
      window.dispatchEvent(new CustomEvent('sketchrunner:frame', { detail: { blob, width: canvas.width, height: canvas.height } }))
    }, 'image/png')
  }
  // Step 1: clean the captured frame into a black-on-white ink mask (see vision.ts)
  window.addEventListener('sketchrunner:frame', async (e) => {
    const { blob } = (e as CustomEvent<{ blob: Blob }>).detail
    status('Cleaning drawing…')
    try {
      const { extractInk, drawMask } = await import('./vision')
      const ink = await extractInk(blob)
      let debug = document.getElementById('ink-debug') as HTMLCanvasElement | null
      if (!debug) {
        debug = document.createElement('canvas')
        debug.id = 'ink-debug'
        debug.style.maxWidth = '100%'
        el('capture-panel').appendChild(debug)
      }
      drawMask(ink, debug)
      status(`Ink extracted · ${ink.width} × ${ink.height}`, 'ok')
    } catch (error) {
      console.error(error)
      status('Could not clean the drawing. Check the browser console for details.', 'error')
    }
  })
  void import('./game').then(({ mountGame }) => mountGame()).catch(() => {
    el('game').textContent = 'The sample game could not start. Check the browser console for details.'
  })
}