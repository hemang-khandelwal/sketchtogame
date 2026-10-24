# SketchRunner

A phone camera streams a paper drawing to the desktop, next to a playable Phaser prototype. The desktop can capture and download a frame. **Drawing-to-level AI is not connected yet:** the game still reads `public/level.json`.

## Run the phone camera connection (Mac and Windows)

1. Install current Node.js LTS. Open this folder in VS Code, then open a terminal.
2. Run `npm install` (Windows PowerShell can use `npm.cmd install`).
3. Run `npm run camera` (or `npm.cmd run camera`).
4. Open the **HTTPS address printed in the terminal on your desktop**.
5. Click **Connect phone**, scan the QR code with your smartphone, and open it in Safari or Chrome.
6. Tap **Start camera** on the phone and allow camera access. Keep the page open and the phone unlocked.
7. Point the rear camera at your drawing. The desktop should show its live video. Click **Capture drawing** to save a frame in the browser, or **Save image** to download it.

Start with both devices on the same Wi-Fi. Only the desktop runs Node; the phone only needs its browser. Each teammate runs their own session; they do not share localhost addresses.

The command builds the project, starts a small server on port 8787, and creates a temporary Cloudflare HTTPS tunnel. On first run it downloads an official, checksum-verified cloudflared binary into ignored `.camera-tools/`. Supported automatic downloads: Apple Silicon/Intel Mac, Windows x64, Linux x64. For another platform, install cloudflared and set `CLOUDFLARED_PATH` in `.env`.

**Keep the terminal open.** Control+C stops the server and tunnel. The public HTTPS address changes on restart. The page is temporarily internet-accessible, but joining a camera session requires the secret QR/link. Share the phone link only with the intended camera operator. Video is sent over WebRTC, not stored on the server, and no microphone is requested. A configured TURN relay may carry the encrypted video if a direct route is unavailable. Google STUN is used to discover connection routes; STUN does not relay the video itself. Sessions expire after two hours, and closing the desktop invalidates the pairing.

This is a development/demo setup, not permanent hosting. The tunnel needs internet and may be blocked by managed networks. The app serves the built `dist` folder, not source files or `.env`.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite editor preview with automatic updates; camera pairing needs the camera server. |
| `npm run camera` | Build + connection server + temporary HTTPS tunnel. |
| `npm run camera:local` | Build + local server only, for tests or an existing HTTPS proxy. |
| `npm run build` | TypeScript checks and production build. |
| `npm test` | Signaling/session integration tests (run build first). |

After changing code while using camera mode, stop and rerun `npm run camera` so it rebuilds. `npm run dev` uses a different server; open the current camera command's URL, not an old Vite tab. Teammates should commit source and the lockfile, but not node_modules, dist, .env, or .camera-tools.

## How it works

- `src/main.ts`: desktop pairing/preview/capture and mobile camera UI (`/camera`).
- `src/connection.ts`: WebRTC negotiation, queued ICE candidates, connection status, cleanup.
- `src/game.ts`: existing Phaser game, loaded only on desktop.
- `server/app.mjs`: static hosting, temporary sessions, authenticated WebSocket signaling. One desktop and one phone per session; signals stay within that session.
- `scripts/camera.mjs`: server and cross-platform HTTPS tunnel launcher.
- `public/level.json`: the current sample level, independent of camera capture.

The desktop creates a session. The QR carries the room ID and phone-only key in the URL fragment. The desktop sends a receive-only WebRTC offer, and the phone answers with its video track. The server relays connection setup messages, not image frames. Stopping the phone camera releases the tracks; it can reconnect using the same pairing link while the desktop remains connected.

Capture draws the current remote video frame to a canvas, creates a PNG Blob, and emits `window` event `sketchrunner:frame` with `{ blob, width, height }`. This is the integration point for the later drawing-recognition backend. No image is currently submitted to an AI service.

## Troubleshooting

- **npm not recognised on Windows:** install Node.js and restart all VS Code windows. If PowerShell blocks npm.ps1, use npm.cmd.
- **Camera access unavailable:** open the HTTPS QR link, not an HTTP local IP or localhost on the phone. Allow camera permission in the phone browser's website settings. Try opening outside an in-app QR browser.
- **Phone shows video, desktop stays connecting:** try the same Wi-Fi, disable a VPN, and keep the phone page foreground. Guest/campus Wi-Fi may isolate devices. A tunnel handles HTTPS and signaling, not WebRTC media connectivity. For restrictive/different networks configure a TURN relay in `.env` using `.env.example` and restart. TURN credentials are delivered only to authenticated session peers; use short-lived credentials for a public deployment.
- **Desktop closed or link expired:** create a new desktop session and scan its new QR.
- **Port 8787 is occupied:** stop the previous camera terminal or set CAMERA_PORT in `.env`.
- **Tunnel download/setup failed:** check network access to GitHub/Cloudflare, or use your own tunnel and set PUBLIC_URL in `.env`. The optional local preview still works.
- **Video doesn't autoplay:** tap the displayed playback button.
- **Phone sleeps/backgrounds:** return to the camera page; stop and restart the camera if needed.

## Manual acceptance check

Test on a real iPhone/Android and desktop: permission allowed/denied, live moving image, capture, stop/restart, duplicate phone rejection, desktop disconnect, expired QR, and mobile layout. Automated tests validate signaling, authentication, isolation, reconnect, expiry, and static routing. A browser smoke check using a synthetic canvas stream also verified remote video delivery, nonempty PNG capture, and reconnection during development. A build and signaling tests alone do not prove real-device camera interoperability.
