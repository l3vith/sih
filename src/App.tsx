import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, ReactNode } from 'react'
import { Map as MapLibreMap, NavigationControl, Popup, setWorkerUrl, type StyleSpecification } from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import type { FeatureCollection, Point } from 'geojson'
import 'maplibre-gl/dist/maplibre-gl.css'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { createWorker } from 'tesseract.js'
import { pipeline as hfPipeline } from '@huggingface/transformers'

// Vite serves workers as ESM – wire maplibre's worker to avoid
// "blocked because of a disallowed MIME type" in dev (localhost:5173)
setWorkerUrl(maplibreWorkerUrl)
import { Activity, AlertTriangle, ArrowUpRight, Bell, BrainCircuit, ChevronDown, CircleHelp, Crosshair, Database, FileScan, FileText, MapPinned, Maximize2, Menu, Network, PanelLeftClose, Search, Send, Settings2, Sparkles, Upload, X, Zap } from 'lucide-react'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

type View = 'command' | 'documents' | 'embeddings' | 'prediction'
type Segment = { page: number; x: number; y: number; w: number; h: number; label: string; tone: 'cyan' | 'amber' | 'coral' }
type Embedding = { id: string; label: string; excerpt: string; x: number; y: number }
type Event = { time: string | null; type: string; depth: number | null; severity: 'high' | 'medium' | 'low' | null; mitigation: string | null; evidence: string }
type Risk = { label: string; probability: number | null; trend: 'rising' | 'steady' | 'falling' | null; evidence: string }
type OffsetWell = { id: string; latitude: number | null; longitude: number | null; depth: number | null; distance_km: number | null; relationship: string | null }
type Formation = { name: string; top_md: number | null; bottom_md: number | null }
type Section = { label: string; anchor: string; summary: string; evidence?: string }
type Report = {
  well_name: string | null; report_date: string | null; report_number: string | null; latitude: number | null; longitude: number | null;
  current_md: number | null; current_tvd: number | null; formation: string | null; mud_weight: string | null; operator: string | null;
  rig_name: string | null; lease_block: string | null; progress: number | null; avg_rop: number | null; formations: Formation[];
  events: Event[]; risks: Risk[]; offset_wells: OffsetWell[]; sections: Section[];
}
type Analysis = { report: Report; segments: Segment[]; embeddings: Embedding[]; embeddingModel: string; corpus: string; documentVector: number[] | null }
type IndexedDocument = Analysis & { name: string; url: string; pages: number }
type WordBox = { text: string; page: number; x: number; y: number; w: number; h: number; fromOcr?: boolean }

const mapStyle: StyleSpecification = {
  version: 8, sources: {
    'indian-basemap': {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256, maxzoom: 19, attribution: '© Esri — Source India data: Survey of India, NRSC',
    },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#edf7f5' } },
    { id: 'indian-basemap', type: 'raster', source: 'indian-basemap', paint: { 'raster-opacity': 0.85 } },
  ],
}
const value = (input: string | number | null | undefined, suffix = '') => input === null || input === undefined || input === '' ? 'Not found' : `${typeof input === 'number' ? input.toLocaleString() : input}${suffix}`
const isImageFile = (file: File) => file.type.startsWith('image/') || /\.(png|jpe?g|tiff|bmp|webp)$/i.test(file.name)

// --- Combined OCR: Tesseract (fast, bbox) + TrOCR (handwriting) fallback ---
let trocrHandPromise: Promise<any> | null = null
let trocrPrintedPromise: Promise<any> | null = null
async function getTrOCR(handwritten = true): Promise<any> {
  if (handwritten) {
    if (!trocrHandPromise) trocrHandPromise = hfPipeline('image-to-text', 'Xenova/trocr-base-handwritten' as any) as any
    return trocrHandPromise
  }
  if (!trocrPrintedPromise) trocrPrintedPromise = hfPipeline('image-to-text', 'Xenova/trocr-base-printed' as any) as any
  return trocrPrintedPromise
}

type CombinedOCRResult = { text: string; words: Array<{ text: string; bbox: { x0: number; y0: number; x1: number; y1: number }; confidence?: number }>; engine: string; confidence: number }

async function tryGoogleVisionOCR(canvas: HTMLCanvasElement): Promise<string | null> {
  try {
    const dataUrl = canvas.toDataURL('image/png')
    const b64 = dataUrl.split(',')[1]
    if (!b64) return null
    const res = await fetch('/api/vision-ocr', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ imageBase64: b64, mimeType: 'image/png' }),
      signal: AbortSignal.timeout(15000) as any,
    } as any)
    if (!res.ok) return null
    const j: any = await res.json()
    const t = String(j.text || '').trim()
    return t.length > 10 ? t : null
  } catch {
    return null
  }
}

