import sharp from 'sharp'

export function installMlxOcr(app) {
  const base = (process.env.MLX_OCR_URL || `http://127.0.0.1:${process.env.MLX_OCR_PORT || 8080}`).replace(/\/$/, '')
  const url = new URL(base)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.protocol !== 'http:') {
    throw new Error('MLX_OCR_URL must point to the local HTTP service on loopback.')
  }
  const timeout = Number(process.env.MLX_OCR_TIMEOUT_MS || 600000)
  let busy = false
  const unavailable = 'Local GLM-OCR is unavailable or still loading. Run npm run ocr:start, then npm run ocr:status. Check npm run ocr:logs if startup fails.'

  app.get('/api/ocr/health', async (_req, res) => {
    try {
      const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(3000) })
      const payload = await response.json()
      if (!response.ok || payload.engine !== 'GLM-OCR' || !payload.ready) throw new Error('Not ready')
      res.json({ ...payload, busy: busy || payload.busy })
    } catch { res.status(503).json({ engine: 'GLM-OCR', ready: false, error: unavailable }) }
  })

  app.post('/api/ocr', async (req, res) => {
    if (busy) return res.status(429).json({ error: 'GLM-OCR is processing another page. Please retry when it finishes.' })
    const image = req.body?.imageBase64
    if (typeof image !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image)) return res.status(400).json({ error: 'A base64 PNG, JPEG, or WebP image is required.' })
    busy = true
    try {
      let png, info
      try {
        const output = await sharp(Buffer.from(image.split(',')[1], 'base64'), { limitInputPixels: 40000000 })
          .rotate().resize({ width: 2200, height: 2200, fit: 'inside', withoutEnlargement: true })
          .flatten({ background: '#ffffff' }).png().toBuffer({ resolveWithObject: true })
        png = output.data; info = output.info
      } catch { return res.status(400).json({ error: 'The page image could not be decoded or exceeds the 40-megapixel limit.' }) }
      const response = await fetch(`${base}/ocr`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(timeout),
        body: JSON.stringify({ imageBase64: png.toString('base64') }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) return res.status([400, 422, 429, 503].includes(response.status) ? response.status : 502).json({ error: typeof payload?.detail === 'string' ? payload.detail : `Local GLM-OCR returned HTTP ${response.status}. Check npm run ocr:logs.` })
      if (typeof payload?.text !== 'string' || payload.engine !== 'GLM-OCR') throw new Error('GLM-OCR returned an invalid response.')
      // GLM's recognition mode produces Markdown text, not localized regions.
      // Keep the existing contract without manufacturing boxes or confidence.
      res.json({ text: payload.text.trim(), words: [], width: info.width, height: info.height, engine: 'GLM-OCR', model: payload.model, device: 'metal' })
    } catch (error) {
      const message = error.message === 'fetch failed' ? unavailable : error.name === 'TimeoutError' ? 'GLM-OCR timed out. The current page may still be running; check OCR status before retrying.' : error.message
      res.status(error.name === 'TimeoutError' ? 504 : 502).json({ error: message })
    } finally { busy = false }
  })
}
