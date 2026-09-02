import { readFile } from 'node:fs/promises'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

const filePath = process.argv[2]
if (!filePath) throw new Error('Usage: node scripts/verify-pipeline.mjs <document.pdf>')

const pdf = await getDocument({ data: new Uint8Array(await readFile(filePath)) }).promise
let text = ''
const words = []

for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
  const page = await pdf.getPage(pageNumber)
  const viewport = page.getViewport({ scale: 1 })
  const content = await page.getTextContent()
  let pageText = ''
  for (const item of content.items) {
    if (!('str' in item) || !item.str.trim()) continue
    const [,,, height, x, y] = item.transform
    pageText += ` ${item.str}`
    words.push({
      text: item.str,
      page: pageNumber,
      x: x / viewport.width * 100,
      y: (viewport.height - y - Math.abs(height)) / viewport.height * 100,
      w: item.width / viewport.width * 100,
      h: Math.max(1, Math.abs(height) / viewport.height * 100),
    })
  }
  text += `\n\n[PAGE ${pageNumber}]\n${pageText.trim()}`
}

const response = await fetch('http://127.0.0.1:8787/api/structure-ddr', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ text, words }),
})
const payload = await response.json()
if (!response.ok) throw new Error(payload.error || `Pipeline failed with ${response.status}`)

console.log(JSON.stringify({
  well: payload.report.well_name,
  coordinates: [payload.report.latitude, payload.report.longitude],
  measuredDepth: payload.report.current_md,
  formation: payload.report.formation,
  events: payload.report.events,
  risks: payload.report.risks,
  offsets: payload.report.offset_wells,
  sections: payload.report.sections.map(({ label, anchor }) => ({ label, anchor })),
  segments: payload.segments,
  embeddingModel: payload.embeddingModel,
  embeddingCount: payload.embeddings.length,
}, null, 2))
