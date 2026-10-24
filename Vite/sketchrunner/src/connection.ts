export type ConnectionOptions = {
  room: string
  key: string
  role: 'desktop' | 'phone'
  stream?: MediaStream
  onStream?: (stream: MediaStream | null) => void
  onStatus: (message: string, kind?: 'ok' | 'error' | 'waiting') => void
  onClose?: () => void
}

export function connectCamera(options: ConnectionOptions) {
  const endpoint = new URL('/signal', location.href)
  endpoint.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const socket = new WebSocket(endpoint)
  let peer: RTCPeerConnection | null = null
  let iceServers: RTCIceServer[] = []
  let candidates: RTCIceCandidateInit[] = []
  let closed = false
  let waitTimer: ReturnType<typeof setTimeout> | undefined
  const send = (data: unknown) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data))
  }
  function dropPeer() {
    clearTimeout(waitTimer)
    const old = peer
    peer = null
    if (old) {
      old.onconnectionstatechange = null
      old.onicecandidate = null
      old.ontrack = null
      old.close()
    }
    candidates = []
    options.onStream?.(null)
  }
  function getPeer() {
    if (peer) return peer
    const current = new RTCPeerConnection({ iceServers })
    peer = current
    if (options.stream) {
      for (const track of options.stream.getVideoTracks()) current.addTrack(track, options.stream)
    } else current.addTransceiver('video', { direction: 'recvonly' })
    current.onicecandidate = (event) => {
      if (event.candidate) send({ type: 'signal', data: { candidate: event.candidate.toJSON() } })
    }
    current.ontrack = (event) => options.onStream?.(event.streams[0] ?? new MediaStream([event.track]))
    current.onconnectionstatechange = () => {
      if (peer !== current || closed) return
      if (current.connectionState === 'connected') {
        clearTimeout(waitTimer)
        options.onStatus(options.role === 'phone' ? 'Live on your desktop' : 'Phone connected · live', 'ok')
      } else if (current.connectionState === 'failed') {
        clearTimeout(waitTimer)
        options.onStream?.(null)
        options.onStatus('Video could not connect. Try the same Wi-Fi without a VPN, then restart the phone camera. Restricted networks may need a TURN relay; see README.', 'error')
      } else if (current.connectionState === 'disconnected') {
        options.onStatus('Video interrupted. Keep the phone page open and check its connection.', 'waiting')
      }
    }
    waitTimer = setTimeout(() => {
      if (current.connectionState !== 'connected' && peer === current) {
        options.onStatus('Still connecting video. Put both devices on the same Wi-Fi and keep the phone page open. See README for restricted networks.', 'waiting')
      }
    }, 20000)
    return current
  }
  const joinTimer = setTimeout(() => {
    options.onStatus('Connection timed out. Restart the camera command and open its current HTTPS link.', 'error')
    socket.close()
  }, 15000)
  socket.onopen = () => send({ type: 'join', room: options.room, key: options.key, role: options.role })

  // Preserve message order, including ICE candidates arriving before descriptions.
  let processing = Promise.resolve()
  socket.onmessage = (event) => {
    processing = processing.then(async () => {
      if (closed) return
      const message = JSON.parse(event.data)
      if (message.type === 'joined') {
        clearTimeout(joinTimer)
        iceServers = message.iceServers ?? []
        options.onStatus(options.role === 'desktop' ? 'Waiting for your phone' : 'Camera ready · waiting for desktop', 'waiting')
      } else if (message.type === 'peer-left') {
        dropPeer()
        options.onStatus('Phone disconnected. Tap Start camera on the phone to reconnect.', 'waiting')
      } else if (message.type === 'peer-ready' && options.role === 'desktop') {
        dropPeer()
        options.onStatus('Connecting live video…', 'waiting')
        const current = getPeer()
        const offer = await current.createOffer()
        if (closed || peer !== current) return
        await current.setLocalDescription(offer)
        if (closed || peer !== current) return
        send({ type: 'signal', data: { description: current.localDescription?.toJSON() } })
      } else if (message.type === 'signal') {
        const current = getPeer()
        const data = message.data
        if (data.description) {
          await current.setRemoteDescription(data.description)
          for (const candidate of candidates) await current.addIceCandidate(candidate)
          candidates = []
          if (data.description.type === 'offer') {
            await current.setLocalDescription(await current.createAnswer())
            if (closed || peer !== current) return
            send({ type: 'signal', data: { description: current.localDescription?.toJSON() } })
          }
        } else if (data.candidate) {
          if (current.remoteDescription) await current.addIceCandidate(data.candidate)
          else candidates.push(data.candidate)
        }
      }
    }).catch(() => {
      if (!closed) options.onStatus('Could not negotiate video. Restart the phone camera, or create a new pairing link.', 'error')
    })
  }
  socket.onerror = () => options.onStatus('Connection server unavailable. Open the address printed by npm run camera.', 'error')
  socket.onclose = (event) => {
    clearTimeout(joinTimer)
    dropPeer()
    if (!closed) {
      closed = true
      options.onStatus(event.reason || 'Connection closed. Start a new pairing session on the desktop.', 'error')
      options.onClose?.()
    }
  }
  return {
    close() {
      closed = true
      clearTimeout(joinTimer)
      dropPeer()
      socket.close()
    },
  }
}
