import { createWorker, OEM } from 'tesseract.js'

// Cross-platform local OCR fallback for machines without Apple Silicon
// (e.g. Windows): Tesseract LSTM via WASM, no system dependencies.
// Full-page text plus word boxes, so the response contract matches /api/ocr.
// Language data downloads once (needs network on first run) and is cached
// under TESSERACT_CACHE for fully offline use afterwards.

let workerPromise = null

export function tesseractLangs() {
  return process.env.TESSERACT_LANGS || 'eng+hin'
}

export function tesseractCachePath() {
  return process.env.TESSERACT_CACHE || '.tesseract-cache'
}

export function mapTesseractWords(dataWords) {
  return (Array.isArray(dataWords) ? dataWords : [])
    .filter((word) =>
      typeof word?.text === 'string' &&
      word.text.trim() !== '' &&
      ['x0', 'y0', 'x1', 'y1'].every((key) => Number.isFinite(word?.bbox?.[key])))
    .map((word) => ({
      text: word.text,
      bbox: { x0: word.bbox.x0, y0: word.bbox.y0, x1: word.bbox.x1, y1: word.bbox.y1 },
    }))
}

// tesseract.js v6+ only returns `text` by default; word boxes require the
// `blocks` output, nested as blocks → paragraphs → lines → words.
export function wordsFromBlocks(blocks) {
  const words = []
  for (const block of Array.isArray(blocks) ? blocks : []) {
    for (const paragraph of block?.paragraphs || []) {
      for (const line of paragraph?.lines || []) {
        for (const word of line?.words || []) words.push(word)
      }
    }
  }
  return mapTesseractWords(words)
}

async function getWorker() {
  if (!workerPromise) {
    const langs = tesseractLangs()
    const cachePath = tesseractCachePath()
    workerPromise = createWorker(langs, OEM.LSTM_ONLY, { cachePath })
      .catch((error) => {
        workerPromise = null
        throw new Error(`Tesseract worker failed to start (langs=${langs}): ${error instanceof Error ? error.message : String(error)}`)
      })
  }
  return workerPromise
}

// For tests: drop the cached worker so a fresh one is created on next call.
export function resetTesseractWorker() {
  workerPromise = null
}

export async function recognizeTesseract(pngBuffer) {
  const worker = await getWorker()
  const { data } = await worker.recognize(pngBuffer, {}, { blocks: true, text: true })
  const words = Array.isArray(data?.words) && data.words.length
    ? mapTesseractWords(data.words)
    : wordsFromBlocks(data?.blocks)
  return {
    text: String(data?.text || '').trim(),
    words,
  }
}
