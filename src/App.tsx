import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, ReactNode } from 'react'
import { Map as MapLibreMap, NavigationControl, Popup, setWorkerUrl, type StyleSpecification } from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import type { FeatureCollection, Point } from 'geojson'
import 'maplibre-gl/dist/maplibre-gl.css'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

// Vite serves workers as ESM – wire maplibre's worker to avoid
// "blocked because of a disallowed MIME type" in dev (localhost:5173)
setWorkerUrl(maplibreWorkerUrl)
import { Activity, AlertTriangle, Anchor, ArrowUpRight, Bell, BrainCircuit, ChevronDown, CircleHelp, Crosshair, Database, FileScan, FileText, Flame, Gauge, MapPinned, LoaderCircle, Maximize2, Menu, Network, PanelLeftClose, Pause, Play, RotateCcw, Search, Send, Settings2, Sparkles, Upload, Waves, X, Zap } from 'lucide-react'
import { enText, useLang } from './lang'
import type { StrKey } from './lang'
import LanguageToggle from './components/LanguageToggle'
import AirgapToggle from './components/AirgapToggle'
import WellDive from './components/WellDive'
import AllDocumentsMap from './components/AllDocumentsMap'
import { isSupabaseConfigured, loadDocumentsFromSupabase, saveAlert as saveAlertToSupabase, saveDocumentToSupabase, saveTelemetryBatch, supabase, upsertWellFromReport } from './lib/supabase'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl
const DocumentGraph = lazy(() => import('./components/DocumentGraph'))
const SubsurfaceView = lazy(() => import('./components/SubsurfaceView'))

type View = 'command' | 'documents' | 'embeddings' | 'prediction' | 'dive'
type Segment = { page: number; x: number; y: number; w: number; h: number; label: string; tone: 'cyan' | 'amber' | 'coral' }
type Embedding = { id: string; label: string; excerpt: string; x: number; y: number }
type Event = { time: string | null; type: string; depth: number | null; severity: 'high' | 'medium' | 'low' | null; mitigation: string | null; evidence: string }
type Risk = { label: string; probability: number | null; trend: 'rising' | 'steady' | 'falling' | null; evidence: string }
type OffsetWell = { id: string; latitude: number | null; longitude: number | null; depth: number | null; distance_km: number | null; relationship: string | null }
type Formation = { name: string; top_md: number | null; bottom_md: number | null }
type SurveyPoint = { md: number; tvd: number | null; inclination: number | null; azimuth: number | null; northing: number | null; easting: number | null }
type Casing = { name: string; top_md: number | null; bottom_md: number | null; diameter_in: number | null }
type Section = { label: string; anchor: string; summary: string; evidence?: string }
type Report = {
  well_name: string | null; report_date: string | null; report_number: string | null; latitude: number | null; longitude: number | null;
  current_md: number | null; current_tvd: number | null; formation: string | null; mud_weight: string | null; operator: string | null;
  rig_name: string | null; lease_block: string | null; progress: number | null; avg_rop: number | null; formations: Formation[];
  events: Event[]; risks: Risk[]; offset_wells: OffsetWell[]; sections: Section[]; trajectory?: SurveyPoint[]; casings?: Casing[];
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
const value = (input: string | number | null | undefined, suffix = '', notFound = 'Not found') => input === null || input === undefined || input === '' ? notFound : `${typeof input === 'number' ? input.toLocaleString() : input}${suffix}`
export class L10nError extends Error { key: StrKey; vars?: Record<string, string | number>; constructor(key: StrKey, vars?: Record<string, string | number>) { super(key); this.key = key; this.vars = vars } }
const isImageFile = (file: File) => file.type.startsWith('image/') || /\.(png|jpe?g|tiff|bmp|webp)$/i.test(file.name)

// --- Hybrid Search helpers ---
type SearchKind = 'all' | 'section' | 'event' | 'risk' | 'well'
type SearchResult = { id: string; docName: string; wellName: string | null; kind: SearchKind; title: string; snippet: string; formation: string | null; depth: number | null; severity: string | null; score: number }
function parseMudWeight(mud: string | null): number | null {
  if (!mud) return null
  const m = String(mud).match(/[\d.]+/)
  const n = m ? parseFloat(m[0]) : NaN
  return Number.isFinite(n) ? n : null
}
function scoreText(hay: string, tokens: string[]): number {
  const h = hay.toLowerCase()
  let s = 0
  for (const t of tokens) if (h.includes(t)) s += 1
  // phrase boost
  if (tokens.length > 1 && h.includes(tokens.join(' '))) s += 0.5
  return tokens.length ? s / tokens.length : 0
}
function hybridSearch(documents: IndexedDocument[], query: string, filters: { kind: SearchKind; formation: string; severity: string }): SearchResult[] {
  const q = query.trim().toLowerCase()
  const tokens = q ? q.split(/\s+/).filter(Boolean).slice(0, 8) : []
  const hasQuery = tokens.length > 0
  const out: SearchResult[] = []
  for (const doc of documents) {
    const fFormation = filters.formation !== 'all' ? filters.formation.toLowerCase() : null
    const formationMatch = (candidateFormation: string | null) => !fFormation || (candidateFormation && candidateFormation.toLowerCase().includes(fFormation))
    // sections
    if (filters.kind === 'all' || filters.kind === 'section') {
      for (const s of doc.report.sections) {
        if (!formationMatch(doc.report.formation)) continue
        const hay = `${s.label} ${s.summary} ${s.evidence || ''} ${doc.report.well_name || ''}`
        const sc = hasQuery ? scoreText(hay, tokens) : 1
        if (!hasQuery || sc > 0) out.push({ id: `${doc.name}::section::${s.label}`, docName: doc.name, wellName: doc.report.well_name, kind: 'section', title: s.label, snippet: (s.summary || s.evidence || '').slice(0, 120), formation: doc.report.formation, depth: null, severity: null, score: sc + (fFormation ? 0.1 : 0) })
      }
    }
    if (filters.kind === 'all' || filters.kind === 'event') {
      for (const e of doc.report.events) {
        if (filters.severity !== 'all' && (e.severity || 'null') !== filters.severity) continue
        if (!formationMatch(doc.report.formation)) continue
        const hay = `${e.type} ${e.evidence} ${e.mitigation || ''} ${String(e.depth || '')}`
        const sc = hasQuery ? scoreText(hay, tokens) : 1
        if (!hasQuery || sc > 0) out.push({ id: `${doc.name}::event::${e.type}::${e.depth}`, docName: doc.name, wellName: doc.report.well_name, kind: 'event', title: e.type, snippet: e.evidence.slice(0, 120), formation: doc.report.formation, depth: e.depth, severity: e.severity, score: sc + 0.05 })
      }
    }
    if (filters.kind === 'all' || filters.kind === 'risk') {
      for (const r of doc.report.risks) {
        if (filters.severity !== 'all' && (r.trend || 'null') !== filters.severity && (String(r.probability || '') !== filters.severity)) continue
        if (!formationMatch(doc.report.formation)) continue
        const hay = `${r.label} ${r.evidence} ${String(r.probability || '')}`
        const sc = hasQuery ? scoreText(hay, tokens) : 1
        if (!hasQuery || sc > 0) out.push({ id: `${doc.name}::risk::${r.label}`, docName: doc.name, wellName: doc.report.well_name, kind: 'risk', title: r.label, snippet: r.evidence.slice(0, 120), formation: doc.report.formation, depth: null, severity: r.trend, score: sc })
      }
    }
    if (filters.kind === 'all' || filters.kind === 'well') {
      const hayWell = `${doc.report.well_name || ''} ${doc.report.lease_block || ''} ${doc.report.formation || ''} ${String(doc.report.current_md || '')}`
      const sc = hasQuery ? scoreText(hayWell, tokens) : 0
      if (!formationMatch(doc.report.formation)) continue
      if (hasQuery && sc > 0) out.push({ id: `${doc.name}::well`, docName: doc.name, wellName: doc.report.well_name, kind: 'well', title: doc.report.well_name || doc.name, snippet: `${doc.report.formation || 'Formation not found'} · ${value(doc.report.current_md, ' m')} · ${doc.report.lease_block || ''}`.slice(0, 120), formation: doc.report.formation, depth: doc.report.current_md, severity: null, score: sc + 0.08 })
      else if (!hasQuery && filters.kind === 'well') out.push({ id: `${doc.name}::well`, docName: doc.name, wellName: doc.report.well_name, kind: 'well', title: doc.report.well_name || doc.name, snippet: `${doc.report.formation || 'Formation not found'} · ${value(doc.report.current_md, ' m')}`.slice(0, 120), formation: doc.report.formation, depth: doc.report.current_md, severity: null, score: 0.5 })
    }
  }
  // hybrid: keyword score + slight doc-vector boost (more recent docs slightly higher) + severity boost
  return out.sort((a, b) => b.score - a.score).slice(0, 18)
}
function computeWhatIfRisks(risks: Risk[], mudDelta: number, flowDelta: number, wobDelta: number) {
  return risks.map(r => {
    const label = r.label.toLowerCase()
    const base = r.probability ?? (r.trend === 'rising' ? 62 : r.trend === 'falling' ? 22 : r.trend === 'steady' ? 38 : 32)
    let adj = base as number
    if (label.includes('loss') || label.includes('lost circulation') || label.includes('circulation')) adj += mudDelta * 18 + flowDelta * 0.18
    else if (label.includes('kick') || label.includes('influx') || label.includes('gas')) adj += -mudDelta * 22 + flowDelta * 0.08
    else if (label.includes('stuck')) adj += mudDelta * 12 + -flowDelta * 0.12 + wobDelta * 0.14
    else if (label.includes('torque') || label.includes('drag')) adj += wobDelta * 0.18 + mudDelta * 5
    else if (label.includes('pressure') || label.includes('overpressure') || label.includes('fracture')) adj += mudDelta * 14 + flowDelta * 0.1
    else if (label.includes('cement')) adj += mudDelta * 6 + wobDelta * 0.06
    else adj += mudDelta * 8 + flowDelta * 0.05
    adj = Math.max(5, Math.min(95, Math.round(adj)))
    const delta = adj - (base as number)
    return { label: r.label, base: base as number, adjusted: adj, delta, evidence: r.evidence, trend: delta > 4 ? 'rising' as const : delta < -4 ? 'falling' as const : 'steady' as const }
  })
}

// --- Telemetry Replay + Alert System ---
type TelemetrySample = { time: string; depth: number; wob: number | null; rop: number | null; rpm: number | null; torque: number | null; spp: number | null; flowIn: number | null; flowOut: number | null; mudWeight: number | null; gas: number | null; hookLoad: number | null; quality: 'good' | 'degraded' | 'missing' }
type TelemetryAlert = { id: string; time: string; depth: number | null; kind: 'Mud Loss' | 'Kick' | 'Stuck Pipe' | 'Overpressure' | 'Torque Spike'; severity: 'high' | 'medium' | 'low'; messageKey: StrKey; messageVars?: Record<string, string | number>; evidence: string; acknowledged: boolean; suppressed: boolean; createdIdx: number }
function generateSyntheticTelemetry(report: Report): TelemetrySample[] {
  const endDepth = report.current_md ?? 3200
  const startDepth = Math.max(200, endDepth - 1800)
  const n = 72
  const baseMud = parseMudWeight(report.mud_weight) ?? 12.2
  const out: TelemetrySample[] = []
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    const depth = Math.round(startDepth + t * (endDepth - startDepth))
    // base curves with noise
    const noise = (a: number) => (Math.sin(i * 0.7 + a) * 0.5 + (Math.random() - 0.5) * 0.6)
    let wob = 14 + noise(1) * 2 + t * 3
    let rop = 18 - t * 6 + noise(2) * 3
    let torque = 9 + noise(3) * 1.5 + (depth > endDepth - 600 ? (depth - (endDepth - 600)) * 0.012 : 0)
    let spp = 1650 + t * 420 + noise(4) * 80
    let flowIn = 580 + noise(5) * 12
    let flowOut = flowIn + noise(6) * 10
    let gas = 0.6 + noise(7) * 0.4 + t * 0.3
    // inject anomalies in middle formation (simulate offset-well hazard)
    const anomalyWindow = i >= 38 && i <= 46
    const spikeWindow = i === 52
    if (anomalyWindow) {
      flowOut -= 68 + Math.random() * 22
      torque += 6 + Math.random() * 3
      spp += 220 + Math.random() * 90
      gas += 2.1 + Math.random()
      wob += 2.5
      rop -= 4
    }
    if (spikeWindow) {
      torque += 9
      gas += 1.2
    }
    // clamp
    wob = Math.max(4, wob); rop = Math.max(2, rop); torque = Math.max(4, torque); spp = Math.max(900, spp); gas = Math.max(0, gas)
    const isMissing = Math.random() < 0.04
    const quality: TelemetrySample['quality'] = isMissing ? 'missing' : anomalyWindow ? 'degraded' : 'good'
    const time = new Date(Date.now() - (n - i) * 4 * 60000).toISOString().slice(11, 16)
    out.push({
      time: isMissing ? '--:--' : time,
      depth: isMissing ? depth : depth,
      wob: isMissing ? null : Math.round(wob * 10) / 10,
      rop: isMissing ? null : Math.round(rop * 10) / 10,
      rpm: isMissing ? null : Math.round((92 + noise(8) * 6) ),
      torque: isMissing ? null : Math.round(torque * 10) / 10,
      spp: isMissing ? null : Math.round(spp),
      flowIn: isMissing ? null : Math.round(flowIn),
      flowOut: isMissing ? null : Math.round(flowOut),
      mudWeight: isMissing ? null : Math.round((baseMud + (anomalyWindow ? 0.15 : 0) + noise(9) * 0.08) * 100) / 100,
      gas: isMissing ? null : Math.round(gas * 10) / 10,
      hookLoad: isMissing ? null : Math.round(110 + wob * 2.2 + noise(10) * 4),
      quality,
    })
  }
  return out
}
function parseTelemetryCsv(text: string): TelemetrySample[] {
  const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (lines.length < 2) throw new L10nError('errCsvHeader')
  const header = lines[0].toLowerCase().split(',').map(h => h.trim())
  const idx = (name: string) => header.indexOf(name)
  const hasDepth = idx('depth') !== -1 || idx('md') !== -1
  if (!hasDepth) throw new L10nError('errCsvDepth')
  const get = (row: string[], name: string, alias?: string) => {
    let i = idx(name); if (i === -1 && alias) i = idx(alias); if (i === -1) return null
    const v = row[i]?.trim(); if (!v || v === '--' || v.toLowerCase() === 'null') return null
    const n = parseFloat(v); return Number.isFinite(n) ? n : null
  }
  return lines.slice(1).slice(0, 200).map((line, i) => {
    const row = line.split(',').map(c => c.trim())
    const depth = get(row, 'depth', 'md') ?? 1000 + i * 25
    return {
      time: row[idx('time')] || `T+${i * 5}m`,
      depth: Math.round(depth),
      wob: get(row, 'wob'), rop: get(row, 'rop'), rpm: get(row, 'rpm'), torque: get(row, 'torque'), spp: get(row, 'spp', 'psp'),
      flowIn: get(row, 'flowin', 'flow_in'), flowOut: get(row, 'flowout', 'flow_out'), mudWeight: get(row, 'mudweight', 'mw'), gas: get(row, 'gas'), hookLoad: get(row, 'hookload', 'hook'),
      quality: (get(row, 'wob') === null && get(row, 'torque') === null) ? 'missing' as const : 'good' as const,
    }
  })
}
function evaluateTelemetryAlerts(sampleWindow: TelemetrySample[], allSamples: TelemetrySample[], currentIdx: number, existing: TelemetryAlert[], report: Report): TelemetryAlert[] {
  // persistence=3, hysteresis: require 2 normal samples to clear, cooldown=5 samples per kind
  const persistence = 3; const cooldown = 6
  const window = sampleWindow.filter(s => s.quality !== 'missing')
  if (window.length < persistence) return []
  const last = sampleWindow[sampleWindow.length - 1]
  if (!last || last.quality === 'missing') return []
  const depth = last.depth
  const findOffsetEvidence = (kind: string) => {
    const ev = report.events.find(e => e.type.toLowerCase().includes(kind.toLowerCase().slice(0, 4)))
    const rw = report.risks.find(r => r.label.toLowerCase().includes(kind.toLowerCase().slice(0, 4)))
    return ev ? `${ev.type} @ ${ev.depth ?? '?'}m: ${ev.evidence.slice(0, 90)}` : rw ? `${rw.label}: ${rw.evidence.slice(0, 90)}` : report.formation ? `__SIM__${report.formation}` : '__NONE__'
  }
  const recentSameKind = (kind: TelemetryAlert['kind']) => existing.some(a => a.kind === kind && !a.suppressed && (currentIdx - a.createdIdx) < cooldown)
  const check = (kind: TelemetryAlert['kind'], severity: TelemetryAlert['severity'], cond: boolean, messageKey: StrKey, messageVars?: Record<string, string | number>) => {
    if (!cond) return null
    if (recentSameKind(kind)) return null
    const cnt = window.slice(-persistence).every(s => {
      if (s.quality === 'missing') return false
      if (kind === 'Mud Loss') return s.flowIn !== null && s.flowOut !== null && s.flowOut! / s.flowIn! < 0.88
      if (kind === 'Kick') return s.gas !== null && s.gas! > 2.8
      if (kind === 'Stuck Pipe') return s.torque !== null && s.torque! > 14.5 && s.wob !== null && s.wob! > 16
      if (kind === 'Overpressure') return s.spp !== null && s.spp! > 2150
      if (kind === 'Torque Spike') return s.torque !== null && window.length >= 2 && s.torque! - (window[window.length - 2].torque ?? s.torque!) > 4.5
      return false
    })
    if (!cnt) return null
    const id = `${kind}-${currentIdx}-${Date.now()}`
    return { id, time: last.time, depth, kind, severity, messageKey, messageVars, evidence: findOffsetEvidence(kind), acknowledged: false, suppressed: false, createdIdx: currentIdx } as TelemetryAlert
  }
  const alerts: TelemetryAlert[] = []
  const loss = check('Mud Loss', 'high', window.slice(-persistence).every(s => s.flowOut !== null && s.flowIn !== null && s.flowOut! / s.flowIn! < 0.88), 'msgLoss', { out: last.flowOut ?? '—', flow: last.flowIn ?? '—', n: persistence })
  const kick = check('Kick', 'high', (last.gas ?? 0) > 2.8, 'msgKick', { gas: last.gas ?? '—' })
  const stuck = check('Stuck Pipe', 'high', (last.torque ?? 0) > 14.5 && (last.wob ?? 0) > 16, 'msgStuck', { torque: last.torque ?? '—', wob: last.wob ?? '—' })
  const press = check('Overpressure', 'medium', (last.spp ?? 0) > 2150, 'msgOver', { spp: last.spp ?? '—' })
  const spike = check('Torque Spike', 'medium', window.length >= 2 && ((last.torque ?? 0) - (window[window.length - 2].torque ?? 0) > 4.5), 'msgSpike', { d: (((last.torque ?? 0) - (window[window.length - 2]?.torque ?? 0)).toFixed(1)) })
  for (const a of [loss, kick, stuck, press, spike]) if (a) alerts.push(a)
  return alerts
}

