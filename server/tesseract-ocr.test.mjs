import test from 'node:test'
import assert from 'node:assert/strict'
import { mapTesseractWords, tesseractCachePath, tesseractLangs, wordsFromBlocks } from './tesseract-ocr.mjs'
import { resolveOcrEngines } from './mlx-ocr.mjs'

test('resolveOcrEngines: explicit preference always wins', () => {
  assert.deepEqual(resolveOcrEngines({ OCR_ENGINE: 'mlx' }, 'win32'), ['mlx'])
  assert.deepEqual(resolveOcrEngines({ OCR_ENGINE: 'tesseract' }, 'darwin'), ['tesseract'])
  assert.deepEqual(resolveOcrEngines({ OCR_ENGINE: 'TESSERACT' }, 'darwin'), ['tesseract'])
})

test('resolveOcrEngines: auto prefers MLX on macOS, Tesseract elsewhere', () => {
  assert.deepEqual(resolveOcrEngines({}, 'darwin'), ['mlx', 'tesseract'])
  assert.deepEqual(resolveOcrEngines({}, 'win32'), ['tesseract'])
  assert.deepEqual(resolveOcrEngines({}, 'linux'), ['tesseract'])
  assert.deepEqual(resolveOcrEngines({ OCR_ENGINE: 'auto' }, 'win32'), ['tesseract'])
  assert.deepEqual(resolveOcrEngines({ OCR_ENGINE: 'bogus' }, 'darwin'), ['mlx', 'tesseract'])
})

test('mapTesseractWords: keeps valid words, drops blanks and bad boxes', () => {
  const words = mapTesseractWords([
    { text: 'Mud', bbox: { x0: 10, y0: 20, x1: 60, y1: 40 } },
    { text: '   ', bbox: { x0: 0, y0: 0, x1: 5, y1: 5 } },
    { text: 'weight', bbox: { x0: 70, y0: 20, x1: 140, y1: 40 } },
    { text: 'broken', bbox: { x0: 0, y0: 0, x1: NaN, y1: 5 } },
    { text: 'nobox' },
    null,
    { text: 42, bbox: { x0: 0, y0: 0, x1: 5, y1: 5 } },
  ])
  assert.deepEqual(words, [
    { text: 'Mud', bbox: { x0: 10, y0: 20, x1: 60, y1: 40 } },
    { text: 'weight', bbox: { x0: 70, y0: 20, x1: 140, y1: 40 } },
  ])
})

test('mapTesseractWords: tolerates missing input', () => {
  assert.deepEqual(mapTesseractWords(undefined), [])
  assert.deepEqual(mapTesseractWords(null), [])
})

test('wordsFromBlocks: walks blocks/paragraphs/lines to words', () => {
  const blocks = [{
    paragraphs: [{
      lines: [{
        words: [
          { text: 'Mud', bbox: { x0: 10, y0: 20, x1: 60, y1: 40 } },
          { text: ' ', bbox: { x0: 60, y0: 20, x1: 65, y1: 40 } },
          { text: '1.22', bbox: { x0: 65, y0: 20, x1: 120, y1: 40 } },
        ],
      }],
    }],
  }]
  assert.deepEqual(wordsFromBlocks(blocks), [
    { text: 'Mud', bbox: { x0: 10, y0: 20, x1: 60, y1: 40 } },
    { text: '1.22', bbox: { x0: 65, y0: 20, x1: 120, y1: 40 } },
  ])
  assert.deepEqual(wordsFromBlocks(undefined), [])
})

test('tesseract paths: env overrides with local defaults', () => {
  assert.equal(tesseractLangs(), 'eng+hin')
  assert.equal(tesseractCachePath(), '.tesseract-cache')
  process.env.TESSERACT_LANGS = 'eng'
  process.env.TESSERACT_CACHE = '/tmp/tess'
  try {
    assert.equal(tesseractLangs(), 'eng')
    assert.equal(tesseractCachePath(), '/tmp/tess')
  } finally {
    delete process.env.TESSERACT_LANGS
    delete process.env.TESSERACT_CACHE
  }
})
