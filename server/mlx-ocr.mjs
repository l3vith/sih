import sharp from 'sharp'
import { recognizeTesseract, tesseractLangs } from './tesseract-ocr.mjs'

// Engine preference via OCR_ENGINE: 'mlx' | 'tesseract' | 'auto' (default).
// auto = MLX GLM-OCR on Apple Silicon (with Tesseract fallback if the local
// MLX service is unreachable), Tesseract directly everywhere else — the MLX
// service cannot run on Windows/Linux, so trying it there is pointless.
// Exported for tests.
export function resolveOcrEngines(env = process.env, platform = process.platform) {
  const pref = String(env.OCR_ENGINE || 'auto').toLowerCase()
  if (pref === 'tesseract') return ['tesseract']
  if (pref === 'mlx') return ['mlx']
  return platform === 'darwin' ? ['mlx', 'tesseract'] : ['tesseract']
}

function isConnectionFailure(error) {
  if (!(error instanceof TypeError)) return false
  if (error.message === 'fetch failed') return true
  return String(error.cause?.code || '').startsWith('ECONN')
}

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
    const engines = resolveOcrEngines()
    try {
      const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(3000) })
      const payload = await response.json()
      if (!response.ok || payload.engine !== 'GLM-OCR' || !payload.ready) throw new Error('Not ready')
      res.json({ ...payload, busy: busy || payload.busy, engines })
    } catch {
      const body = { engine: 'GLM-OCR', ready: false, busy, engines, error: unavailable }
      if (engines.includes('tesseract')) body.fallback = 'tesseract'
      res.status(503).json(body)
    }
  })

  app.post('/api/ocr', async (req, res) => {
    if (busy) return res.status(429).json({ error: 'OCR is processing another page. Please retry when it finishes.' })
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
      const engines = resolveOcrEngines()
      let usedFallback = false
      for (const engine of engines) {
        if (engine === 'tesseract') {
          try {
            const result = await recognizeTesseract(png)
            return res.json({
              text: result.text, words: result.words,
              width: info.width, height: info.height,
              engine: 'Tesseract', localizationEngine: 'Tesseract LSTM',
              model: tesseractLangs(), device: process.platform, fallback: usedFallback,
            })
          } catch (error) {
            throw new Error(`Tesseract OCR failed: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
        try {
          const response = await fetch(`${base}/ocr`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(timeout),
            body: JSON.stringify({ imageBase64: png.toString('base64') }),
          })
          const payload = await response.json().catch(() => null)
          if (!response.ok) return res.status([400, 422, 429, 503].includes(response.status) ? response.status : 502).json({ error: typeof payload?.detail === 'string' ? payload.detail : `Local GLM-OCR returned HTTP ${response.status}. Check npm run ocr:logs.` })
          if (typeof payload?.text !== 'string' || payload.engine !== 'GLM-OCR' || !Array.isArray(payload.words)) throw new Error('GLM-OCR returned an invalid response.')
          const words = payload.words.filter((word) =>
            typeof word?.text === 'string' &&
            ['x0', 'y0', 'x1', 'y1'].every((key) => Number.isFinite(word?.bbox?.[key]))
          )
          return res.json({ text: payload.text.trim(), words, width: info.width, height: info.height, engine: 'GLM-OCR', localizationEngine: payload.localizationEngine, model: payload.model, device: 'metal', fallback: false })
        } catch (error) {
          if (isConnectionFailure(error) && engines.includes('tesseract')) {
            usedFallback = true
            continue
          }
          throw error
        }
      }
      throw new Error(unavailable)
    } catch (error) {
      const message = error.message === 'fetch failed' ? unavailable : error.name === 'TimeoutError' ? 'GLM-OCR timed out. The current page may still be running; check OCR status before retrying.' : error.message
      res.status(error.name === 'TimeoutError' ? 504 : 502).json({ error: message })
    } finally { busy = false }
  })
}