async function recognizeCombined(canvas: HTMLCanvasElement, pageLabel: string, onProgress?: (p: number, m: string) => void): Promise<CombinedOCRResult> {
  // Try Google Vision first (gemma-4-26b-a4b-it has vision) in parallel with Tesseract for bbox
  const worker: any = await (createWorker as any)('eng', 1)
  const tPromise = worker.recognize(canvas) as Promise<any>
  const gPromise = tryGoogleVisionOCR(canvas)

  const tResult: any = await tPromise
  const tData = tResult.data as { text: string; confidence: number; words?: Array<{ text: string; bbox: { x0: number; y0: number; x1: number; y1: number }; confidence: number }> }
  const tText = String(tData.text || '').trim()
  const tWords = (tData.words || []) as Array<{ text: string; bbox: { x0: number; y0: number; x1: number; y1: number }; confidence: number }>
  const tConf = typeof tData.confidence === 'number' ? tData.confidence : (tWords.length ? tWords.reduce((s, w) => s + (w.confidence || 0), 0) / tWords.length : 0)

  // Await Google vision (with timeout already)
  let gText: string | null = null
  try { gText = await gPromise } catch { gText = null }

  // If Google vision gave strong result, prefer it for text (handwriting), keep Tesseract words for bbox
  if (gText && gText.length > 30) {
    const useGoogle = gText.length > tText.length * 1.1 || tConf < 65 || tText.length < 40
    if (useGoogle) {
      await worker.terminate()
      // Keep Tesseract words for segmentation if we have them, else synthesize from Google text
      let finalWords: any[] = tWords
      if (tWords.length < 6) {
        const toks = gText.split(/\s+/).filter(Boolean).slice(0, 80)
        const cols = 8
        const rowH = canvas.height / Math.max(1, Math.ceil(toks.length / cols))
        finalWords = toks.map((tok: string, i: number) => {
          const col = i % cols
          const row = Math.floor(i / cols)
          const x0 = (col / cols) * canvas.width
          const y0 = row * rowH
          const x1 = x0 + Math.max(40, tok.length * 8)
          const y1 = y0 + rowH * 0.6
          return { text: tok, bbox: { x0, y0, x1: Math.min(x1, canvas.width), y1: Math.min(y1, canvas.height) }, confidence: 78 }
        })
      }
      return { text: gText, words: finalWords, engine: 'google-vision', confidence: Math.max(tConf, 80) }
    }
    // Otherwise merge Google text as supplement if it adds new content
    if (gText.length > 40) {
      const tSet = new Set(tText.toLowerCase().split(/\s+/))
      const extra = gText.split(/\s+/).filter((w: string) => !tSet.has(w.toLowerCase())).join(' ').trim()
      if (extra.length > 20) {
        await worker.terminate()
        return { text: tText + ' ' + gText, words: tWords, engine: 'combined-google', confidence: Math.max(tConf, 75) }
      }
    }
  }

  if (tText.length > 60 && tConf > 68 && tWords.length > 8) {
    await worker.terminate()
    return { text: tText, words: tWords, engine: 'tesseract', confidence: tConf }
  }

  if (onProgress) onProgress(0, `TrOCR fallback for ${pageLabel} (Tesseract ${tConf.toFixed(0)}%, ${tWords.length}w)`)
  try {
    let trocr: any
    try { trocr = await getTrOCR(true) } catch { trocr = await getTrOCR(false) }
    const trocrOut: any = await trocr(canvas)
    let trocrText = ''
    if (Array.isArray(trocrOut) && trocrOut[0]?.generated_text) trocrText = String(trocrOut[0].generated_text).trim()
    else if (typeof trocrOut === 'string') trocrText = trocrOut.trim()
    else if (trocrOut?.generated_text) trocrText = String(trocrOut.generated_text).trim()
    else trocrText = String(trocrOut || '').trim()

    let finalText = tText
    let finalWords: any[] = tWords
    let engine = 'tesseract'
    let finalConf = tConf

    if (trocrText && trocrText.length > 20) {
      const useTrOCR = tConf < 62 || trocrText.length > tText.length * 1.15 || (tText.length < 30 && trocrText.length > 30)
      if (useTrOCR) {
        finalText = trocrText
        // If we already have Google text, combine all three
        if (gText && gText.length > 30 && !finalText.includes(gText.slice(0, 20))) finalText = gText + ' ' + trocrText
        else if (gText && gText.length > 30) finalText = gText
        engine = tConf < 50 ? 'trocr' : 'combined'
        finalConf = Math.max(tConf, 72)
        if (tWords.length < 6) {
          const toks = finalText.split(/\s+/).filter(Boolean).slice(0, 80)
          const cols = 8
          const rowH = canvas.height / Math.max(1, Math.ceil(toks.length / cols))
          finalWords = toks.map((tok: string, i: number) => {
            const col = i % cols
            const row = Math.floor(i / cols)
            const x0 = (col / cols) * canvas.width
            const y0 = row * rowH
            const x1 = x0 + Math.max(40, tok.length * 8)
            const y1 = y0 + rowH * 0.6
            return { text: tok, bbox: { x0, y0, x1: Math.min(x1, canvas.width), y1: Math.min(y1, canvas.height) }, confidence: 75 }
          })
        }
      } else if (trocrText.length > 40) {
        const tSet = new Set(tText.toLowerCase().split(/\s+/))
        const extra = trocrText.split(/\s+/).filter((w: string) => !tSet.has(w.toLowerCase())).join(' ').trim()
        if (extra.length > 20) { finalText = tText + ' ' + trocrText; if (gText) finalText += ' ' + gText; engine = 'combined' }
      }
    } else if (gText && gText.length > 30) {
      finalText = gText
      engine = 'google-vision'
      finalConf = 80
    }
    await worker.terminate()
    return { text: finalText, words: finalWords, engine, confidence: finalConf }
  } catch (e) {
    console.warn('[OCR] TrOCR fallback failed, using Tesseract', e)
    await worker.terminate()
    // If Google gave text, use it as last resort
    if (gText && gText.length > 30) return { text: gText, words: tWords.length ? tWords : [], engine: 'google-vision', confidence: 80 }
    return { text: tText, words: tWords, engine: 'tesseract', confidence: tConf }
  }
}

function semanticProjection(vectors: number[][]): { x: number; y: number }[] {
  if (vectors.length === 1) return [{ x: 50, y: 50 }]
  if (vectors.length === 2) {
    // keep slight separation for 2 docs
    const d = Math.hypot(...vectors[0].map((v, i) => v - vectors[1][i])) || 1
    return d < 0.12 ? [{ x: 48, y: 50 }, { x: 52, y: 50 }] : [{ x: 38, y: 50 }, { x: 62, y: 50 }]
  }
  const dim = vectors[0].length
  const mean = Array.from({ length: dim }, (_, di) => vectors.reduce((s, v) => s + v[di], 0) / vectors.length)
  const centered = vectors.map((v) => v.map((val, di) => val - mean[di]))
  const gram = centered.map((a) => centered.map((b) => a.reduce((s, val, di) => s + val * b[di], 0)))
  const power = (matrix: number[][], seed: number) => {
    let vec = matrix.map((_, idx) => Math.sin((idx + 1) * seed) + 0.1)
    for (let it = 0; it < 60; it += 1) {
      const nxt = matrix.map((row) => row.reduce((s, v, col) => s + v * vec[col], 0))
      const norm = Math.hypot(...nxt) || 1
      vec = nxt.map((v) => v / norm)
    }
    const prod = matrix.map((row) => row.reduce((s, v, col) => s + v * vec[col], 0))
    const eigen = vec.reduce((s, v, idx) => s + v * prod[idx], 0)
    return { vector: vec, eigenvalue: Math.max(0, eigen) }
  }
  const first = power(gram, 1.7)
  const deflated = gram.map((row, i) => row.map((v, j) => v - first.eigenvalue * first.vector[i] * first.vector[j]))
  const second = power(deflated, 2.3)
  const raw = vectors.map((_, i) => ({ x: first.vector[i] * Math.sqrt(first.eigenvalue), y: second.vector[i] * Math.sqrt(second.eigenvalue) }))
  const xs = raw.map((p) => p.x); const ys = raw.map((p) => p.y)
  const xMin = Math.min(...xs); const xMax = Math.max(...xs); const yMin = Math.min(...ys); const yMax = Math.max(...ys)
  return raw.map((p) => ({ x: 12 + ((p.x - xMin) / Math.max(0.0001, xMax - xMin)) * 76, y: 12 + ((p.y - yMin) / Math.max(0.0001, yMax - yMin)) * 76 }))
}

