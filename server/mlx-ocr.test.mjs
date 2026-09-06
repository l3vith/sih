import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import sharp from 'sharp'
import { installMlxOcr } from './mlx-ocr.mjs'

async function listen(app) {
  const server = app.listen(0, '127.0.0.1')
  await new Promise(r => server.once('listening', r))
  return { server, url: `http://127.0.0.1:${server.address().port}` }
}
async function close(server) { server.closeAllConnections(); await new Promise(r => server.close(r)) }

test('OCR cannot be configured to send page images to a remote host', () => {
  process.env.MLX_OCR_URL = 'https://example.com'
  try { assert.throws(() => installMlxOcr(express()), /loopback/) }
  finally { delete process.env.MLX_OCR_URL }
})

test('Metal OCR adapter: text fidelity, image sizing, busy state, failures and readiness', async () => {
  const transcription = '# दैनिक रिपोर्ट\n\nWell D-05 / Giruj\nMud weight: 1.22\n\n| Depth | Notes |\n| 2050 | Cement channeling |'
  let mode = 'ok', captured, release
  const mock = express(); mock.use(express.json({ limit: '2mb' }))
  mock.get('/health', (_req, res) => res.json({ engine: 'GLM-OCR', device: 'metal', ready: mode !== 'loading', busy: mode === 'wait' }))
  mock.post('/ocr', async (req, res) => {
    captured = req.body
    if (mode === 'wait') await new Promise(r => { release = r })
    if (mode === 'length') return res.status(422).json({ detail: 'OCR reached its output limit.' })
    if (mode === 'busy') return res.status(429).json({ detail: 'Model busy.' })
    if (mode === 'bad') return res.json({ text: 42 })
    res.json({
      text: mode === 'blank' ? '' : transcription,
      words: [{ text: 'Well D-05', bbox: { x0: 110, y0: 75, x1: 510, y1: 145 }, confidence: 0.94 }],
      engine: 'GLM-OCR', localizationEngine: 'Apple Vision', model: 'mlx-community/GLM-OCR-bf16',
    })
  })
  const upstream = await listen(mock)
  process.env.MLX_OCR_URL = upstream.url
  process.env.OCR_ENGINE = 'mlx' // pin MLX-only: preserves pre-fallback expectations below
  const app = express(); app.use(express.json()); installMlxOcr(app)
  const api = await listen(app)
  const post = body => fetch(`${api.url}/api/ocr`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const health = () => fetch(`${api.url}/api/ocr/health`)
  try {
    assert.equal((await (await health()).json()).ready, true)
    mode = 'loading'; assert.equal((await health()).status, 503); mode = 'ok'
    assert.equal((await post({})).status, 400)
    assert.equal((await post({ imageBase64: 'data:image/png;base64,bm90YW5pbWFnZQ==' })).status, 400)
    const bytes = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: 'white' } }).png().toBuffer()
    const body = { imageBase64: `data:image/png;base64,${bytes.toString('base64')}` }
    const response = await post(body)
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(result.text, transcription)
    assert.equal(result.width, 2200)
    assert.equal(result.height, 1100)
    assert.equal(result.words.length, 1)
    assert.deepEqual(result.words[0].bbox, { x0: 110, y0: 75, x1: 510, y1: 145 })
    assert.equal(result.localizationEngine, 'Apple Vision')
    assert.equal(result.confidence, undefined)
    assert.equal(result.engine, 'GLM-OCR')
    const decoded = await sharp(Buffer.from(captured.imageBase64, 'base64')).metadata()
    assert.equal(decoded.width, 2200)
    mode = 'blank'; assert.equal((await (await post(body)).json()).text, '')
    mode = 'length'; assert.equal((await post(body)).status, 422)
    mode = 'busy'; assert.equal((await post(body)).status, 429)
    mode = 'bad'; assert.equal((await post(body)).status, 502)
    mode = 'wait'
    const pending = post(body)
    while (!release) await new Promise(r => setTimeout(r, 10))
    assert.equal((await post(body)).status, 429)
    assert.equal((await (await health()).json()).busy, true)
    mode = 'ok'; release(); await pending
    await close(upstream.server)
    assert.equal((await health()).status, 503)
    assert.match((await (await post(body)).json()).error, /unavailable/)
  } finally {
    if (release) release()
    await close(api.server)
    if (upstream.server.listening) await close(upstream.server)
    delete process.env.MLX_OCR_URL
    delete process.env.OCR_ENGINE
  }
})