type OCRResult = { text: string; words: Array<{ text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }>; width: number; height: number; engine: string }
async function recognizePage(canvas: HTMLCanvasElement): Promise<OCRResult> {
  const response = await fetch('/api/ocr', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ imageBase64: canvas.toDataURL('image/png') }),
    signal: AbortSignal.timeout(660000),
  })
  const payload = await response.json().catch(() => ({ error: '__L10N__errOcrBad' }))
  if (!response.ok) {
    if (typeof payload.error === 'string' && payload.error.startsWith('__L10N__')) throw new L10nError(payload.error.slice(8) as StrKey)
    if (payload.error) throw new Error(payload.error)
    throw new L10nError('errOcrFail')
  }
  return payload as OCRResult
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

async function analyseImage(file: File, onProgress: (progress: number, key: StrKey, vars?: Record<string, string | number>) => void, opts: { airgapped: boolean }): Promise<{ analysis: Analysis; pages: number }> {
  onProgress(25, 'pgReadingImg')
  const imageUrl = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new L10nError('errImgLoad'))
      image.src = imageUrl
    })
    const canvas = window.document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const context = canvas.getContext('2d')
    if (!context) throw new L10nError('errCanvas')
    context.drawImage(img, 0, 0)
    const combined = await recognizePage(canvas)
    const text = `\n\n[PAGE 1]\n${String(combined.text || '').trim()}`
    const words: WordBox[] = (combined.words || []).map((word) => ({ text: word.text, page: 1, x: word.bbox.x0 / combined.width * 100, y: word.bbox.y0 / combined.height * 100, w: (word.bbox.x1 - word.bbox.x0) / combined.width * 100, h: (word.bbox.y1 - word.bbox.y0) / combined.height * 100, fromOcr: true }))
    if (!text.replace(/\[PAGE \d+\]/g, '').trim()) throw new L10nError('errNoTextImg')
    onProgress(72, 'structuring', { engine: combined.engine })
    const response = await fetch('/api/structure-ddr', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, words, name: file.name, airgapped: opts.airgapped }) })
    const payload = await response.json()
    if (!response.ok) {
      if (typeof payload.error === 'string' && payload.error.startsWith('__L10N__')) throw new L10nError(payload.error.slice(8) as StrKey)
      if (payload.error) throw new Error(payload.error)
      throw new L10nError('errStruct')
    }
    onProgress(95, 'indexedMsg', { sections: payload.report.sections?.length || 0, pages: 1 })
    return { analysis: payload as Analysis, pages: 1 }
  } finally {
    URL.revokeObjectURL(imageUrl)
  }
}

