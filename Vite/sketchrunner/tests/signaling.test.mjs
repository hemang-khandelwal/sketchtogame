import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { createCameraServer } from '../server/app.mjs'

async function setup(t, extra = {}) {
  const app = createCameraServer({ dist: new URL('../dist', import.meta.url).pathname, ...extra })
  await new Promise((done) => app.server.listen(0, '127.0.0.1', done))
  t.after(() => app.close())
  const origin = `http://127.0.0.1:${app.server.address().port}`
  const create = async () => (await fetch(origin + '/api/sessions', { method: 'POST' })).json()
  async function socket() {
    const ws = new WebSocket(origin.replace('http', 'ws') + '/signal')
    const queue = [], readers = []
    ws.on('message', (raw) => {
      const value = JSON.parse(raw)
      if (readers.length) readers.shift()(value)
      else queue.push(value)
    })
    await once(ws, 'open')
    return {
      ws,
      send: (msg) => ws.send(JSON.stringify(msg)),
      next: () => queue.length ? Promise.resolve(queue.shift()) : new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timed out waiting for a signaling message')), 2000)
        readers.push((value) => { clearTimeout(timer); resolve(value) })
      }),
      queue,
    }
  }
  async function join(session, role) {
    const client = await socket()
    client.send({ type: 'join', role, room: session.room, key: session[`${role}Key`] })
    assert.equal((await client.next()).type, 'joined')
    return client
  }
  return { origin, create, socket, join }
}

test('paired devices exchange an offer, answer, and ICE only within their room', async (t) => {
  const { create, join } = await setup(t)
  const one = await create(), two = await create()
  const desktop = await join(one, 'desktop'), stranger = await join(two, 'desktop')
  const phone = await join(one, 'phone')
  assert.equal((await desktop.next()).type, 'peer-ready')
  assert.equal((await phone.next()).type, 'peer-ready')
  const offer = { type: 'signal', data: { description: { type: 'offer', sdp: 'test-offer' } } }
  desktop.send(offer)
  assert.deepEqual(await phone.next(), offer)
  const answer = { type: 'signal', data: { description: { type: 'answer', sdp: 'test-answer' } } }
  phone.send(answer)
  assert.deepEqual(await desktop.next(), answer)
  const ice = { type: 'signal', data: { candidate: { candidate: 'candidate:example', sdpMid: '0' } } }
  phone.send(ice)
  assert.deepEqual(await desktop.next(), ice)
  assert.equal(stranger.queue.length, 0)
})

test('invalid credentials and a second phone are rejected', async (t) => {
  const { create, socket, join } = await setup(t)
  const room = await create()
  const intruder = await socket()
  const closed = once(intruder.ws, 'close')
  intruder.send({ type: 'join', room: room.room, role: 'phone', key: room.desktopKey })
  assert.equal((await closed)[0], 4001)
  await join(room, 'desktop')
  await join(room, 'phone')
  const duplicate = await socket()
  const rejected = once(duplicate.ws, 'close')
  duplicate.send({ type: 'join', room: room.room, role: 'phone', key: room.phoneKey })
  assert.equal((await rejected)[0], 4002)
})

test('phone can reconnect; desktop departure invalidates its pairing link', async (t) => {
  const { create, join, socket } = await setup(t)
  const room = await create()
  const desktop = await join(room, 'desktop'), phone = await join(room, 'phone')
  await desktop.next(); await phone.next()
  phone.ws.close()
  assert.equal((await desktop.next()).type, 'peer-left')
  const replacement = await join(room, 'phone')
  assert.equal((await desktop.next()).type, 'peer-ready')
  await replacement.next()
  const closed = once(replacement.ws, 'close')
  desktop.ws.close()
  assert.equal((await closed)[0], 4000)
  const stale = await socket()
  const staleClosed = once(stale.ws, 'close')
  stale.send({ type: 'join', room: room.room, role: 'phone', key: room.phoneKey })
  assert.equal((await staleClosed)[0], 4001)
})

test('expired sessions are rejected at join time', async (t) => {
  const { create, socket } = await setup(t, { maxAge: -1 })
  const room = await create(), client = await socket()
  const closed = once(client.ws, 'close')
  client.send({ type: 'join', room: room.room, role: 'phone', key: room.phoneKey })
  assert.equal((await closed)[0], 4001)
})

test('serves app and configuration, rejects foreign-origin session creation and private file requests', async (t) => {
  const { origin } = await setup(t, { getPublicUrl: () => 'https://example.test' })
  const config = await (await fetch(origin + '/api/config')).json()
  assert.equal(config.publicUrl, 'https://example.test')
  assert.equal((await fetch(origin + '/')).status, 200)
  assert.equal((await fetch(origin + '/camera')).status, 200)
  assert.equal((await fetch(origin + '/.env')).status, 404)
  assert.equal((await fetch(origin + '/package.json')).status, 404)
  assert.equal((await fetch(origin + '/api/sessions', { method: 'POST', headers: { Origin: 'https://unrelated.test' } })).status, 403)
})
