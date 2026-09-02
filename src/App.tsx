import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, ReactNode } from 'react'
import { Map as MapLibreMap, NavigationControl, Popup, setWorkerUrl, type StyleSpecification } from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import type { FeatureCollection, Point } from 'geojson'
import 'maplibre-gl/dist/maplibre-gl.css'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { createWorker } from 'tesseract.js'

// Vite serves workers as ESM – wire maplibre's worker to avoid
// "blocked because of a disallowed MIME type" in dev (localhost:5173)
setWorkerUrl(maplibreWorkerUrl)
import { Activity, AlertTriangle, ArrowUpRight, Bell, BrainCircuit, ChevronDown, CircleHelp, Crosshair, Database, FileScan, FileText, MapPinned, Menu, Network, PanelLeftClose, Search, Send, Settings2, Sparkles, Upload, X, Zap } from 'lucide-react'

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
type Analysis = { report: Report; segments: Segment[]; embeddings: Embedding[]; embeddingModel: string; corpus: string }
type IndexedDocument = Analysis & { name: string; url: string; pages: number }
type WordBox = { text: string; page: number; x: number; y: number; w: number; h: number }

const mapStyle: StyleSpecification = { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#edf7f5' } }] }
const value = (input: string | number | null | undefined, suffix = '') => input === null || input === undefined || input === '' ? 'Not found' : `${typeof input === 'number' ? input.toLocaleString() : input}${suffix}`
const isImageFile = (file: File) => file.type.startsWith('image/') || /\.(png|jpe?g|tiff|bmp|webp)$/i.test(file.name)

async function analyseImage(file: File, onProgress: (progress: number, message: string) => void): Promise<{ analysis: Analysis; pages: number }> {
  onProgress(25, 'Running OCR on image document')
  const worker = await createWorker('eng')
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
    const result = await worker.recognize(canvas)
    const data = result.data as unknown as { text: string; words?: Array<{ text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }> }
    const text = `\n\n[PAGE 1]\n${String(data.text || '').trim()}`
    const words: WordBox[] = (data.words || []).map((word) => ({ text: word.text, page: 1, x: word.bbox.x0 / canvas.width * 100, y: word.bbox.y0 / canvas.height * 100, w: (word.bbox.x1 - word.bbox.x0) / canvas.width * 100, h: (word.bbox.y1 - word.bbox.y0) / canvas.height * 100 }))
    if (!text.replace(/\[PAGE \d+\]/g, '').trim()) throw new Error('No readable text was found in this image.')
    onProgress(72, 'Sending OCR evidence to Groq for factual structuring')
    const response = await fetch('/api/structure-ddr', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, words }) })
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.error || 'Document analysis failed.')
    onProgress(100, `Indexed ${payload.report.sections?.length || 0} sections from 1 page`)
    return { analysis: payload as Analysis, pages: 1 }
  } finally {
    URL.revokeObjectURL(imageUrl)
    await worker.terminate()
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
      onProgress(Math.round(pageNumber / pdf.numPages * 55), `Running OCR on scanned page ${pageNumber} of ${pdf.numPages}`)
      const ocrViewport = page.getViewport({ scale: 1.8 })
      const canvas = window.document.createElement('canvas'); canvas.width = ocrViewport.width; canvas.height = ocrViewport.height
      const context = canvas.getContext('2d')
      if (context) {
        await page.render({ canvas, canvasContext: context, viewport: ocrViewport }).promise
        const worker = await createWorker('eng')
        const result = await worker.recognize(canvas)
        const data = result.data as unknown as { text: string; words?: Array<{ text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }> }
        pageText = data.text
        for (const word of data.words || []) words.push({ text: word.text, page: pageNumber, x: word.bbox.x0 / canvas.width * 100, y: word.bbox.y0 / canvas.height * 100, w: (word.bbox.x1 - word.bbox.x0) / canvas.width * 100, h: (word.bbox.y1 - word.bbox.y0) / canvas.height * 100 })
        await worker.terminate()
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

function FieldMap({ report }: { report: Report }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const validOffsets = useMemo(() => report.offset_wells.filter((well) => Number.isFinite(well.latitude) && Number.isFinite(well.longitude)), [report.offset_wells])
  const hasCoords = report.latitude !== null && report.longitude !== null && Number.isFinite(report.latitude) && Number.isFinite(report.longitude)
  const center = useMemo<[number, number] | null>(() => hasCoords ? [report.longitude as number, report.latitude as number] : null, [hasCoords, report.longitude, report.latitude])

  useEffect(() => {
    if (!hasCoords || !center || !containerRef.current) return
    const features: FeatureCollection<Point> = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { id: report.well_name || 'Active well', state: 'active', depth: report.current_md }, geometry: { type: 'Point', coordinates: center } }, ...validOffsets.map((well) => ({ type: 'Feature' as const, properties: { id: well.id, state: 'offset', depth: well.depth }, geometry: { type: 'Point' as const, coordinates: [well.longitude as number, well.latitude as number] } }))] }
    if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }
    const map = new MapLibreMap({ container: containerRef.current, style: mapStyle, center, zoom: 10, attributionControl: false })
    mapRef.current = map
    map.addControl(new NavigationControl({ showCompass: true }), 'top-right')
    const setupLayers = () => {
      if (map.getSource('osm')) return
      try { map.addSource('osm', { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap contributors' }) } catch { /* ignore if already added */ }
      if (!map.getLayer('osm')) { try { map.addLayer({ id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-opacity': .48, 'raster-saturation': -.55 } }) } catch { /* */ } }
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
  return <div className="real-map-wrap"><div ref={containerRef} className="real-map" style={{ width: '100%', height: '100%' }} /><div className="map-overlay-title">DOCUMENT LOCATIONS <span>• {1 + validOffsets.length} WELLS</span></div><aside className="map-ddr-preview"><b><FileText size={12} /> INDEXED LOCATION</b><span>{report.well_name || 'Well name not found'}</span><small>{report.latitude!.toFixed(6)}, {report.longitude!.toFixed(6)}</small><strong>{value(report.current_md, ' m')} · {report.formation || 'Formation not found'}</strong></aside></div>
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
  const items = [{ title: 'PDF + OCR extraction', detail: status, icon: <FileText size={15} />, tone: 'cyan' }, ...document.report.sections.slice(0, 2).map((section) => ({ title: section.label, detail: section.summary || 'Section indexed', icon: <Database size={15} />, tone: 'cyan' })), ...document.report.events.slice(0, 2).map((event) => ({ title: event.type, detail: `${event.depth === null ? 'Depth not stated' : `${event.depth.toLocaleString()} m`} · ${event.evidence}`, icon: <AlertTriangle size={15} />, tone: 'amber' }))]
  return <><PanelHeader icon={<Zap size={16} />} title="LIVE PARSING STREAM" meta="DOCUMENT PIPELINE" /><div className="stream-list">{items.map((item, index) => <div className="stream-item" key={`${item.title}-${index}`}><time>NOW</time><span className={`stream-icon ${item.tone}`}>{item.icon}</span><div><strong>{item.title}</strong><span>{item.detail}</span></div><ArrowUpRight size={13} /></div>)}</div></>
}

function RiskRow({ risks, events, openPrediction }: { risks: Risk[]; events: Event[]; openPrediction: () => void }) {
  return <section className="risk-row dynamic-risk-row"><div className="risk-label"><AlertTriangle size={25} /><div><small>DOCUMENT EVIDENCE</small><strong>RISK WATCH</strong></div></div>{risks.length ? risks.slice(0, 4).map((risk) => <button className={`risk-card ${risk.trend === 'rising' ? 'critical' : 'warning'}`} key={risk.label} title={risk.evidence}><div><small>{risk.label}</small><strong>{risk.probability === null ? '—' : `${risk.probability}%`}</strong><span className="risk-trend">TREND&nbsp; <b>{risk.trend || 'NOT STATED'}</b></span></div></button>) : <div className="no-risk-data">No risk probabilities were stated or extracted.</div>}<div className="alerts-card"><div><span className="alert-count">EVENTS ({events.length})</span>{events.slice(0, 2).map((event, index) => <span key={`${event.type}-${index}`}>{event.time || 'Time not stated'} · {event.type}{event.depth === null ? '' : ` @ ${event.depth.toLocaleString()} m`}</span>)}</div><button onClick={openPrediction}>ASK ABOUT EVENTS <ArrowUpRight size={13} /></button></div></section>
}

function EmbeddingPanel({ embeddings, model }: { embeddings: Embedding[]; model: string }) {
  const [selected, setSelected] = useState<Embedding | null>(embeddings[0] || null)
  return <><PanelHeader icon={<Network size={16} />} title="DOCUMENT TEXT VECTOR SPACE" meta={`${model} · ${embeddings.length} CHUNKS`} /><div className="embedding-canvas large-canvas"><div className="embedding-axis horizontal" /><div className="embedding-axis vertical" />{embeddings.map((point, index) => <button key={point.id} className={`embedding-point ${index % 3 === 0 ? 'coral' : index % 3 === 1 ? 'cyan' : 'amber'} ${selected?.id === point.id ? 'selected' : ''}`} style={{ left: `${point.x}%`, top: `${point.y}%` }} onClick={() => setSelected(point)} aria-label={point.label} />)}{selected && <div className="embedding-tooltip"><strong>{selected.label}</strong><span>{selected.excerpt}</span></div>}</div></>
}

function PredictionPanel({ document, question, setQuestion }: { document: IndexedDocument; question: string; setQuestion: (value: string) => void }) {
  const [answer, setAnswer] = useState(''); const [asking, setAsking] = useState(false)
  async function ask(event: FormEvent) { event.preventDefault(); if (!question.trim()) return; setAsking(true); setAnswer(''); try { const response = await fetch('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question, corpus: document.corpus }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error); setAnswer(payload.answer) } catch (error) { setAnswer(error instanceof Error ? error.message : 'Ask NWIS failed.') } finally { setAsking(false) } }
  return <><PanelHeader icon={<Sparkles size={16} />} title="ASK NWIS" meta="UPLOADED DOCUMENTS ONLY" />{answer ? <div className="prediction-result"><div className="prediction-result-head"><span className="result-chip"><BrainCircuit size={13} /> GROQ ANALYSIS</span><button onClick={() => setAnswer('')} aria-label="Close answer"><X size={14} /></button></div><h3>{question}</h3><p className="ai-answer">{answer}</p></div> : <><p className="prediction-intro">Ask a drilling question. The response is constrained to the currently uploaded document.</p><form className="ask-form" onSubmit={ask}><textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about a depth, event, formation, mud property, or operational decision…" /><button type="submit" disabled={asking}><Send size={15} /> {asking ? 'ANALYSING…' : 'ASK NWIS'}</button></form></>}</>
}

export default function App() {
  const [view, setView] = useState<View>('command'); const [sidebarOpen, setSidebarOpen] = useState(true); const [document, setDocument] = useState<IndexedDocument | null>(null); const [processing, setProcessing] = useState(false); const [progress, setProgress] = useState(0); const [status, setStatus] = useState('No document indexed'); const [error, setError] = useState(''); const [question, setQuestion] = useState(''); const [dragOver, setDragOver] = useState(false)
  const documentUrlRef = useRef<string | null>(null)
  useEffect(() => () => { if (documentUrlRef.current) URL.revokeObjectURL(documentUrlRef.current) }, [])
  async function ingestFile(file: File) {
    if (documentUrlRef.current) { URL.revokeObjectURL(documentUrlRef.current); documentUrlRef.current = null }
    setProcessing(true); setProgress(1); setError(''); setStatus(`Opening ${file.name}`); setView('documents')
    try {
      const { analysis, pages } = await analyseDocument(file, (nextProgress, nextStatus) => { setProgress(nextProgress); setStatus(nextStatus) })
      const url = URL.createObjectURL(file)
      documentUrlRef.current = url
      setDocument({ ...analysis, name: file.name, url, pages }); setStatus(`Indexed ${analysis.report.sections.length} factual sections from ${pages} pages`)
    } catch (uploadError) { setDocument(null); setError(uploadError instanceof Error ? uploadError.message : 'Document processing failed.'); setStatus('Document processing failed') } finally { setProcessing(false) }
  }
  async function handleUpload(event: ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; if (!file) return; await ingestFile(file); event.target.value = '' }
  const report = document?.report
  const navItems: [View, ReactNode, string][] = [['command', <Crosshair size={17} />, 'Command Center'], ['documents', <FileScan size={17} />, 'Documents'], ['embeddings', <Network size={17} />, 'Embedding Explorer'], ['prediction', <BrainCircuit size={17} />, 'Prediction Mode']]
  function renderView() {
    if (!document || !report) return <EmptyWorkspace view={view} />
    if (view === 'documents') return <div className="view-grid documents-view"><div className="panel document-panel"><DocumentPanel document={document} processing={processing} progress={progress} status={status} /></div><div className="panel activity-panel"><StreamPanel document={document} status={status} /></div></div>
    if (view === 'embeddings') return <div className="view-grid embeddings-view"><div className="panel embeddings-panel"><EmbeddingPanel embeddings={document.embeddings} model={document.embeddingModel} /></div><div className="panel panel-copy"><PanelHeader icon={<MapPinned size={16} />} title="DOCUMENT WELL CONTEXT" meta={`${report.offset_wells.length} OFFSET REFERENCES`} /><h2>{report.well_name || 'Well name not found'}</h2><p>{report.lease_block || 'No lease or block was found in the document.'}</p><div className="linked-well-list">{report.offset_wells.length ? report.offset_wells.map((well) => <button key={well.id}><span>{well.id}</span><small>{value(well.depth, ' m')} · {value(well.distance_km, ' km')}</small><ArrowUpRight size={14} /></button>) : <p>No offset wells were explicitly identified.</p>}</div></div></div>
    if (view === 'prediction') return <div className="view-grid prediction-view"><div className="panel prediction-panel large"><PredictionPanel document={document} question={question} setQuestion={setQuestion} /></div><div className="panel panel-copy"><PanelHeader icon={<Bell size={16} />} title="EXTRACTED EVENTS" meta={`${report.events.length} FOUND`} /><div className="alert-log">{report.events.length ? report.events.map((event, index) => <span key={`${event.type}-${index}`}><b>{event.time || '—'}</b>{event.type}{event.depth === null ? '' : ` · ${event.depth.toLocaleString()} m`}</span>) : <span>No operational events found.</span>}</div></div></div>
    return <><div className="hero-grid"><div className="panel map-panel"><PanelHeader icon={<MapPinned size={16} />} title="DOCUMENT WELL LOCATIONS" meta={report.latitude === null || report.longitude === null ? 'COORDINATES NOT FOUND' : `${1 + report.offset_wells.filter((well) => well.latitude !== null && well.longitude !== null).length} MAPPED`} /><FieldMap report={report} /></div><div className="panel depth-panel"><DepthPanel report={report} /></div><div className="panel document-panel"><DocumentPanel document={document} processing={processing} progress={progress} status={status} /></div></div><RiskRow risks={report.risks || []} events={report.events || []} openPrediction={() => setView('prediction')} /><div className="lower-grid"><div className="panel activity-panel"><StreamPanel document={document} status={status} /></div><div className="panel prediction-panel"><PredictionPanel document={document} question={question} setQuestion={setQuestion} /></div></div></>
  }
  const heading = view === 'command' ? 'Operational evidence from uploaded documents.' : view === 'documents' ? 'Make every report searchable.' : view === 'embeddings' ? 'Explore this document’s evidence.' : 'Ask against indexed evidence.'
  function onDragOver(event: React.DragEvent) { event.preventDefault(); if (!dragOver) setDragOver(true) }
  function onDragLeave(event: React.DragEvent) { if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node)) setDragOver(false) }
  async function onDrop(event: React.DragEvent) { event.preventDefault(); setDragOver(false); const file = event.dataTransfer.files?.[0]; if (file) await ingestFile(file) }
  return <div className={`app-shell ${sidebarOpen ? '' : 'sidebar-collapsed'}` + (dragOver ? ' drag-active' : '')} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}><header className="topbar"><button className="sidebar-toggle" onClick={() => setSidebarOpen((open) => !open)} aria-label={sidebarOpen ? 'Collapse navigation' : 'Open navigation'}>{sidebarOpen ? <PanelLeftClose size={18} /> : <Menu size={18} />}</button><div className="brand-lockup"><div className="brand-mark">N°</div><div><div className="brand-title">NWIS</div><div className="brand-subtitle">NEARBY WELLS INTELLIGENCE</div></div></div><div className="top-search"><Search size={15} /><span>Search indexed document evidence…</span></div><div className="top-actions"><span className="online-pill"><i /> {processing ? `PROCESSING ${progress}%` : document ? 'DOCUMENT INDEXED' : 'AWAITING DOCUMENT'}</span><button aria-label="Notifications"><Bell size={17} /></button><button aria-label="Settings"><Settings2 size={17} /></button></div></header><div className="app-layout"><aside className="sidebar"><div className="sidebar-top"><span>WORKSPACE</span><button onClick={() => setSidebarOpen(false)} aria-label="Collapse sidebar"><PanelLeftClose size={15} /></button></div><nav>{navItems.map(([id, icon, label]) => <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}>{icon}<span>{label}</span></button>)}</nav><div className="sidebar-section"><span>ACTIVE WELL</span><button className="well-switch"><strong>{report?.well_name || 'No well indexed'}</strong><small>{report ? `${report.formation || 'Formation not found'} · ${value(report.current_md, ' m')}` : 'Upload a drilling document'}</small><ChevronDown size={14} /></button></div><div className="sidebar-section"><span>QUICK ACTIONS</span><label className="sidebar-upload" title="Select a PDF or image drilling report"><Upload size={15} /> Ingest document<input type="file" accept=".pdf,.png,.jpg,.jpeg,.tiff,.bmp,.webp" onChange={handleUpload} /></label><button disabled={!document} onClick={() => setView('prediction')}><Sparkles size={15} /> Ask NWIS</button></div><div className="sidebar-foot"><span><i className="online-dot" /> {processing ? status : document ? 'Index ready' : 'No dataset loaded'}</span><small>{document?.name || 'NO DOCUMENT'}</small></div></aside><main className="main-content"><div className="page-heading"><div><span className="eyebrow">{view === 'command' ? 'FIELD OVERVIEW' : view === 'documents' ? 'DOCUMENT INTELLIGENCE' : view === 'embeddings' ? 'EVIDENCE GRAPH' : 'DECISION SUPPORT'}</span><h1>{heading}</h1></div><span className="date-stamp">{report?.report_date || 'DATE NOT FOUND'}{report?.report_number ? ` / ${report.report_number}` : ''}</span></div>{error && <div className="pipeline-error"><AlertTriangle size={15} />{error}</div>}<div className="workspace">{renderView()}</div></main></div>{dragOver && <div className="drag-overlay"><Upload size={22} /><span>Drop DDR / WCR / scan to ingest</span></div>}<div className="status-footer"><span><i className="online-dot" /> {processing ? status : document ? 'INDEXED FROM UPLOADED DOCUMENT' : 'AWAITING UPLOAD'}</span><span><FileText size={12} /> {document?.name || 'No document indexed'}</span><span>{document ? `${document.report.sections.length} sections · ${document.report.events.length} events · ${document.embeddings.length} vectors` : 'No operational data loaded'}</span><CircleHelp size={13} /></div></div>
}