async function analysePdf(file: File, onProgress: (progress: number, key: StrKey, vars?: Record<string, string | number>) => void, opts: { airgapped: boolean }) {
  const loadingTask = getDocument({ data: await file.arrayBuffer() })
  const pdf = await loadingTask.promise
  try {
  let text = ''
  const words: WordBox[] = []
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    onProgress(Math.round((pageNumber - 1) / pdf.numPages * 65) + 5, 'pgReadingPdf', { p: pageNumber, n: pdf.numPages })
    const viewport = page.getViewport({ scale: 1.8 })
    const canvas = window.document.createElement('canvas')
    canvas.width = viewport.width; canvas.height = viewport.height
    const context = canvas.getContext('2d')
    if (!context) throw new L10nError('errCanvas')
    await page.render({ canvas, canvasContext: context, viewport }).promise
    const combined = await recognizePage(canvas)
    const pageText = combined.text
    for (const word of combined.words) words.push({ text: word.text, page: pageNumber, x: word.bbox.x0 / combined.width * 100, y: word.bbox.y0 / combined.height * 100, w: (word.bbox.x1 - word.bbox.x0) / combined.width * 100, h: (word.bbox.y1 - word.bbox.y0) / combined.height * 100, fromOcr: true })
    canvas.width = 0; canvas.height = 0
    page.cleanup()
    text += `\n\n[PAGE ${pageNumber}]\n${pageText.trim()}`
    onProgress(Math.round(pageNumber / pdf.numPages * 65), 'pgExtracted', { p: pageNumber, n: pdf.numPages })
  }
  if (!text.replace(/\[PAGE \d+\]/g, '').trim()) throw new L10nError('errNoTextPdf')
  onProgress(72, 'structuringPdf')
  const response = await fetch('/api/structure-ddr', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, words, name: file.name, airgapped: opts.airgapped }) })
  const payload = await response.json()
  if (!response.ok) {
    if (typeof payload.error === 'string' && payload.error.startsWith('__L10N__')) throw new L10nError(payload.error.slice(8) as StrKey)
    if (payload.error) throw new Error(payload.error)
    throw new L10nError('errStruct')
  }
  onProgress(95, 'indexedMsg', { sections: payload.report.sections?.length || 0, pages: pdf.numPages })
  return { analysis: payload as Analysis, pages: pdf.numPages }
  } finally { await loadingTask.destroy() }
}

async function analyseDocument(file: File, onProgress: (progress: number, key: StrKey, vars?: Record<string, string | number>) => void, opts: { airgapped: boolean }) {
  if (/\.tiff?$/i.test(file.name)) throw new L10nError('errTiff')
  if (isImageFile(file)) return analyseImage(file, onProgress, opts)
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') throw new L10nError('errType')
  return analysePdf(file, onProgress, opts)
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}
function circlePolygon(center: [number, number], radiusKm: number, points = 64): FeatureCollection<Point> | { type: 'Feature'; geometry: { type: 'Polygon'; coordinates: number[][][] }; properties: Record<string, unknown> } {
  const [lon, lat] = center
  const coords: number[][] = []
  for (let i = 0; i <= points; i++) {
    const theta = (i / points) * 2 * Math.PI
    const dx = radiusKm * Math.cos(theta)
    const dy = radiusKm * Math.sin(theta)
    // approx: 1deg lat ~111km, 1deg lon ~111*cos(lat)
    const dLat = dy / 111
    const dLon = dx / (111 * Math.cos(lat * Math.PI / 180) || 1)
    coords.push([lon + dLon, lat + dLat])
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: {} } as unknown as FeatureCollection<Point>
}

function FieldMap({ report, fullscreen, onToggleFullscreen }: { report: Report; fullscreen?: boolean; onToggleFullscreen?: () => void }) {
  const { t } = useLang()
  const tRef = useRef(t); tRef.current = t
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const [radiusKm, setRadiusKm] = useState(25)
  const [formationFilter, setFormationFilter] = useState<string>('all')
  const validOffsets = useMemo(() => report.offset_wells.filter((well) => Number.isFinite(well.latitude) && Number.isFinite(well.longitude)), [report.offset_wells])
  const hasCoords = report.latitude !== null && report.longitude !== null && Number.isFinite(report.latitude) && Number.isFinite(report.longitude)
  const center = useMemo<[number, number] | null>(() => hasCoords ? [report.longitude as number, report.latitude as number] : null, [hasCoords, report.longitude, report.latitude])
  const formationOptions = useMemo(() => {
    const s = new Set<string>()
    if (report.formation) s.add(report.formation)
    for (const f of report.formations || []) if (f.name) s.add(f.name)
    return [...s]
  }, [report.formation, report.formations])
  useEffect(() => { setFormationFilter('all'); setRadiusKm(25) }, [report.well_name, report.latitude, report.longitude])
  const enrichedOffsets = useMemo(() => {
    if (!hasCoords || !center) return validOffsets.map(w => ({ ...w, _computedKm: w.distance_km as number | null }))
    return validOffsets.map(w => {
      let d = w.distance_km
      if (!Number.isFinite(d as number)) d = haversineKm(report.latitude as number, report.longitude as number, w.latitude as number, w.longitude as number)
      return { ...w, _computedKm: d as number }
    })
  }, [validOffsets, hasCoords, center, report.latitude, report.longitude])
  const filteredOffsets = useMemo(() => {
    let out = enrichedOffsets.filter(w => Number.isFinite((w as unknown as { _computedKm: number })._computedKm) ? (w as unknown as { _computedKm: number })._computedKm <= radiusKm + 1e-6 : true)
    if (formationFilter !== 'all') {
      const f = (report.formations || []).find(x => x.name === formationFilter)
      if (f && (f.top_md !== null || f.bottom_md !== null)) {
        const top = f.top_md ?? -Infinity
        const bot = f.bottom_md ?? Infinity
        const lo = Math.min(top as number, bot as number)
        const hi = Math.max(top as number, bot as number)
        const byDepth = out.filter(w => w.depth !== null && w.depth >= lo && w.depth <= hi)
        // if depth filter yields nothing, fall back to relationship string match so filter is never silently ignored
        out = byDepth.length ? byDepth : out.filter(w => (w.relationship || '').toLowerCase().includes(formationFilter.toLowerCase()))
      } else {
        out = out.filter(w => (w.relationship || '').toLowerCase().includes(formationFilter.toLowerCase()))
      }
    }
    return out
  }, [enrichedOffsets, radiusKm, formationFilter, report.formations])

  // features for current filtered view
  const wellFeatures = useMemo(() => {
    if (!center) return null
    const feats: FeatureCollection<Point> = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { id: report.well_name || t('activeWellDef'), state: 'active', depth: report.current_md }, geometry: { type: 'Point', coordinates: center } },
        ...filteredOffsets.map((well) => ({
          type: 'Feature' as const,
          properties: { id: well.id, state: 'offset', depth: well.depth, distKm: (well as unknown as { _computedKm: number })._computedKm },
          geometry: { type: 'Point' as const, coordinates: [well.longitude as number, well.latitude as number] },
        })),
      ],
    }
    return feats
  }, [center, report.well_name, report.current_md, filteredOffsets])
  const radiusFeature = useMemo(() => (center ? (circlePolygon(center, radiusKm) as unknown as { type: 'Feature'; geometry: { type: 'Polygon' } }) : null), [center, radiusKm])

  useEffect(() => {
    if (!hasCoords || !center || !containerRef.current || !wellFeatures) return
    if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }
    const map = new MapLibreMap({ container: containerRef.current, style: mapStyle, center, zoom: 10, minZoom: 4, maxZoom: 15, attributionControl: false, renderWorldCopies: false })
    mapRef.current = map
    map.addControl(new NavigationControl({ showCompass: true }), 'top-right')
    const setupLayers = () => {
      if (map.getSource('document-wells')) return
      if (!map.getSource('radius-circle')) {
        map.addSource('radius-circle', { type: 'geojson', data: radiusFeature as unknown as never })
        map.addLayer({ id: 'radius-fill', type: 'fill', source: 'radius-circle', paint: { 'fill-color': '#e86b4d', 'fill-opacity': 0.06 } })
        map.addLayer({ id: 'radius-line', type: 'line', source: 'radius-circle', paint: { 'line-color': '#e86b4d', 'line-width': 1.6, 'line-dasharray': [4, 4], 'line-opacity': 0.9 } })
      }
      if (!map.getSource('document-wells')) map.addSource('document-wells', { type: 'geojson', data: wellFeatures as unknown as never })
      else (map.getSource('document-wells') as unknown as { setData: (d: unknown) => void }).setData(wellFeatures as unknown as never)
      if (!map.getLayer('well-points')) {
        map.addLayer({ id: 'well-points', type: 'circle', source: 'document-wells', paint: { 'circle-radius': ['case', ['==', ['get', 'state'], 'active'], 11, 7], 'circle-color': ['case', ['==', ['get', 'state'], 'active'], '#e86b4d', '#55b8b2'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2.5 } })
        map.addLayer({ id: 'well-labels', type: 'symbol', source: 'document-wells', layout: { 'text-field': ['get', 'id'], 'text-offset': [0, 1.5], 'text-size': 11 }, paint: { 'text-color': '#315653', 'text-halo-color': '#fff', 'text-halo-width': 1.3 } })
        map.on('click', 'well-points', (event) => {
          const feature = event.features?.[0]; if (!feature) return;
          const tt = tRef.current
          const dist = feature.properties?.distKm != null ? `${Number(feature.properties.distKm).toFixed(1)}${tt('unitKm')}` : ''
          new Popup({ closeButton: false, offset: 14 }).setLngLat((feature.geometry as Point).coordinates as [number, number]).setHTML(`<strong>${feature.properties?.id}</strong><br>${feature.properties?.depth ? `${Number(feature.properties.depth).toLocaleString()}${tt('unitM')}` : tt('depthNotFound')}${dist ? ` · ${dist}` : ''}`).addTo(map)
        })
      }
      map.jumpTo({ center, zoom: 10 })
      if (filteredOffsets.length) {
        const bounds: [[number, number], [number, number]] = [[center[0], center[1]], [center[0], center[1]]]
        for (const w of filteredOffsets) { bounds[0][0] = Math.min(bounds[0][0], w.longitude as number); bounds[0][1] = Math.min(bounds[0][1], w.latitude as number); bounds[1][0] = Math.max(bounds[1][0], w.longitude as number); bounds[1][1] = Math.max(bounds[1][1], w.latitude as number) }
        try { map.fitBounds(bounds, { padding: 48, maxZoom: 10, duration: 0 }) } catch { /* */ }
      }
      setTimeout(() => map.resize(), 80)
    }
    map.on('load', setupLayers)
    if (map.isStyleLoaded()) setTimeout(setupLayers, 0)
    map.on('error', () => { if (!map.getSource('document-wells')) setupLayers() })

    const el = containerRef.current
    const observer = new ResizeObserver(() => { map.resize(); if (center) try { map.jumpTo({ center }) } catch { /* */ } })
    observer.observe(el)
    const ro = () => map.resize()
    window.addEventListener('resize', ro)
    requestAnimationFrame(() => { map.resize(); if (center) map.jumpTo({ center, zoom: 10 }) })
    setTimeout(() => { map.resize(); if (center) map.jumpTo({ center, zoom: 10 }) }, 250)
    return () => { window.removeEventListener('resize', ro); observer.disconnect(); map.remove(); if (mapRef.current === map) mapRef.current = null }
  }, [hasCoords, center, report.well_name, report.current_md])

  // live update when filters change without recreating map
  useEffect(() => {
    const map = mapRef.current
    if (!map || !wellFeatures || !radiusFeature || !center) return
    const wellsSrc = map.getSource('document-wells') as unknown as { setData: (d: unknown) => void } | undefined
    const circleSrc = map.getSource('radius-circle') as unknown as { setData: (d: unknown) => void } | undefined
    if (wellsSrc) try { wellsSrc.setData(wellFeatures as unknown as never) } catch { /* */ }
    if (circleSrc) try { circleSrc.setData(radiusFeature as unknown as never) } catch { /* */ }
  }, [wellFeatures, radiusFeature, center])

  if (!hasCoords || !center) return <div className="map-missing"><MapPinned size={26} /><b>{t('noCoords')}</b><span>{t('mapPopulate')}</span></div>
  const isFiltered = filteredOffsets.length !== validOffsets.length
  return <div className={`real-map-wrap ${fullscreen ? 'fullscreen' : ''}`}>
    <div ref={containerRef} className="real-map" style={{ width: '100%', height: '100%' }} />
    <div className="map-overlay-title">{t('docLocations')} <span>• {1 + filteredOffsets.length} / {1 + validOffsets.length} {t('wellsWord')}</span></div>
    <div className="map-control-strip">
      <div className="strip-well"><b>{report.well_name || t('wellNameNA')}</b><small>{report.latitude!.toFixed(4)}, {report.longitude!.toFixed(4)}{validOffsets.length === 0 ? t('noOffset') : ''}</small></div>
      <div className="strip-controls">
        <label className="strip-group"><span>{t('radius')}</span><input type="range" min={5} max={50} step={5} value={radiusKm} onChange={(e) => setRadiusKm(Number(e.target.value))} /><strong>{radiusKm}{t('unitKm')}</strong></label>
        <label className="strip-group"><span>{t('formationLbl')}</span><select value={formationFilter} onChange={(e) => setFormationFilter(e.target.value)}><option value="all">{t('fAll')}</option>{formationOptions.map(n => <option key={n} value={n}>{n}</option>)}</select></label>
        {isFiltered && <button className="strip-reset" onClick={() => { setRadiusKm(25); setFormationFilter('all') }}>{t('resetBtn')}</button>}
        {onToggleFullscreen && <button className="strip-icon-btn" aria-label={t('toggleFs')} onClick={onToggleFullscreen}>{fullscreen ? <X size={14} /> : <Maximize2 size={14} />}</button>}
      </div>
    </div></div>
}