function cosine(a: number[], b: number[]) {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1)
}

async function analyseImage(file: File, onProgress: (progress: number, message: string) => void): Promise<{ analysis: Analysis; pages: number }> {
  onProgress(25, 'Running OCR on image document (Tesseract + TrOCR)')
  const imageUrl = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('Failed to load image for OCR.'))
      image.src = imageUrl
    })
    const canvas = window.document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas not available for image OCR.')
    context.drawImage(img, 0, 0)
    const combined = await recognizeCombined(canvas, 'page 1', onProgress)
    const text = `\n\n[PAGE 1]\n${String(combined.text || '').trim()}`
    const words: WordBox[] = (combined.words || []).map((word) => ({ text: word.text, page: 1, x: word.bbox.x0 / canvas.width * 100, y: word.bbox.y0 / canvas.height * 100, w: (word.bbox.x1 - word.bbox.x0) / canvas.width * 100, h: (word.bbox.y1 - word.bbox.y0) / canvas.height * 100, fromOcr: true }))
    if (!text.replace(/\[PAGE \d+\]/g, '').trim()) throw new Error('No readable text was found in this image.')
    onProgress(72, `Sending OCR evidence to Groq for factual structuring (${combined.engine} ${combined.confidence.toFixed(0)}%)`)
    const response = await fetch('/api/structure-ddr', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, words }) })
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.error || 'Document analysis failed.')
    onProgress(100, `Indexed ${payload.report.sections?.length || 0} sections from 1 page via ${combined.engine}`)
    return { analysis: payload as Analysis, pages: 1 }
  } finally {
    URL.revokeObjectURL(imageUrl)
  }
}

async function analysePdf(file: File, onProgress: (progress: number, message: string) => void) {
  const pdf = await getDocument({ data: await file.arrayBuffer() }).promise
  let text = ''
  const words: WordBox[] = []
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()
    let pageText = ''
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue
      const [,,, height, x, y] = item.transform
      pageText += ` ${item.str}`
      words.push({ text: item.str, page: pageNumber, x: x / viewport.width * 100, y: (viewport.height - y - Math.abs(height)) / viewport.height * 100, w: item.width / viewport.width * 100, h: Math.max(1, Math.abs(height) / viewport.height * 100) })
    }
    if (pageText.trim().length < 80) {
      onProgress(Math.round(pageNumber / pdf.numPages * 50), `Running Tesseract+TrOCR on scanned page ${pageNumber} of ${pdf.numPages}`)
      const ocrViewport = page.getViewport({ scale: 1.8 })
      const canvas = window.document.createElement('canvas'); canvas.width = ocrViewport.width; canvas.height = ocrViewport.height
      const context = canvas.getContext('2d')
      if (context) {
        await page.render({ canvas, canvasContext: context, viewport: ocrViewport }).promise
        const combined = await recognizeCombined(canvas, `page ${pageNumber}`)
        pageText = combined.text
        for (const word of combined.words || []) words.push({ text: word.text, page: pageNumber, x: word.bbox.x0 / canvas.width * 100, y: word.bbox.y0 / canvas.height * 100, w: (word.bbox.x1 - word.bbox.x0) / canvas.width * 100, h: (word.bbox.y1 - word.bbox.y0) / canvas.height * 100, fromOcr: true })
      }
    }
    text += `\n\n[PAGE ${pageNumber}]\n${pageText.trim()}`
    onProgress(Math.round(pageNumber / pdf.numPages * 65), `Extracted page ${pageNumber} of ${pdf.numPages}`)
  }
  if (!text.replace(/\[PAGE \d+\]/g, '').trim()) throw new Error('No readable text was found in this document.')
  onProgress(72, 'Sending OCR evidence to Groq for factual structuring')
  const response = await fetch('/api/structure-ddr', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, words }) })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error || 'Document analysis failed.')
  onProgress(100, `Indexed ${payload.report.sections?.length || 0} sections from ${pdf.numPages} pages`)
  return { analysis: payload as Analysis, pages: pdf.numPages }
}

async function analyseDocument(file: File, onProgress: (progress: number, message: string) => void) {
  if (isImageFile(file)) return analyseImage(file, onProgress)
  return analysePdf(file, onProgress)
}