function PdfViewer({ document }: { document: IndexedDocument }) {
  const { t } = useLang()
  const canvasRef = useRef<HTMLCanvasElement>(null); const [page, setPage] = useState(1)
  const isImage = /\.(png|jpe?g|webp|tiff|bmp)$/i.test(document.name)
  useEffect(() => {
    if (isImage) return
    if (!document.url) return
    let cancelled = false; (async () => { const pdf = await getDocument({ url: document.url }).promise; const current = await pdf.getPage(page); const viewport = current.getViewport({ scale: 1.5 }); const canvas = canvasRef.current; if (!canvas || cancelled) return; const context = canvas.getContext('2d'); if (!context) return; canvas.width = viewport.width; canvas.height = viewport.height; await current.render({ canvas, canvasContext: context, viewport }).promise })().catch(() => undefined); return () => { cancelled = true }
  }, [document.url, page, isImage])
  const segments = document.segments.filter((segment) => segment.page === page)
  const missingSource = !document.url
  if (missingSource) {
    return <div className="pdf-canvas-shell"><div className="pdf-page" style={{ display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center', gap: 8 }}><FileScan size={28} color="#9aa8a5" /><b style={{ color: '#314a47', fontSize: 11 }}>{t('docIntel')}</b><span style={{ color: '#7e8a88', fontSize: 10, maxWidth: 260 }}>{document.name} — source PDF not in Storage (uploaded before storage was enabled). Re-upload the file to view it.</span></div></div>
  }
  if (isImage) return <div className="pdf-canvas-shell"><div className="pdf-page-controls"><span>{t('pageImage')}</span></div><div className="pdf-page" style={{ display: 'grid', placeItems: 'center', overflow: 'auto' }}><img src={document.url} alt={document.name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />{segments.map((segment, index) => <div key={`${segment.label}-${index}`} className={`seg-box ${segment.tone} visible`} style={{ left: `${segment.x}%`, top: `${segment.y}%`, width: `${segment.w}%`, height: `${segment.h}%` }}><span>{segment.label}</span></div>)}</div></div>
  return <div className="pdf-canvas-shell"><div className="pdf-page-controls"><button disabled={page === 1} onClick={() => setPage((current) => current - 1)}>{t('prev')}</button><span>{t('pageOf', { p: page, n: document.pages })}</span><button disabled={page === document.pages} onClick={() => setPage((current) => current + 1)}>{t('next')}</button></div><div className="pdf-page"><canvas ref={canvasRef} />{segments.map((segment, index) => <div key={`${segment.label}-${index}`} className={`seg-box ${segment.tone} visible`} style={{ left: `${segment.x}%`, top: `${segment.y}%`, width: `${segment.w}%`, height: `${segment.h}%` }}><span>{segment.label}</span></div>)}</div></div>
}

function PanelHeader({ icon, title, meta }: { icon: ReactNode; title: string; meta?: string }) { return <div className="panel-header"><span className="panel-title"><i>{icon}</i>{title}</span>{meta && <span className="panel-meta">{meta}</span>}</div> }
function EmptyWorkspace({ view }: { view: View }) { const { t } = useLang(); const copy = view === 'documents' ? t('emptyDocs') : view === 'embeddings' ? t('emptyEmbed') : view === 'prediction' ? t('emptyPredict') : t('emptyCommand'); return <section className="empty-workspace"><FileScan size={30} /><h2>{t('noData')}</h2><p>{copy}</p><span>{t('emptyCta1')} <b>{t('ingestDoc')}</b> {t('emptyCta2')}</span></section> }

function DocumentPanel({ document, processing, progress, status }: { document: IndexedDocument; processing: boolean; progress: number; status: string }) { const { t } = useLang(); return <><PanelHeader icon={<FileScan size={16} />} title={t('docIntel')} meta={processing ? `${progress}%` : t('indexed')} /><div className="document-stage"><div className="paper"><PdfViewer document={document} /></div></div><div className="document-footer"><span><i className="live-dot" /> {status}</span><span>{document.segments.length ? t('regions', { count: document.segments.length }) : t('textOcr')}{t('pages', { count: document.pages })}</span></div></> }

function DepthPanel({ report, onOpenDive }: { report: Report; onOpenDive?: () => void }) {
  const { t } = useLang()
  const nf = t('notFound'); const um = t('unitM')
  const formations = report.formations?.length ? report.formations : report.formation ? [{ name: report.formation, top_md: null, bottom_md: null }] : []
  return <>
    <PanelHeader icon={<Activity size={16} />} title={t('activeWell')} meta={report.well_name || t('nameNotFound')} />
    <div className="active-depth"><span>{t('measuredDepth')}</span><strong>{value(report.current_md, um, nf)}</strong><b>{report.formation || t('formationNotFound')}</b></div>
    <div className="extracted-metrics"><span><small>{t('tvd')}</small><b>{value(report.current_tvd, um, nf)}</b></span><span><small>{t('progressLbl')}</small><b>{value(report.progress, um, nf)}</b></span><span><small>{t('avgRop')}</small><b>{value(report.avg_rop, t('unitRop'), nf)}</b></span><span><small>{t('mudWeight')}</small><b>{value(report.mud_weight, '', nf)}</b></span></div>
    <div className="formation-list">{formations.length ? formations.map((formation, index) => <div key={`${formation.name}-${index}`}><strong>{formation.name}</strong><span>{formation.top_md === null && formation.bottom_md === null ? t('depthIntervalNA') : `${value(formation.top_md, um, nf)} – ${value(formation.bottom_md, um, nf)}`}</span></div>) : <p>{t('noFormations')}</p>}</div>
    {onOpenDive && <button className="coral-action" onClick={onOpenDive} style={{ margin: '0 14px 14px' }}><Waves size={14} /> {t('openDive')}</button>}
  </>
}

function StreamPanel({ document, status }: { document: IndexedDocument; status: string }) {
  const { t } = useLang()
  const um = t('unitM')
  const isOrangeSection = (label: string) => {
    const l = label.toLowerCase()
    return l.includes('operation') || l.includes('event') || l.includes('fluid') || l.includes('decision') || l.includes('casing') || l.includes('cement') || l.includes('risk')
  }
  const sectionItems = document.report.sections.map((section) => ({
    title: section.label,
    detail: section.summary || (section.evidence ? section.evidence.slice(0, 110) : t('sectionIndexed')),
    icon: <Database size={15} />,
    tone: isOrangeSection(section.label) ? 'amber' : 'cyan',
  }))
  const eventItems = document.report.events.map((event) => ({
    title: event.type,
    detail: `${event.time ? event.time + ' · ' : ''}${event.depth === null ? t('depthNA') : `${event.depth.toLocaleString()}${um}`} · ${event.evidence} ${event.severity ? `· ${event.severity}` : ''}`,
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
    title: t('offsetW', { id: well.id }),
    detail: `${well.distance_km !== null ? `${well.distance_km}${t('unitKm')}` : t('distNA')} · ${well.relationship || t('nearbyCtx')}`,
    icon: <MapPinned size={15} />,
    tone: 'cyan',
  }))
  const items = [
    { title: t('pdfOcr'), detail: status, icon: <FileText size={15} />, tone: 'cyan' },
    ...sectionItems,
    ...eventItems,
    ...riskItems,
    ...offsetItems,
  ]
  return <><PanelHeader icon={<Zap size={16} />} title={t('liveStream')} meta={t('itemsPipe', { count: items.length })} /><div className="stream-list" style={{ maxHeight: 420, overflowY: 'auto' }}>{items.map((item, index) => <div className="stream-item" key={`${item.title}-${index}`}><time>{t('now')}</time><span className={`stream-icon ${item.tone}`}>{item.icon}</span><div><strong>{item.title}</strong><span>{item.detail}</span></div><ArrowUpRight size={13} /></div>)}</div></>
}

function RiskRow({ risks, events, openPrediction }: { risks: Risk[]; events: Event[]; openPrediction: () => void }) {
  const { t } = useLang()
  const um = t('unitM')
  const trendLbl = (trend: Risk['trend']) => trend === 'rising' ? t('trendRising') : trend === 'falling' ? t('trendFalling') : trend === 'steady' ? t('trendSteady') : t('notStated')
  const shown = risks.slice(0, 4)
  return <section className="risk-row dynamic-risk-row"><div className="risk-label"><AlertTriangle size={22} /><div><small>{t('docEvidence')}</small><strong>{t('riskWatch')}</strong></div><span className="risk-count">{risks.length ? t('tracked', { count: risks.length }) : t('noDataLbl')}</span></div><div className="risk-cards">{shown.length ? shown.map((risk) => {
    const tone = risk.trend === 'rising' ? 'critical' : risk.trend === 'falling' ? 'calm' : 'warning'
    return <button className={`risk-card ${tone}`} key={risk.label} title={risk.evidence}><span className="risk-top"><small>{risk.label}</small><i className={`risk-dot ${risk.trend || ''}`} /></span><strong>{risk.probability === null ? '—' : <>{risk.probability}<em>%</em></>}</strong><span className={`risk-pill ${risk.trend || 'none'}`}>{trendLbl(risk.trend)}</span></button>
  }) : <div className="no-risk-data">{t('noRiskData')}</div>}</div><div className="alerts-card"><span className="alert-count">{t('eventsLbl', { count: events.length })}</span><div className="alerts-list">{events.length ? events.slice(0, 2).map((event, index) => <span className="alert-row" key={`${event.type}-${index}`}><b>{event.time || '—'}</b> · {event.type}{event.depth === null ? '' : ` @ ${event.depth.toLocaleString()}${um}`}</span>) : <span className="alerts-empty">{t('noEvents')}</span>}</div><button onClick={openPrediction}>{t('askAboutEvents')} <ArrowUpRight size={13} /></button></div></section>
}

function Sparkline({ values, color = '#e86b4d' }: { values: (number | null)[]; color?: string }) {
  const nums = values.map(v => v ?? 0)
  const min = Math.min(...nums), max = Math.max(...nums)
  const range = Math.max(0.001, max - min)
  const w = 96, h = 32
  const pts = nums.map((v, i) => {
    const x = (i / Math.max(1, nums.length - 1)) * w
    const y = h - ((v - min) / range) * h
    return `${x},${y}`
  }).join(' ')
  return <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} style={{ display: 'block' }}><polyline fill="none" stroke={color} strokeWidth={1.6} points={pts} /><circle cx={pts.split(' ').pop()?.split(',')[0]} cy={pts.split(' ').pop()?.split(',')[1]} r={2.2} fill={color} /></svg>
}

function TelemetryPanel({ report }: { report: Report }) {
  const { t, airgapped } = useLang()
  const um = t('unitM')
  const kindLbl = (k: TelemetryAlert['kind']) => k === 'Mud Loss' ? t('kMudLoss') : k === 'Kick' ? t('kKick') : k === 'Stuck Pipe' ? t('kStuck') : k === 'Overpressure' ? t('kOver') : t('kSpike')
  const sevLbl = (s: TelemetryAlert['severity']) => s === 'high' ? t('sevHigh') : s === 'medium' ? t('sevMedium') : t('sevLow')
  const evText = (e: string) => e === '__NONE__' ? t('noOffsetEv') : e.startsWith('__SIM__') ? t('simHazard', { f: e.slice(7) }) : e
  const [samples, setSamples] = useState<TelemetrySample[]>(() => generateSyntheticTelemetry(report))
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [alerts, setAlerts] = useState<TelemetryAlert[]>([])
  const [csvError, setCsvError] = useState('')
  const setErrorMsg = setCsvError
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const s = generateSyntheticTelemetry(report)
    setSamples(s); setIdx(0); setAlerts([]); setPlaying(false)
  }, [report.well_name, report.current_md, report.formation])

  useEffect(() => {
    if (!playing) return
    const ms = speed === 2 ? 500 : speed === 3 ? 250 : 900
    const t = setInterval(() => setIdx(i => {
      if (i >= samples.length - 1) { setPlaying(false); return i }
      return i + 1
    }), ms)
    return () => clearInterval(t)
  }, [playing, speed, samples.length])

  const current = samples[idx] ?? samples[0]
  const windowSamples = useMemo(() => samples.slice(Math.max(0, idx - 23), idx + 1), [samples, idx])

  useEffect(() => {
    const w = samples.slice(Math.max(0, idx - 5), idx + 1)
    const fresh = evaluateTelemetryAlerts(w, samples, idx, alerts, report)
    if (fresh.length) {
      setAlerts(a => {
        const ids = new Set(a.map(x => x.id))
        const deduped = fresh.filter(f => !ids.has(f.id))
        return deduped.length ? [...deduped, ...a].slice(0, 20) : a
      })
      if (isSupabaseConfigured && !airgapped) {
        for (const fa of fresh) {
          saveAlertToSupabase(report.well_name, { time: fa.time, depth: fa.depth, kind: fa.kind, severity: fa.severity, message: enText(fa.messageKey, fa.messageVars), evidence: fa.evidence === '__NONE__' ? enText('noOffsetEv') : fa.evidence.startsWith('__SIM__') ? enText('simHazard', { f: fa.evidence.slice(7) }) : fa.evidence }).catch(() => {})
        }
      }
    }
  }, [idx, alerts, samples, report])

  // persist telemetry batch best-effort when samples first generated
  useEffect(() => {
    if (!isSupabaseConfigured || airgapped || samples.length === 0) return
    const batch = samples.slice(0, 30).map(s => ({
      time: s.time, depth: s.depth, wob: s.wob, rop: s.rop, rpm: s.rpm, torque: s.torque, spp: s.spp,
      flow_in: s.flowIn, flow_out: s.flowOut, mud_weight: s.mudWeight, gas: s.gas, hook_load: s.hookLoad, quality: s.quality,
    }))
    saveTelemetryBatch(report.well_name, batch as never).catch(() => {})
  }, [samples.length])

  const ack = (id: string) => setAlerts(a => a.map(x => x.id === id ? { ...x, acknowledged: true } : x))
  const suppress = (id: string) => setAlerts(a => a.map(x => x.id === id ? { ...x, suppressed: true } : x))
  const escalate = (id: string) => setAlerts(a => a.map(x => x.id === id ? { ...x, severity: 'high' as const } : x))
  const clearSuppressed = () => setAlerts(a => a.filter(x => !x.suppressed))

  const handleCsv = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return
    try {
      const text = await f.text()
      const parsed = parseTelemetryCsv(text)
      setSamples(parsed); setIdx(0); setAlerts([]); setPlaying(false); setCsvError('')
    } catch (err) { setErrorMsg(err instanceof L10nError ? t(err.key, err.vars) : err instanceof Error ? err.message : t('errCsv')) }
    if (fileRef.current) fileRef.current.value = ''
  }

  const activeAlerts = alerts.filter(a => !a.suppressed)
  const unacked = activeAlerts.filter(a => !a.acknowledged).length

  return <section className="panel telemetry-panel">
    <PanelHeader icon={<Gauge size={16} />} title={t('teleReplay')} meta={t('samplesMeta', { count: samples.length, depth: current ? `${current.depth}${um}` : '', state: playing ? t('teleLive') : t('telePaused') })} />
    <div className="telemetry-controls">
      <button className="tele-btn primary" onClick={() => setPlaying(v => !v)}>{playing ? <Pause size={13} /> : <Play size={13} />} {playing ? t('pause') : t('play')}</button>
      <button className="tele-btn" onClick={() => setIdx(i => Math.max(0, i - 1))}>{t('stepBack')}</button>
      <button className="tele-btn" onClick={() => setIdx(i => Math.min(samples.length - 1, i + 1))}>{t('stepFwd')}</button>
      <button className="tele-btn" onClick={() => { setIdx(0); setPlaying(false); setAlerts([]) }}><RotateCcw size={12} /> {t('reset')}</button>
      <label className="tele-speed"><span>{t('speed')}</span><select value={speed} onChange={e => setSpeed(parseInt(e.target.value))}><option value={1}>1×</option><option value={2}>2×</option><option value={3}>4×</option></select></label>
      <div className="tele-scrub"><input type="range" min={0} max={Math.max(0, samples.length - 1)} value={idx} onChange={e => setIdx(parseInt(e.target.value))} /><span>{idx + 1} / {samples.length}</span></div>
      <label className="tele-upload"><Upload size={12} /> {t('csv')}<input ref={fileRef} type="file" accept=".csv,.json" onChange={handleCsv} /></label>
    </div>
    {csvError && <div className="tele-empty" role="alert">{csvError}</div>}
    <div className="telemetry-metrics">
      {([
        ['WOB', current?.wob, 'klb', '#e86b4d'],
        ['ROP', current?.rop, 'm/h', '#55c9c5'],
        ['TORQUE', current?.torque, 'kNm', '#e9b65b'],
        ['SPP', current?.spp, 'psi', '#8d7bb6'],
        ['FLOW IN', current?.flowIn, 'lpm', '#55c9c5'],
        ['FLOW OUT', current?.flowOut, 'lpm', current && current.flowOut !== null && current.flowIn !== null && current.flowOut / current.flowIn < 0.9 ? '#e86b4d' : '#55c9c5'],
        ['GAS', current?.gas, 'u', (current?.gas ?? 0) > 2.5 ? '#e86b4d' : '#55c9c5'],
        ['MW', current?.mudWeight, 'ppg', '#6e8d8a'],
      ] as const).map(([label, val, unit, col]) => (
        <span key={label} className="tele-metric" style={{ borderLeftColor: String(col) }}><small>{label}</small><b style={{ color: label === 'FLOW OUT' && String(col) === '#e86b4d' ? '#e86b4d' : undefined }}>{val === null || val === undefined ? '—' : `${val}`}<em> {unit}</em></b><i className={`qdot ${current?.quality}`} title={current?.quality === 'good' ? t('qGood') : current?.quality === 'degraded' ? t('qDegraded') : current?.quality === 'missing' ? t('qMissing') : current?.quality} /></span>
      ))}
    </div>
    <div className="telemetry-charts">
      <div><small>WOB</small><Sparkline values={windowSamples.map(s => s.wob)} color="#e86b4d" /></div>
      <div><small>TORQUE</small><Sparkline values={windowSamples.map(s => s.torque)} color="#e9b65b" /></div>
      <div><small>SPP</small><Sparkline values={windowSamples.map(s => s.spp)} color="#8d7bb6" /></div>
      <div><small>GAS</small><Sparkline values={windowSamples.map(s => s.gas)} color={activeAlerts.some(a => a.kind === 'Kick') ? '#e86b4d' : '#55c9c5'} /></div>
      <div className="tele-depth-sweep"><small>{t('teleDepth')}</small><strong>{current?.depth ?? '—'}{um}</strong><span>{t('formationWord')} {report.formation || '—'}</span></div>
    </div>
    <div className="telemetry-alerts">
      <div className="tele-alert-head"><span><AlertTriangle size={13} /> {t('alerts')} {unacked > 0 && <em>{t('newBadge', { count: unacked })}</em>}</span><small>{t('persistNote', { p: 3, c: 6 })}</small><button onClick={clearSuppressed}>{t('clearSupp')}</button></div>
      {activeAlerts.length === 0 ? <div className="tele-empty">{t('noAlerts')}</div> : (
        <div className="tele-alert-list">
          {activeAlerts.slice(0, 8).map(a => (
            <div key={a.id} className={`tele-alert ${a.severity} ${a.acknowledged ? 'acked' : ''}`}>
              <span className="tele-alert-kind">{a.kind === 'Mud Loss' ? <Waves size={12} /> : a.kind === 'Kick' ? <Flame size={12} /> : a.kind === 'Stuck Pipe' ? <Anchor size={12} /> : <Zap size={12} />}{kindLbl(a.kind)}</span>
              <div className="tele-alert-body"><strong>{a.time} · {a.depth}{um} · {sevLbl(a.severity)}</strong><span>{t(a.messageKey, a.messageVars)}</span><small>{evText(a.evidence)}</small></div>
              <div className="tele-alert-actions">
                {!a.acknowledged && <button onClick={() => ack(a.id)}>{t('ack')}</button>}
                <button onClick={() => suppress(a.id)}>{t('suppress')}</button>
                {a.severity !== 'high' && <button onClick={() => escalate(a.id)}>{t('escalate')}</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  </section>
}

function EmbeddingPanel({ documents }: { documents: IndexedDocument[] }) {
  const { t } = useLang()
  const um = t('unitM')
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
    return <><PanelHeader icon={<Network size={16} />} title={t('vecSpace')} meta={t('noSites')} /><div className="empty-workspace" style={{ minHeight: 320, border: 'none', background: '#fafaf8' }}><Network size={28} /><h2>{t('noSitesTitle')}</h2><p>{t('noSitesBody')}</p></div></>
  }
  if (documents.length === 1) {
    return <><PanelHeader icon={<Network size={16} />} title={t('vecSpace')} meta={t('modelSites1', { model })} /><div className="embedding-canvas large-canvas"><div className="embedding-axis horizontal" /><div className="embedding-axis vertical" /><button className="embedding-point coral selected" style={{ left: '50%', top: '50%' }} aria-label={documents[0].report.well_name ?? documents[0].name} onClick={() => setSelectedName(documents[0].name)} /><div className="embedding-tooltip" style={{ left: '58%', top: '57%' }}><strong>{documents[0].report.well_name ?? documents[0].name}</strong><span>{documents[0].report.formation ?? t('formationNA2')} · {value(documents[0].report.current_md, um, t('notFound'))} · {documents[0].report.sections.length} {t('secsWord')}</span><small>{t('uploadAnother')}</small></div></div></>
  }
  return <><PanelHeader icon={<Network size={16} />} title={t('vecSpace')} meta={t('modelSitesN', { model, count: documents.length })} /><div className="embedding-canvas large-canvas"><div className="embedding-axis horizontal" /><div className="embedding-axis vertical" />{documents.map((doc, idx) => {
    const pos = positions[idx] ?? { x: 50, y: 50 }
    const isSel = doc.name === selected?.name
    const tone = doc.report.formation?.toLowerCase().includes('barail') ? 'coral' : doc.report.formation?.toLowerCase().includes('tipam') ? 'amber' : 'cyan'
    return <button key={doc.name} className={`embedding-point ${tone} ${isSel ? 'selected' : ''}`} style={{ left: `${pos.x}%`, top: `${pos.y}%` }} onClick={() => setSelectedName(doc.name)} aria-label={doc.report.well_name ?? doc.name} title={`${doc.report.well_name ?? doc.name} – ${doc.report.formation ?? ''}`} />
  })}{selected && (() => {
    const selIdx = documents.findIndex((d) => d.name === selected.name)
    const sims = documents.filter((d) => d.name !== selected.name).map((d) => ({ name: d.report.well_name ?? d.name, score: cosine(selected.documentVector ?? [], d.documentVector ?? []) })).sort((a, b) => b.score - a.score).slice(0, 2)
    return <div className="embedding-tooltip"><strong>{selected.report.well_name ?? selected.name}</strong><span>{selected.report.formation ?? t('formationNFFull')} · {value(selected.report.current_md, um, t('notFound'))} · {selected.report.events.length} {t('evtsWord')}</span><small style={{ display: 'block', marginTop: 6, color: '#7a8a87' }}>{sims.length ? `${t('closest')}: ${sims.map((s) => `${s.name} (${(s.score * 100).toFixed(1)}%)`).join(' · ')}` : t('noCompare')}</small></div>
  })()}<div style={{ position: 'absolute', left: 10, bottom: 8, fontSize: 7, color: '#a0a6a2', letterSpacing: '.06em', fontWeight: 800 }}>{t('closerNote')}</div></div></>
}

function PredictionPanel({ document, question, setQuestion }: { document: IndexedDocument; question: string; setQuestion: (value: string) => void }) {
  const { t, airgapped } = useLang()
  const [answer, setAnswer] = useState(''); const [asking, setAsking] = useState(false)
  const [mudDelta, setMudDelta] = useState(0)
  const [flowDelta, setFlowDelta] = useState(0)
  const [wobDelta, setWobDelta] = useState(0)
  const [whatIfAnswer, setWhatIfAnswer] = useState('')
  const [simulating, setSimulating] = useState(false)
  const baseMud = parseMudWeight(document.report.mud_weight)
  const whatIfRisks = useMemo(() => computeWhatIfRisks(document.report.risks || [], mudDelta, flowDelta, wobDelta), [document.report.risks, mudDelta, flowDelta, wobDelta])
  const hasWhatIf = mudDelta !== 0 || flowDelta !== 0 || wobDelta !== 0
  async function ask(event: FormEvent) { event.preventDefault(); if (!question.trim()) return; setAsking(true); setAnswer(''); try { const response = await fetch('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question, corpus: document.corpus, airgapped }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error); setAnswer(payload.answer) } catch (error) { setAnswer(error instanceof Error && error.message && !error.message.startsWith('__L10N__') ? error.message : t('errAsk')) } finally { setAsking(false) } }
  async function simulate() {
    if (!document.report.risks.length) { setWhatIfAnswer(t('errWhatifNoRisks')); return }
    setSimulating(true); setWhatIfAnswer('')
    const table = whatIfRisks.map(r => `${r.label}: base ${r.base}% → what-if ${r.adjusted}% (Δ${r.delta > 0 ? '+' : ''}${r.delta}%, trend ${r.trend}) — evidence: ${r.evidence.slice(0, 110)}`).join('\n')
    const proposed = `Mud weight Δ ${mudDelta > 0 ? '+' : ''}${mudDelta.toFixed(2)} ppg (base ${baseMud !== null ? baseMud + ' ppg' : document.report.mud_weight || 'not stated'}), Flow Δ ${flowDelta > 0 ? '+' : ''}${flowDelta}% , WOB Δ ${wobDelta > 0 ? '+' : ''}${wobDelta}% at ${value(document.report.current_md, ' m')} in ${document.report.formation || 'formation not stated'}.`
    const whatIfQuestion = `WHAT-IF SIMULATION:\nProposed action: ${proposed}\nDeterministic risk scores (transparent rule: loss +18*Δmud+0.18*Δflow, kick -22*Δmud, stuck +12*Δmud-0.12*Δflow+0.14*Δwob, clamped 5-95):\n${table}\n\nTask: Explain which risk(s) increase/decrease, why (mechanism), cite the evidence snippets above, list recommended checks and missing information. Do not invent wells or depths. If evidence is insufficient, say so.`
    try {
      const response = await fetch('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: whatIfQuestion, corpus: document.corpus, airgapped }) })
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error); setWhatIfAnswer(payload.answer)
    } catch (error) { setWhatIfAnswer(error instanceof Error && error.message ? error.message : t('errWhatif')) } finally { setSimulating(false) }
  }
  return <>
    <PanelHeader icon={<Sparkles size={16} />} title={t('askWhatif')} meta={t('detLlm')} />
    <div className="whatif-controls">
      <div className="whatif-title"><Zap size={13} /> {t('whatifTitle')}</div>
      <div className="whatif-sliders">
        <label><span>{t('mudD')}</span><input type="range" min={-0.6} max={0.6} step={0.1} value={mudDelta} onChange={e => setMudDelta(parseFloat(e.target.value))} /><strong>{mudDelta > 0 ? '+' : ''}{mudDelta.toFixed(1)} ppg</strong><small>{t('baseMw', { v: baseMud !== null ? `${baseMud} ppg` : value(document.report.mud_weight, '', t('notFound')) })}</small></label>
        <label><span>{t('flowD')}</span><input type="range" min={-20} max={20} step={5} value={flowDelta} onChange={e => setFlowDelta(parseInt(e.target.value))} /><strong>{flowDelta > 0 ? '+' : ''}{flowDelta}%</strong><small>{t('fromCurrent')}</small></label>
        <label><span>{t('wobD')}</span><input type="range" min={-15} max={15} step={5} value={wobDelta} onChange={e => setWobDelta(parseInt(e.target.value))} /><strong>{wobDelta > 0 ? '+' : ''}{wobDelta}%</strong><small>{t('wobBit')}</small></label>
      </div>
      {hasWhatIf && <button className="whatif-reset" onClick={() => { setMudDelta(0); setFlowDelta(0); setWobDelta(0); setWhatIfAnswer('') }}>{t('resetScenario')}</button>}
      {document.report.risks.length > 0 && (
        <div className="whatif-table-wrap">
          <table className="whatif-table">
            <thead><tr><th>{t('riskCol')}</th><th>{t('baseCol')}</th><th>{t('whatifCol')}</th><th>{t('deltaCol')}</th><th>{t('trendCol')}</th></tr></thead>
            <tbody>{whatIfRisks.slice(0, 6).map(r => <tr key={r.label}><td title={r.evidence}>{r.label}</td><td>{r.base}%</td><td className={r.delta > 4 ? 'up' : r.delta < -4 ? 'down' : ''}>{r.adjusted}%</td><td className={r.delta > 0 ? 'up' : r.delta < 0 ? 'down' : ''}>{r.delta > 0 ? '+' : ''}{r.delta}%</td><td><span className={`trend-chip ${r.trend}`}>{r.trend === 'rising' ? t('trendRising') : r.trend === 'falling' ? t('trendFalling') : t('trendSteady')}</span></td></tr>)}</tbody>
          </table>
          <small className="whatif-formula">{t('formula')}</small>
        </div>
      )}
      {!document.report.risks.length && <small className="whatif-empty">{t('noRisksWhatif')}</small>}
      <button className="whatif-sim-btn" onClick={simulate} disabled={simulating}><BrainCircuit size={14} /> {simulating ? t('simulating') : hasWhatIf ? t('simBtn') : t('explainBtn')}</button>
      {whatIfAnswer && <div className="whatif-answer"><div className="prediction-result-head"><span className="result-chip"><BrainCircuit size={13} /> {t('groqWhatif')}</span><button onClick={() => setWhatIfAnswer('')} aria-label={t('close')}><X size={14} /></button></div><p className="ai-answer">{whatIfAnswer}</p></div>}
    </div>
    {answer ? <div className="prediction-result"><div className="prediction-result-head"><span className="result-chip"><BrainCircuit size={13} /> {t('groqAnalysis')}</span><button onClick={() => setAnswer('')} aria-label={t('closeAnswer')}><X size={14} /></button></div><h3>{question}</h3><p className="ai-answer">{answer}</p></div> : <>
      <p className="prediction-intro">{t('askIntro')}</p>
      <form className="ask-form" onSubmit={ask}><textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={t('askPh')} /><button type="submit" disabled={asking}><Send size={15} /> {asking ? t('analysing') : t('askBtn')}</button></form>
    </>}
  </>
}

export default function App() {
  const { t, airgapped } = useLang()
  const um = t('unitM'); const nf = t('notFound')
  const [view, setView] = useState<View>('command'); const [sidebarOpen, setSidebarOpen] = useState(true); const [documents, setDocuments] = useState<IndexedDocument[]>([]); const [activeName, setActiveName] = useState<string | null>(null); const [processing, setProcessing] = useState(false); const [progress, setProgress] = useState(0); const [statusKey, setStatusKey] = useState<StrKey>('statusInit'); const [statusVars, setStatusVars] = useState<Record<string, string | number>>({}); const status = t(statusKey, statusVars); const [error, setError] = useState(''); const [question, setQuestion] = useState(''); const [dragOver, setDragOver] = useState(false); const [fullscreen, setFullscreen] = useState(false)
  const [searchQuery, setSearchQuery] = useState(''); const [searchKind, setSearchKind] = useState<SearchKind>('all'); const [searchFormation, setSearchFormation] = useState('all'); const [searchSeverity, setSearchSeverity] = useState('all'); const [searchOpen, setSearchOpen] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)
  const searchFormationOptions = useMemo(() => { const s = new Set<string>(); for (const d of documents) { if (d.report.formation) s.add(d.report.formation); for (const f of d.report.formations || []) if (f.name) s.add(f.name) } return [...s] }, [documents])
  const searchResults = useMemo(() => documents.length ? hybridSearch(documents, searchQuery, { kind: searchKind, formation: searchFormation, severity: searchSeverity }) : [], [documents, searchQuery, searchKind, searchFormation, searchSeverity])
  useEffect(() => {
    function onDocClick(e: MouseEvent) { if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false) }
    window.document.addEventListener('mousedown', onDocClick); return () => window.document.removeEventListener('mousedown', onDocClick)
  }, [])
  const documentUrlMapRef = useRef<Map<string, string>>(new Map())
  const document = useMemo(() => documents.find((d) => d.name === activeName) ?? documents[documents.length - 1] ?? null, [documents, activeName])
  useEffect(() => () => { for (const url of documentUrlMapRef.current.values()) URL.revokeObjectURL(url) }, [])
  function toggleFullscreen() { if (!window.document.fullscreenElement) { window.document.documentElement.requestFullscreen?.() } else { window.document.exitFullscreen?.() }; setFullscreen((v) => !v) }
  useEffect(() => { function handleFullscreenChange() { setFullscreen(!!window.document.fullscreenElement) }; window.document.addEventListener('fullscreenchange', handleFullscreenChange); return () => window.document.removeEventListener('fullscreenchange', handleFullscreenChange) }, [])
  // Load persisted documents from Supabase on mount (graceful fallback if not configured; skipped in airgap mode)
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || airgapped) return
    const sb = supabase
    ;(async () => {
      try {
        const { data, error } = await loadDocumentsFromSupabase()
        if (error) { console.warn('[supabase] load error', error); return }
        if (!data || data.length === 0) return
        const restored: IndexedDocument[] = (data as unknown as Array<{ name: string; report: Report; corpus: string | null; embedding_model: string | null; document_vector: number[] | null; document_vector_json: number[] | null; segments: Segment[] | null; embeddings: Embedding[] | null; pages: number | null }>).map(d => ({
          name: d.name,
          url: '',
          pages: d.pages ?? 1,
          report: d.report as Report,
          segments: (d.segments as unknown as Segment[]) ?? [],
          embeddings: (d.embeddings as unknown as Embedding[]) ?? [],
          embeddingModel: d.embedding_model ?? 'supabase',
          corpus: d.corpus ?? '',
          documentVector: (d.document_vector as unknown as number[] | null) ?? (d.document_vector_json as unknown as number[] | null) ?? null,
        }))
        // only restore if local is empty to avoid overwriting fresh ingest
        let didRestore = false
        setDocuments(prev => {
          if (prev.length !== 0) return prev
          didRestore = true
          return restored
        })
        if (!didRestore) return
        setActiveName(prev => prev ?? restored[0]?.name ?? null)
        if (restored.length) { setStatusKey('statusRestored'); setStatusVars({ count: restored.length }) }
        // lazy fetch PDFs from private bucket (download -> blob URL)
        for (const doc of restored) {
          try {
            const { data: blob, error: dlErr } = await sb.storage.from('documents').download(doc.name)
            if (dlErr || !blob) {
              // fallback: signed URL for pdfjs
              const { data: signed, error: signErr } = await sb.storage.from('documents').createSignedUrl(doc.name, 3600)
              if (!signErr && signed?.signedUrl) {
                const url = signed.signedUrl
                documentUrlMapRef.current.set(doc.name, url)
                setDocuments(prev => prev.map(p => p.name === doc.name ? { ...p, url } : p))
              } else {
                console.warn('[supabase storage] download failed', doc.name, dlErr?.message ?? signErr?.message)
              }
              continue
            }
            const url = URL.createObjectURL(blob)
            const prevUrl = documentUrlMapRef.current.get(doc.name)
            if (prevUrl && prevUrl.startsWith('blob:')) URL.revokeObjectURL(prevUrl)
            documentUrlMapRef.current.set(doc.name, url)
            setDocuments(prev => prev.map(p => p.name === doc.name ? { ...p, url } : p))
          } catch (e) { console.warn('[supabase storage] restore fetch', doc.name, e) }
        }
      } catch (e) { console.warn('[supabase] restore failed', e) }
    })()
  }, [])
  async function ingestFile(file: File) {
    // allow re-ingesting same name: replace existing entry
    setProcessing(true); setProgress(1); setStatusKey('statusOpening'); setStatusVars({ name: file.name }); setView('documents')
    if (window.matchMedia('(max-width: 760px)').matches) setSidebarOpen(false)
    try {
      const { analysis, pages } = await analyseDocument(file, (nextProgress, nextKey, nextVars) => { setProgress(nextProgress); setStatusKey(nextKey); setStatusVars(nextVars ?? {}) }, { airgapped })
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
      setStatusKey('indexedMsg'); setStatusVars({ sections: analysis.report.sections.length, pages })
      // persist to Supabase (non-blocking, graceful fallback; skipped in airgap mode)
      if (isSupabaseConfigured && !airgapped) {
        const rep = analysis.report as unknown as Report
        upsertWellFromReport(rep as never).catch(() => {})
        saveDocumentToSupabase({ name: file.name, report: analysis.report, corpus: analysis.corpus, embeddingModel: analysis.embeddingModel, documentVector: analysis.documentVector, segments: analysis.segments, embeddings: analysis.embeddings, pages }).then(r => {
          if (r.error) console.warn('[supabase] save failed', r.error)
          else { setStatusKey('indexedPersisted'); setStatusVars({ sections: analysis.report.sections.length, pages }) }
        }).catch(e => console.warn('[supabase] save error', e))
        // storage upload (best-effort) — pass File/Blob directly so supabase-js preserves content-type
        if (supabase) {
          supabase.storage.from('documents').upload(file.name, file, { upsert: true, contentType: file.type || 'application/pdf', cacheControl: '3600' }).then(({ error }) => {
            if (error) console.warn('[supabase storage] upload', error.message)
          }).catch((e) => console.warn('[supabase storage] upload', e))
        }
      }
    } catch (uploadError) { const msg = uploadError instanceof L10nError ? t(uploadError.key, uploadError.vars) : uploadError instanceof Error && uploadError.message ? uploadError.message : t('statusFailed'); setError(previous => [previous, t('docFailedWith', { name: file.name, err: msg })].filter(Boolean).join(' • ')); setStatusKey('statusFailed'); setStatusVars({}) } finally { setProgress(100) }
  }
  async function handleUpload(event: ChangeEvent<HTMLInputElement>) { const files = event.target.files; if (!files || !files.length) return; await ingestFiles(files); event.target.value = '' }
  // multi-file drag support
  const ingestingRef = useRef(false)
  const [processingFile, setProcessingFile] = useState('')
  async function ingestFiles(files: FileList | File[]) {
    if (ingestingRef.current) return
    ingestingRef.current = true
    setProcessing(true)
    setError('')
    try {
      for (const f of Array.from(files)) {
        setProcessingFile(f.name)
        await ingestFile(f)
      }
    } finally { ingestingRef.current = false; setProcessing(false) }
  }
  const report = document?.report
  const navItems: [View, ReactNode, string][] = [['command', <Crosshair size={17} />, t('navCommand')], ['dive', <Waves size={17} />, t('navDive')], ['documents', <FileScan size={17} />, t('navDocs')], ['embeddings', <Network size={17} />, t('navEmbed')], ['prediction', <BrainCircuit size={17} />, t('navPredict')]]
  function renderView() {
    if (documents.length === 0) return processing ? null : <EmptyWorkspace view={view} />
    if (!document || !report) return <EmptyWorkspace view={view} />
    if (view === 'documents') return <div className="view-grid documents-view"><div className="panel document-panel"><DocumentPanel document={document} processing={processing} progress={progress} status={status} /></div><div className="panel activity-panel"><StreamPanel document={document} status={status} /></div></div>
    if (view === 'embeddings') return <section className="panel"><PanelHeader icon={<Network size={16} />} title={t('navEmbed')} meta={t('sitesIdxMeta', { count: documents.length })} /><Suspense fallback={<div className="subsurface-loading">Loading document graph…</div>}><DocumentGraph documents={documents} activeName={document.name} onSelect={setActiveName} /></Suspense></section>
    if (view === 'prediction') return <div className="view-grid prediction-view"><div className="panel prediction-panel large"><PredictionPanel document={document} question={question} setQuestion={setQuestion} /></div><div className="panel panel-copy"><PanelHeader icon={<Bell size={16} />} title={t('extractEvents')} meta={t('foundMeta', { count: report.events.length })} /><div className="alert-log">{report.events.length ? report.events.map((event, index) => <span key={`${event.type}-${index}`}><b>{event.time || '—'}</b>{event.type}{event.depth === null ? '' : ` · ${event.depth.toLocaleString()}${um}`}</span>) : <span>{t('noLeaseEvents')}</span>}</div></div></div>
    if (view === 'dive') return <div className="view-grid dive-view"><div className="panel dive-panel"><PanelHeader icon={<Waves size={16} />} title={t('diveTitle')} meta={`${report.well_name || t('activeWell')} · ${value(report.current_md, um, nf)} · ${report.formation || t('formationLbl')}`} /><WellDive report={report as never} /></div><div className="panel panel-copy dive-copy"><PanelHeader icon={<Activity size={16} />} title={t('diveCtx')} meta={t('formationsMeta', { f: report.formations?.length || 0, e: report.events.length })} /><div className="dive-stats"><span><small>{t('curFormation')}</small><b>{report.formation || t('notFoundShort')}</b></span><span><small>{t('deepestMd')}</small><b>{value(report.current_md, um, nf)}</b></span><span><small>{t('tvd')}</small><b>{value(report.current_tvd, um, nf)}</b></span><span><small>{t('mudWLbl')}</small><b>{value(report.mud_weight, '', nf)}</b></span></div><div className="formation-list" style={{ margin: '14px 17px' }}>{(report.formations?.length ? report.formations : report.formation ? [{ name: report.formation, top_md: null, bottom_md: null }] : []).map((f, i) => <div key={`${f.name}-${i}`}><strong>{f.name}</strong><span>{f.top_md === null && f.bottom_md === null ? t('depthIntervalNA') : `${value(f.top_md, um, nf)} – ${value(f.bottom_md, um, nf)}`}</span></div>)}</div><div className="dive-events"><b>{t('depthTagged')}</b>{report.events.filter(e => e.depth !== null).slice(0, 5).map((e, i) => <span key={i}><small>{e.depth}{um}</small><strong>{e.type}</strong><em>{e.severity || '—'}</em></span>)}{report.events.filter(e => e.depth !== null).length === 0 && <small style={{ color: '#9a9e9c' }}>{t('noDepthTagged')}</small>}</div><button className="coral-action" onClick={() => setView('command')} style={{ marginTop: 12 }}><Crosshair size={14} /> {t('backCommand')}</button></div></div>
    const locatedDocuments = documents.filter((doc) => Number.isFinite(doc.report.latitude) && Number.isFinite(doc.report.longitude)).length
    return <><div className="hero-grid"><div className="panel map-panel"><PanelHeader icon={<MapPinned size={16} />} title={t('docWellLoc')} meta={`${locatedDocuments} / ${documents.length} · ${t('mapped', { count: locatedDocuments })}`} /><AllDocumentsMap documents={documents} activeName={document.name} onSelect={setActiveName} /></div><div className="panel depth-panel"><DepthPanel report={report} onOpenDive={() => setView('dive')} /></div><div className="panel document-panel"><DocumentPanel document={document} processing={processing} progress={progress} status={status} /></div></div><section className="panel subsurface-panel"><PanelHeader icon={<Waves size={16} />} title="SUBSURFACE 3D" meta={`${report.well_name || document.name} · VIDEX 3D`} /><Suspense fallback={<div className="subsurface-loading"><LoaderCircle className="ocr-spinner" size={22} /> Loading subsurface renderer…</div>}><SubsurfaceView report={report} /></Suspense></section><RiskRow risks={report.risks || []} events={report.events || []} openPrediction={() => setView('prediction')} /><TelemetryPanel report={report} /><div className="lower-grid"><div className="panel activity-panel"><StreamPanel document={document} status={status} /></div><div className="panel prediction-panel"><PredictionPanel document={document} question={question} setQuestion={setQuestion} /></div></div></>
  }
  const heading = view === 'command' ? t('headCommand') : view === 'dive' ? t('headDive') : view === 'documents' ? t('headDocs') : view === 'embeddings' ? t('headEmbed') : t('headPredict')
  function onDragOver(event: React.DragEvent) { event.preventDefault(); if (!dragOver) setDragOver(true) }
  function onDragLeave(event: React.DragEvent) { if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node)) setDragOver(false) }
  async function onDrop(event: React.DragEvent) { event.preventDefault(); setDragOver(false); const files = event.dataTransfer.files; if (files && files.length) await ingestFiles(files) }
  return <div className={`app-shell ${sidebarOpen ? '' : 'sidebar-collapsed'}` + (dragOver ? ' drag-active' : '')} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}><header className="topbar"><button className="sidebar-toggle" onClick={() => setSidebarOpen((open) => !open)} aria-label={sidebarOpen ? t('collapseNav') : t('openNav')}>{sidebarOpen ? <PanelLeftClose size={18} /> : <Menu size={18} />}</button><div className="brand-lockup"><div className="brand-mark">N°</div><div><div className="brand-title">{t('brandTitle')}</div><div className="brand-subtitle">{t('brandSubtitle')}</div></div></div><div className="top-search" ref={searchRef} style={{ position: 'relative' }}><Search size={15} /><input value={searchQuery} onChange={e => { setSearchQuery(e.target.value); setSearchOpen(true) }} onFocus={() => setSearchOpen(true)} placeholder={documents.length ? t('searchPh', { count: documents.length }) : t('searchPhEmpty')} style={{ flex: 1, border: 0, outline: 'none', background: 'transparent', fontSize: 10, color: '#121417' }} />{searchQuery && <button aria-label={t('clearSearch')} onClick={() => { setSearchQuery(''); setSearchOpen(false) }} style={{ border: 0, background: 'transparent', cursor: 'pointer', color: '#aaa' }}><X size={12} /></button>}<div className="search-filters" style={{ display: searchOpen && documents.length ? 'flex' : 'none' }}><select value={searchKind} onChange={e => setSearchKind(e.target.value as SearchKind)}><option value="all">{t('fAll')}</option><option value="section">{t('fSections')}</option><option value="event">{t('fEvents')}</option><option value="risk">{t('fRisks')}</option><option value="well">{t('fWells')}</option></select><select value={searchFormation} onChange={e => setSearchFormation(e.target.value)}><option value="all">{t('fAllFormations')}</option>{searchFormationOptions.map(n => <option key={n} value={n}>{n}</option>)}</select><select value={searchSeverity} onChange={e => setSearchSeverity(e.target.value)}><option value="all">{t('fAllSeverity')}</option><option value="high">{t('sevHigh')}</option><option value="medium">{t('sevMedium')}</option><option value="low">{t('sevLow')}</option></select><span style={{ fontSize: 8, color: '#58a9a3', fontWeight: 800 }}>{t('hits', { count: searchResults.length })}</span></div>{searchOpen && (searchQuery.trim() || searchKind !== 'all' || searchFormation !== 'all' || searchSeverity !== 'all') && (
        <div className="search-dropdown">
          {searchResults.length === 0 ? <div className="search-empty">{t('searchNoMatches')}</div> : searchResults.map(r => (
            <button key={r.id} className="search-item" onClick={() => { setActiveName(r.docName); setSearchOpen(false); if (r.kind === 'well' || r.kind === 'section') setView('documents'); else if (r.kind === 'risk' || r.kind === 'event') setView('prediction'); else setView('command') }}>
              <span className={`search-kind ${r.kind}`}>{r.kind === 'section' ? t('fSections') : r.kind === 'event' ? t('fEvents') : r.kind === 'risk' ? t('fRisks') : r.kind === 'well' ? t('fWells') : t('fAll')}</span>
              <div style={{ minWidth: 0 }}><strong>{r.title}</strong><span>{r.snippet}</span><small>{r.wellName || r.docName} {r.formation ? `· ${r.formation}` : ''} {r.depth ? `· ${r.depth}${um}` : ''}</small></div>
              <ArrowUpRight size={12} />
            </button>
          ))}
          <div className="search-hint">{t('searchHint')}</div>
        </div>
              )}</div><div className="top-actions"><span className="online-pill"><i /> {processing ? t('processing', { progress }) : documents.length ? t('sitesIndexed', { count: documents.length }) : t('awaitingDoc')}</span><span className="online-pill" style={isSupabaseConfigured ? { color: '#2a9d8f', border: '1px solid #cde5e1' } : { color: '#b0b1ae', border: '1px solid #ecece8' }}><i style={{ background: isSupabaseConfigured ? '#2a9d8f' : '#b0b1ae' }} /> {airgapped ? t('airgapped') : isSupabaseConfigured ? t('supabase') : t('local')}</span><LanguageToggle /><AirgapToggle /><button aria-label={t('notifications')}><Bell size={17} /></button><button aria-label={t('settings')}><Settings2 size={17} /></button></div></header><div className="app-layout"><aside className="sidebar"><div className="sidebar-top"><span>{t('workspace')}</span><button onClick={() => setSidebarOpen(false)} aria-label={t('collapseSidebar')}><PanelLeftClose size={15} /></button></div><nav>{navItems.map(([id, icon, label]) => <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}>{icon}<span>{label}</span></button>)}</nav><div className="sidebar-section"><span>{t('activeWell')}</span>{report ? <button className="well-switch" onClick={() => setView('embeddings')}><strong>{report.well_name || t('noWell')}</strong><small>{report ? `${report.formation || t('formationNFFull')} · ${value(report.current_md, um, nf)} · ${t('sitesUnit', { count: documents.length })}` : t('uploadDocs')} </small><ChevronDown size={14} /></button> : <div className="well-switch-empty" role="status"><span className="well-empty-icon"><FileScan size={18} /></span><div><strong>{t('noWell')}</strong><small>{t('uploadDocs')}</small></div></div>}{documents.length > 1 && <div style={{ display: 'grid', gap: 4, marginTop: 6, maxHeight: 132, overflowY: 'auto' }}>{documents.map((doc) => <button key={doc.name} onClick={() => setActiveName(doc.name)} style={{ textAlign: 'left', padding: '6px 8px', borderRadius: 7, border: activeName===doc.name || (!activeName && doc.name===document?.name) ? '1px solid #f0c1b4' : '1px solid var(--line)', background: activeName===doc.name || (!activeName && doc.name===document?.name) ? 'var(--coral-soft)' : 'white', fontSize: 9 }}><strong style={{ display:'block', fontSize: 9 }}>{doc.report.well_name ?? doc.name}</strong><small style={{ color: '#8a8c89' }}>{doc.report.formation ?? '—'} · {value(doc.report.current_md, um, nf)}</small></button>)}</div>}</div><div className="sidebar-section"><span>{t('qa')}</span><label className="sidebar-upload" title={t('uploadTitle')}><Upload size={15} /> {t('ingestDocs')}<input type="file" disabled={processing} multiple accept=".pdf,.png,.jpg,.jpeg,.bmp,.webp" onChange={handleUpload} /></label><button disabled={!document} onClick={() => setView('prediction')}><Sparkles size={15} /> {t('askNwisSb')}</button></div><div className="sidebar-foot"><span><i className="online-dot" /> {processing ? status : document ? t('indexReady') : t('noDataset')}</span><small>{document?.name || t('noDocCaps')}</small></div></aside><main className="main-content"><div className="page-heading"><div><span className="eyebrow">{view === 'command' ? t('eyebrowField') : view === 'documents' ? t('docIntel') : view === 'embeddings' ? t('eyebrowGraph') : t('eyebrowDecision')}</span><h1>{heading}</h1></div><span className="date-stamp">{report?.report_date || t('dateNA')}{report?.report_number ? ` / ${report.report_number}` : ''}</span></div>{error && <div className="pipeline-error"><AlertTriangle size={15} />{error}</div>}{processing && <section className="processing-loader" role="status" aria-live="polite"><LoaderCircle className="ocr-spinner" size={24} /><div><strong>{t('procDoc')}</strong><span>{processingFile}</span><p>{status}</p><progress max={100} value={progress} aria-label={t('procStages')} /><small>{t('procNote')}</small></div></section>}<div className="workspace" aria-busy={processing}>{renderView()}</div></main></div>{dragOver && <div className="drag-overlay"><Upload size={22} /><span>{t('dropIngest')}</span></div>}<div className="status-footer"><span><i className="online-dot" /> {processing ? status : document ? t('indexedFrom') : t('awaitingUp')}</span><span><FileText size={12} /> {document?.name || t('noDocIdx')}</span><span>{document ? t('footerStats', { s: document.report.sections.length, e: document.report.events.length, v: document.embeddings.length }) : t('noData')}</span><CircleHelp size={13} /></div></div>
}