function FieldMap({ report, fullscreen }: { report: Report; fullscreen?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const validOffsets = useMemo(() => report.offset_wells.filter((well) => Number.isFinite(well.latitude) && Number.isFinite(well.longitude)), [report.offset_wells])
  const hasCoords = report.latitude !== null && report.longitude !== null && Number.isFinite(report.latitude) && Number.isFinite(report.longitude)
  const center = useMemo<[number, number] | null>(() => hasCoords ? [report.longitude as number, report.latitude as number] : null, [hasCoords, report.longitude, report.latitude])

  useEffect(() => {
    if (!hasCoords || !center || !containerRef.current) return
    const features: FeatureCollection<Point> = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { id: report.well_name || 'Active well', state: 'active', depth: report.current_md }, geometry: { type: 'Point', coordinates: center } }, ...validOffsets.map((well) => ({ type: 'Feature' as const, properties: { id: well.id, state: 'offset', depth: well.depth }, geometry: { type: 'Point' as const, coordinates: [well.longitude as number, well.latitude as number] } }))] }
    if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }
    const map = new MapLibreMap({ container: containerRef.current, style: mapStyle, center, zoom: 10, minZoom: 4, maxZoom: 15, attributionControl: false, renderWorldCopies: false })
    mapRef.current = map
    map.addControl(new NavigationControl({ showCompass: true }), 'top-right')
    const setupLayers = () => {
      if (map.getSource('document-wells')) return
      if (!map.getSource('document-wells')) map.addSource('document-wells', { type: 'geojson', data: features })
      else (map.getSource('document-wells') as unknown as { setData: (d: unknown) => void }).setData(features)
      if (!map.getLayer('well-points')) {
        map.addLayer({ id: 'well-points', type: 'circle', source: 'document-wells', paint: { 'circle-radius': ['case', ['==', ['get', 'state'], 'active'], 11, 7], 'circle-color': ['case', ['==', ['get', 'state'], 'active'], '#e86b4d', '#55b8b2'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2.5 } })
        map.addLayer({ id: 'well-labels', type: 'symbol', source: 'document-wells', layout: { 'text-field': ['get', 'id'], 'text-offset': [0, 1.5], 'text-size': 11 }, paint: { 'text-color': '#315653', 'text-halo-color': '#fff', 'text-halo-width': 1.3 } })
        map.on('click', 'well-points', (event) => { const feature = event.features?.[0]; if (!feature) return; new Popup({ closeButton: false, offset: 14 }).setLngLat((feature.geometry as Point).coordinates as [number, number]).setHTML(`<strong>${feature.properties?.id}</strong><br>${feature.properties?.depth ? `${Number(feature.properties.depth).toLocaleString()} m` : 'Depth not found'}`).addTo(map) })
      }
      // Ensure the active well is centered and visible
      map.jumpTo({ center, zoom: 10 })
      // Fit offsets if they exist
      if (validOffsets.length) {
        const bounds: [[number, number], [number, number]] = [[center[0], center[1]], [center[0], center[1]]]
        for (const w of validOffsets) { bounds[0][0] = Math.min(bounds[0][0], w.longitude as number); bounds[0][1] = Math.min(bounds[0][1], w.latitude as number); bounds[1][0] = Math.max(bounds[1][0], w.longitude as number); bounds[1][1] = Math.max(bounds[1][1], w.latitude as number) }
        try { map.fitBounds(bounds, { padding: 48, maxZoom: 10, duration: 0 }) } catch { /* */ }
      }
      setTimeout(() => map.resize(), 80)
    }
    map.on('load', setupLayers)
    // If style already loaded (cached), trigger immediately
    if (map.isStyleLoaded()) setTimeout(setupLayers, 0)
    map.on('error', () => { /* tiles may be offline – still show point layer */ if (!map.getSource('document-wells')) setupLayers() })

    const el = containerRef.current
    const observer = new ResizeObserver(() => { map.resize(); if (center) try { map.jumpTo({ center }) } catch { /* */ } })
    observer.observe(el)
    const ro = () => map.resize()
    window.addEventListener('resize', ro)
    // Force a resize after mount – container starts with 0 size before CSS applies
    requestAnimationFrame(() => { map.resize(); if (center) map.jumpTo({ center, zoom: 10 }) })
    setTimeout(() => { map.resize(); if (center) map.jumpTo({ center, zoom: 10 }) }, 250)
    return () => { window.removeEventListener('resize', ro); observer.disconnect(); map.remove(); if (mapRef.current === map) mapRef.current = null }
  }, [hasCoords, center, report.well_name, report.current_md, validOffsets])

  if (!hasCoords || !center) return <div className="map-missing"><MapPinned size={26} /><b>No document coordinates found</b><span>The map will populate only when latitude and longitude are present in the uploaded document.</span></div>
  return <div className={`real-map-wrap ${fullscreen ? 'fullscreen' : ''}`}><div ref={containerRef} className="real-map" style={{ width: '100%', height: '100%' }} /><div className="map-overlay-title">DOCUMENT LOCATIONS <span>• {1 + validOffsets.length} WELLS</span></div><aside className="map-ddr-preview"><b><FileText size={12} /> INDEXED LOCATION</b><span>{report.well_name || 'Well name not found'}</span><small>{report.latitude!.toFixed(6)}, {report.longitude!.toFixed(6)}</small><strong>{value(report.current_md, ' m')} · {report.formation || 'Formation not found'}</strong></aside></div>
}

function PdfViewer({ document }: { document: IndexedDocument }) {
  const canvasRef = useRef<HTMLCanvasElement>(null); const [page, setPage] = useState(1)
  const isImage = /\.(png|jpe?g|webp|tiff|bmp)$/i.test(document.name)
  useEffect(() => {
    if (isImage) return
    let cancelled = false; (async () => { const pdf = await getDocument({ url: document.url }).promise; const current = await pdf.getPage(page); const viewport = current.getViewport({ scale: 1.5 }); const canvas = canvasRef.current; if (!canvas || cancelled) return; const context = canvas.getContext('2d'); if (!context) return; canvas.width = viewport.width; canvas.height = viewport.height; await current.render({ canvas, canvasContext: context, viewport }).promise })().catch(() => undefined); return () => { cancelled = true }
  }, [document.url, page, isImage])
  const segments = document.segments.filter((segment) => segment.page === page)
  if (isImage) return <div className="pdf-canvas-shell"><div className="pdf-page-controls"><span>PAGE 1 OF 1 · IMAGE DOCUMENT</span></div><div className="pdf-page" style={{ display: 'grid', placeItems: 'center', overflow: 'auto' }}><img src={document.url} alt={document.name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />{segments.map((segment, index) => <div key={`${segment.label}-${index}`} className={`seg-box ${segment.tone} visible`} style={{ left: `${segment.x}%`, top: `${segment.y}%`, width: `${segment.w}%`, height: `${segment.h}%` }}><span>{segment.label}</span></div>)}</div></div>
  return <div className="pdf-canvas-shell"><div className="pdf-page-controls"><button disabled={page === 1} onClick={() => setPage((current) => current - 1)}>← Previous</button><span>PAGE {page} OF {document.pages}</span><button disabled={page === document.pages} onClick={() => setPage((current) => current + 1)}>Next →</button></div><div className="pdf-page"><canvas ref={canvasRef} />{segments.map((segment, index) => <div key={`${segment.label}-${index}`} className={`seg-box ${segment.tone} visible`} style={{ left: `${segment.x}%`, top: `${segment.y}%`, width: `${segment.w}%`, height: `${segment.h}%` }}><span>{segment.label}</span></div>)}</div></div>
}

function PanelHeader({ icon, title, meta }: { icon: ReactNode; title: string; meta?: string }) { return <div className="panel-header"><span className="panel-title"><i>{icon}</i>{title}</span>{meta && <span className="panel-meta">{meta}</span>}</div> }
function EmptyWorkspace({ view }: { view: View }) { const copy = view === 'documents' ? 'Upload a DDR, WCR, scan, or mud log to start OCR and factual extraction.' : view === 'embeddings' ? 'Upload and index documents before exploring their text-vector relationships.' : view === 'prediction' ? 'Upload an indexed report before asking evidence-grounded questions.' : 'Upload a drilling document to populate the map, well data, events, risks, and correlations.'; return <section className="empty-workspace"><FileScan size={30} /><h2>No operational data loaded</h2><p>{copy}</p><span>Use <b>Ingest document</b> in the sidebar to begin.</span></section> }

function DocumentPanel({ document, processing, progress, status }: { document: IndexedDocument; processing: boolean; progress: number; status: string }) { return <><PanelHeader icon={<FileScan size={16} />} title="DOCUMENT INTELLIGENCE" meta={processing ? `${progress}%` : 'INDEXED'} /><div className="document-stage"><div className="paper"><PdfViewer document={document} /></div></div><div className="document-footer"><span><i className="live-dot" /> {status}</span><span>{document.segments.length} REGIONS · {document.pages} PAGES</span></div></> }

function DepthPanel({ report }: { report: Report }) {
  const formations = report.formations?.length ? report.formations : report.formation ? [{ name: report.formation, top_md: null, bottom_md: null }] : []
  return <><PanelHeader icon={<Activity size={16} />} title="ACTIVE WELL" meta={report.well_name || 'NAME NOT FOUND'} /><div className="active-depth"><span>MEASURED DEPTH</span><strong>{value(report.current_md, ' m')}</strong><b>{report.formation || 'FORMATION NOT FOUND'}</b></div><div className="extracted-metrics"><span><small>TVD</small><b>{value(report.current_tvd, ' m')}</b></span><span><small>PROGRESS</small><b>{value(report.progress, ' m')}</b></span><span><small>AVG ROP</small><b>{value(report.avg_rop, ' m/h')}</b></span><span><small>MUD WEIGHT</small><b>{value(report.mud_weight)}</b></span></div><div className="formation-list">{formations.length ? formations.map((formation, index) => <div key={`${formation.name}-${index}`}><strong>{formation.name}</strong><span>{formation.top_md === null && formation.bottom_md === null ? 'Depth interval not stated' : `${value(formation.top_md, ' m')} – ${value(formation.bottom_md, ' m')}`}</span></div>) : <p>No formation intervals found in the document.</p>}</div></>
}

function StreamPanel({ document, status }: { document: IndexedDocument; status: string }) {
  const isOrangeSection = (label: string) => {
    const l = label.toLowerCase()
    return l.includes('operation') || l.includes('event') || l.includes('fluid') || l.includes('decision') || l.includes('casing') || l.includes('cement') || l.includes('risk')
  }
  const sectionItems = document.report.sections.map((section) => ({
    title: section.label,
    detail: section.summary || (section.evidence ? section.evidence.slice(0, 110) : 'Section indexed'),
    icon: <Database size={15} />,
    tone: isOrangeSection(section.label) ? 'amber' : 'cyan',
  }))
  const eventItems = document.report.events.map((event) => ({
    title: event.type,
    detail: `${event.time ? event.time + ' · ' : ''}${event.depth === null ? 'Depth not stated' : `${event.depth.toLocaleString()} m`} · ${event.evidence} ${event.severity ? `· ${event.severity}` : ''}`,
    icon: <AlertTriangle size={15} />,
    tone: 'amber',
  }))
  const riskItems = document.report.risks.map((risk) => ({
    title: risk.label,
    detail: `${risk.evidence}${risk.probability !== null ? ` · ${risk.probability}%` : ''} ${risk.trend ? `· ${risk.trend}` : ''}`,
    icon: <AlertTriangle size={15} />,
    tone: 'amber',
  }))
  const offsetItems = document.report.offset_wells.slice(0, 3).map((well) => ({
    title: `Offset ${well.id}`,
    detail: `${well.distance_km !== null ? `${well.distance_km} km` : 'Distance not stated'} · ${well.relationship || 'Nearby well context'}`,
    icon: <MapPinned size={15} />,
    tone: 'cyan',
  }))
  const items = [
    { title: 'PDF + OCR extraction', detail: status, icon: <FileText size={15} />, tone: 'cyan' },
    ...sectionItems,
    ...eventItems,
    ...riskItems,
    ...offsetItems,
  ]
  return <><PanelHeader icon={<Zap size={16} />} title="LIVE PARSING STREAM" meta={`${items.length} ITEMS · DOCUMENT PIPELINE`} /><div className="stream-list" style={{ maxHeight: 420, overflowY: 'auto' }}>{items.map((item, index) => <div className="stream-item" key={`${item.title}-${index}`}><time>NOW</time><span className={`stream-icon ${item.tone}`}>{item.icon}</span><div><strong>{item.title}</strong><span>{item.detail}</span></div><ArrowUpRight size={13} /></div>)}</div></>
}

function RiskRow({ risks, events, openPrediction }: { risks: Risk[]; events: Event[]; openPrediction: () => void }) {
  return <section className="risk-row dynamic-risk-row"><div className="risk-label"><AlertTriangle size={25} /><div><small>DOCUMENT EVIDENCE</small><strong>RISK WATCH</strong></div></div>{risks.length ? risks.slice(0, 4).map((risk) => <button className={`risk-card ${risk.trend === 'rising' ? 'critical' : 'warning'}`} key={risk.label} title={risk.evidence}><div><small>{risk.label}</small><strong>{risk.probability === null ? '—' : `${risk.probability}%`}</strong><span className="risk-trend">TREND&nbsp; <b>{risk.trend || 'NOT STATED'}</b></span></div></button>) : <div className="no-risk-data">No risk probabilities were stated or extracted.</div>}<div className="alerts-card"><div><span className="alert-count">EVENTS ({events.length})</span>{events.slice(0, 2).map((event, index) => <span key={`${event.type}-${index}`}>{event.time || 'Time not stated'} · {event.type}{event.depth === null ? '' : ` @ ${event.depth.toLocaleString()} m`}</span>)}</div><button onClick={openPrediction}>ASK ABOUT EVENTS <ArrowUpRight size={13} /></button></div></section>
}

function EmbeddingPanel({ documents }: { documents: IndexedDocument[] }) {
  const [selectedName, setSelectedName] = useState<string | null>(documents[0]?.name ?? null)
  const vectors = useMemo(() => documents.map((d) => d.documentVector).filter((v): v is number[] => Array.isArray(v) && v.length > 0), [documents])
  const positions = useMemo(() => {
    if (vectors.length === 0) return [] as { x: number; y: number }[]
    if (vectors.length === 1) return [{ x: 50, y: 50 }]
    // if any doc missing vector (null), synthesize fallback hash to keep consistent dims – shouldn't happen after server fix
    const filled = documents.map((d) => d.documentVector ?? Array(vectors[0].length).fill(0))
    // need uniform dim – pad/truncate to first vector's dim
    const dim = vectors[0].length
    const uniform = filled.map((v) => v.slice(0, dim).concat(Array(Math.max(0, dim - v.length)).fill(0)))
    return semanticProjection(uniform)
  }, [documents, vectors])
  const selected = useMemo(() => documents.find((d) => d.name === selectedName) ?? documents[0] ?? null, [documents, selectedName])
  const model = documents[0]?.embeddingModel ?? '—'
  if (documents.length === 0) {
    return <><PanelHeader icon={<Network size={16} />} title="DOCUMENT TEXT VECTOR SPACE" meta="NO SITES INDEXED" /><div className="empty-workspace" style={{ minHeight: 320, border: 'none', background: '#fafaf8' }}><Network size={28} /><h2>No drilling sites indexed</h2><p>Ingest 2+ DDRs/WCRs to see document similarity. Similar sites cluster closer.</p></div></>
  }
  if (documents.length === 1) {
    return <><PanelHeader icon={<Network size={16} />} title="DOCUMENT TEXT VECTOR SPACE" meta={`${model} · 1 SITE`} /><div className="embedding-canvas large-canvas"><div className="embedding-axis horizontal" /><div className="embedding-axis vertical" /><button className="embedding-point coral selected" style={{ left: '50%', top: '50%' }} aria-label={documents[0].report.well_name ?? documents[0].name} onClick={() => setSelectedName(documents[0].name)} /><div className="embedding-tooltip" style={{ left: '58%', top: '57%' }}><strong>{documents[0].report.well_name ?? documents[0].name}</strong><span>{documents[0].report.formation ?? 'Formation not stated'} · {value(documents[0].report.current_md, ' m')} · {documents[0].report.sections.length} sections</span><small>Upload another document to see distance.</small></div></div></>
  }
  return <><PanelHeader icon={<Network size={16} />} title="DOCUMENT TEXT VECTOR SPACE" meta={`${model} · ${documents.length} SITES`} /><div className="embedding-canvas large-canvas"><div className="embedding-axis horizontal" /><div className="embedding-axis vertical" />{documents.map((doc, idx) => {
    const pos = positions[idx] ?? { x: 50, y: 50 }
    const isSel = doc.name === selected?.name
    const tone = doc.report.formation?.toLowerCase().includes('barail') ? 'coral' : doc.report.formation?.toLowerCase().includes('tipam') ? 'amber' : 'cyan'
    return <button key={doc.name} className={`embedding-point ${tone} ${isSel ? 'selected' : ''}`} style={{ left: `${pos.x}%`, top: `${pos.y}%` }} onClick={() => setSelectedName(doc.name)} aria-label={doc.report.well_name ?? doc.name} title={`${doc.report.well_name ?? doc.name} – ${doc.report.formation ?? ''}`} />
  })}{selected && (() => {
    const selIdx = documents.findIndex((d) => d.name === selected.name)
    const sims = documents.filter((d) => d.name !== selected.name).map((d) => ({ name: d.report.well_name ?? d.name, score: cosine(selected.documentVector ?? [], d.documentVector ?? []) })).sort((a, b) => b.score - a.score).slice(0, 2)
    return <div className="embedding-tooltip"><strong>{selected.report.well_name ?? selected.name}</strong><span>{selected.report.formation ?? 'Formation not found'} · {value(selected.report.current_md, ' m')} · {selected.report.events.length} events</span><small style={{ display: 'block', marginTop: 6, color: '#7a8a87' }}>{sims.length ? `Closest: ${sims.map((s) => `${s.name} (${(s.score * 100).toFixed(1)}%)`).join(' · ')}` : 'No comparison'}</small></div>
  })()}<div style={{ position: 'absolute', left: 10, bottom: 8, fontSize: 7, color: '#a0a6a2', letterSpacing: '.06em', fontWeight: 800 }}>CLOSER = MORE SIMILAR (COSINE)</div></div></>
}

function PredictionPanel({ document, question, setQuestion }: { document: IndexedDocument; question: string; setQuestion: (value: string) => void }) {
  const [answer, setAnswer] = useState(''); const [asking, setAsking] = useState(false)
  async function ask(event: FormEvent) { event.preventDefault(); if (!question.trim()) return; setAsking(true); setAnswer(''); try { const response = await fetch('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question, corpus: document.corpus }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error); setAnswer(payload.answer) } catch (error) { setAnswer(error instanceof Error ? error.message : 'Ask NWIS failed.') } finally { setAsking(false) } }
  return <><PanelHeader icon={<Sparkles size={16} />} title="ASK NWIS" meta="UPLOADED DOCUMENTS ONLY" />{answer ? <div className="prediction-result"><div className="prediction-result-head"><span className="result-chip"><BrainCircuit size={13} /> GROQ ANALYSIS</span><button onClick={() => setAnswer('')} aria-label="Close answer"><X size={14} /></button></div><h3>{question}</h3><p className="ai-answer">{answer}</p></div> : <><p className="prediction-intro">Ask a drilling question. The response is constrained to the currently uploaded document.</p><form className="ask-form" onSubmit={ask}><textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about a depth, event, formation, mud property, or operational decision…" /><button type="submit" disabled={asking}><Send size={15} /> {asking ? 'ANALYSING…' : 'ASK NWIS'}</button></form></>}</>
}

export default function App() {
  const [view, setView] = useState<View>('command'); const [sidebarOpen, setSidebarOpen] = useState(true); const [documents, setDocuments] = useState<IndexedDocument[]>([]); const [activeName, setActiveName] = useState<string | null>(null); const [processing, setProcessing] = useState(false); const [progress, setProgress] = useState(0); const [status, setStatus] = useState('No document indexed'); const [error, setError] = useState(''); const [question, setQuestion] = useState(''); const [dragOver, setDragOver] = useState(false); const [fullscreen, setFullscreen] = useState(false)
  const documentUrlMapRef = useRef<Map<string, string>>(new Map())
  const document = useMemo(() => documents.find((d) => d.name === activeName) ?? documents[documents.length - 1] ?? null, [documents, activeName])
  useEffect(() => () => { for (const url of documentUrlMapRef.current.values()) URL.revokeObjectURL(url) }, [])
  function toggleFullscreen() { if (!window.document.fullscreenElement) { window.document.documentElement.requestFullscreen?.() } else { window.document.exitFullscreen?.() }; setFullscreen((v) => !v) }
  useEffect(() => { function handleFullscreenChange() { setFullscreen(!!window.document.fullscreenElement) }; window.document.addEventListener('fullscreenchange', handleFullscreenChange); return () => window.document.removeEventListener('fullscreenchange', handleFullscreenChange) }, [])
  async function ingestFile(file: File) {
    // allow re-ingesting same name: replace existing entry
    setProcessing(true); setProgress(1); setError(''); setStatus(`Opening ${file.name}`); setView('documents')
    try {
      const { analysis, pages } = await analyseDocument(file, (nextProgress, nextStatus) => { setProgress(nextProgress); setStatus(nextStatus) })
      const url = URL.createObjectURL(file)
      // revoke previous url for same name if exists
      const prev = documentUrlMapRef.current.get(file.name); if (prev) URL.revokeObjectURL(prev)
      documentUrlMapRef.current.set(file.name, url)
      const next: IndexedDocument = { ...analysis, name: file.name, url, pages }
      setDocuments((prevDocs) => {
        const others = prevDocs.filter((d) => d.name !== file.name)
        return [...others, next]
      })
      setActiveName(file.name)
      setStatus(`Indexed ${analysis.report.sections.length} factual sections from ${pages} pages`)
    } catch (uploadError) { setError(uploadError instanceof Error ? uploadError.message : 'Document processing failed.'); setStatus('Document processing failed') } finally { setProcessing(false) }
  }
  async function handleUpload(event: ChangeEvent<HTMLInputElement>) { const files = event.target.files; if (!files || !files.length) return; await ingestFiles(files); event.target.value = '' }
  // multi-file drag support
  async function ingestFiles(files: FileList | File[]) {
    for (const f of Array.from(files)) { // sequential to avoid Groq rate
      // eslint-disable-next-line no-await-in-loop
      await ingestFile(f)
    }
  }
  const report = document?.report
  const navItems: [View, ReactNode, string][] = [['command', <Crosshair size={17} />, 'Command Center'], ['documents', <FileScan size={17} />, 'Documents'], ['embeddings', <Network size={17} />, 'Embedding Explorer'], ['prediction', <BrainCircuit size={17} />, 'Prediction Mode']]
  function renderView() {
    if (documents.length === 0) return <EmptyWorkspace view={view} />
    if (!document || !report) return <EmptyWorkspace view={view} />
    if (view === 'documents') return <div className="view-grid documents-view"><div className="panel document-panel"><DocumentPanel document={document} processing={processing} progress={progress} status={status} /></div><div className="panel activity-panel"><StreamPanel document={document} status={status} /></div></div>
    if (view === 'embeddings') {
      const activeDoc = document
      return <div className="view-grid embeddings-view"><div className="panel embeddings-panel"><EmbeddingPanel documents={documents} /></div><div className="panel panel-copy"><PanelHeader icon={<MapPinned size={16} />} title="DRILLING SITES" meta={`${documents.length} SITES INDEXED`} /><h2>{activeDoc.report.well_name ?? activeDoc.name}</h2><p>{activeDoc.report.lease_block ?? 'No lease/block'} · {activeDoc.report.formation ?? 'Formation not stated'} · Click a point to switch active site. Similar sites cluster closer.</p><div className="linked-well-list">{documents.map((doc) => {
        const isActive = doc.name === activeDoc.name
        return <button key={doc.name} className={isActive ? 'selected' : ''} onClick={() => setActiveName(doc.name)}><span>{doc.report.well_name ?? doc.name}</span><small>{value(doc.report.current_md, ' m')} · {doc.report.formation ?? '—'} · {doc.report.lease_block ?? ''}</small><ArrowUpRight size={14} /></button>
      })}</div><p style={{ margin: '10px 17px', fontSize: 8, color: '#9a9e9c' }}>{documents[0]?.embeddingModel ?? ''} · cosine similarity · semanticProjection (PCA Gram)</p></div></div>
    }
    if (view === 'prediction') return <div className="view-grid prediction-view"><div className="panel prediction-panel large"><PredictionPanel document={document} question={question} setQuestion={setQuestion} /></div><div className="panel panel-copy"><PanelHeader icon={<Bell size={16} />} title="EXTRACTED EVENTS" meta={`${report.events.length} FOUND`} /><div className="alert-log">{report.events.length ? report.events.map((event, index) => <span key={`${event.type}-${index}`}><b>{event.time || '—'}</b>{event.type}{event.depth === null ? '' : ` · ${event.depth.toLocaleString()} m`}</span>) : <span>No operational events found.</span>}</div></div></div>
    return <><div className="hero-grid"><div className={`panel map-panel ${fullscreen ? 'map-panel-fullscreen' : ''}`}><PanelHeader icon={<MapPinned size={16} />} title="DOCUMENT WELL LOCATIONS" meta={report.latitude === null || report.longitude === null ? 'COORDINATES NOT FOUND' : `${1 + report.offset_wells.filter((well) => well.latitude !== null && well.longitude !== null).length} MAPPED`} /><div className="map-toolbar"><span style={{ flex: 1 }} /><button className="icon-button" aria-label="Toggle fullscreen" onClick={toggleFullscreen}>{fullscreen ? <X size={15} /> : <Maximize2 size={15} />}</button></div><FieldMap report={report} fullscreen={fullscreen} /></div><div className="panel depth-panel"><DepthPanel report={report} /></div><div className="panel document-panel"><DocumentPanel document={document} processing={processing} progress={progress} status={status} /></div></div><RiskRow risks={report.risks || []} events={report.events || []} openPrediction={() => setView('prediction')} /><div className="lower-grid"><div className="panel activity-panel"><StreamPanel document={document} status={status} /></div><div className="panel prediction-panel"><PredictionPanel document={document} question={question} setQuestion={setQuestion} /></div></div></>
  }
  const heading = view === 'command' ? 'Operational evidence from uploaded documents.' : view === 'documents' ? 'Make every report searchable.' : view === 'embeddings' ? 'Explore this document’s evidence.' : 'Ask against indexed evidence.'
  function onDragOver(event: React.DragEvent) { event.preventDefault(); if (!dragOver) setDragOver(true) }
  function onDragLeave(event: React.DragEvent) { if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node)) setDragOver(false) }
  async function onDrop(event: React.DragEvent) { event.preventDefault(); setDragOver(false); const files = event.dataTransfer.files; if (files && files.length) await ingestFiles(files) }
  return <div className={`app-shell ${sidebarOpen ? '' : 'sidebar-collapsed'}` + (dragOver ? ' drag-active' : '')} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}><header className="topbar"><button className="sidebar-toggle" onClick={() => setSidebarOpen((open) => !open)} aria-label={sidebarOpen ? 'Collapse navigation' : 'Open navigation'}>{sidebarOpen ? <PanelLeftClose size={18} /> : <Menu size={18} />}</button><div className="brand-lockup"><div className="brand-mark">N°</div><div><div className="brand-title">NWIS</div><div className="brand-subtitle">NEARBY WELLS INTELLIGENCE</div></div></div><div className="top-search"><Search size={15} /><span>Search indexed document evidence…</span></div><div className="top-actions"><span className="online-pill"><i /> {processing ? `PROCESSING ${progress}%` : documents.length ? `${documents.length} SITE(S) INDEXED` : 'AWAITING DOCUMENT'}</span><button aria-label="Notifications"><Bell size={17} /></button><button aria-label="Settings"><Settings2 size={17} /></button></div></header><div className="app-layout"><aside className="sidebar"><div className="sidebar-top"><span>WORKSPACE</span><button onClick={() => setSidebarOpen(false)} aria-label="Collapse sidebar"><PanelLeftClose size={15} /></button></div><nav>{navItems.map(([id, icon, label]) => <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}>{icon}<span>{label}</span></button>)}</nav><div className="sidebar-section"><span>ACTIVE WELL</span><button className="well-switch" onClick={() => setView('embeddings')}><strong>{report?.well_name || 'No well indexed'}</strong><small>{report ? `${report.formation || 'Formation not found'} · ${value(report.current_md, ' m')} · ${documents.length} site(s)` : 'Upload drilling documents'} </small><ChevronDown size={14} /></button>{documents.length > 1 && <div style={{ display: 'grid', gap: 4, marginTop: 6, maxHeight: 132, overflowY: 'auto' }}>{documents.map((doc) => <button key={doc.name} onClick={() => setActiveName(doc.name)} style={{ textAlign: 'left', padding: '6px 8px', borderRadius: 7, border: activeName===doc.name || (!activeName && doc.name===document?.name) ? '1px solid #f0c1b4' : '1px solid var(--line)', background: activeName===doc.name || (!activeName && doc.name===document?.name) ? 'var(--coral-soft)' : 'white', fontSize: 9 }}><strong style={{ display:'block', fontSize: 9 }}>{doc.report.well_name ?? doc.name}</strong><small style={{ color: '#8a8c89' }}>{doc.report.formation ?? '—'} · {value(doc.report.current_md, ' m')}</small></button>)}</div>}</div><div className="sidebar-section"><span>QUICK ACTIONS</span><label className="sidebar-upload" title="Select a PDF or image drilling report"><Upload size={15} /> Ingest document(s)<input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.tiff,.bmp,.webp" onChange={handleUpload} /></label><button disabled={!document} onClick={() => setView('prediction')}><Sparkles size={15} /> Ask NWIS</button></div><div className="sidebar-foot"><span><i className="online-dot" /> {processing ? status : document ? 'Index ready' : 'No dataset loaded'}</span><small>{document?.name || 'NO DOCUMENT'}</small></div></aside><main className="main-content"><div className="page-heading"><div><span className="eyebrow">{view === 'command' ? 'FIELD OVERVIEW' : view === 'documents' ? 'DOCUMENT INTELLIGENCE' : view === 'embeddings' ? 'EVIDENCE GRAPH' : 'DECISION SUPPORT'}</span><h1>{heading}</h1></div><span className="date-stamp">{report?.report_date || 'DATE NOT FOUND'}{report?.report_number ? ` / ${report.report_number}` : ''}</span></div>{error && <div className="pipeline-error"><AlertTriangle size={15} />{error}</div>}<div className="workspace">{renderView()}</div></main></div>{dragOver && <div className="drag-overlay"><Upload size={22} /><span>Drop DDRs / WCRs to ingest (multi)</span></div>}<div className="status-footer"><span><i className="online-dot" /> {processing ? status : document ? 'INDEXED FROM UPLOADED DOCUMENT' : 'AWAITING UPLOAD'}</span><span><FileText size={12} /> {document?.name || 'No document indexed'}</span><span>{document ? `${document.report.sections.length} sections · ${document.report.events.length} events · ${document.embeddings.length} vectors` : 'No operational data loaded'}</span><CircleHelp size={13} /></div></div>
}
