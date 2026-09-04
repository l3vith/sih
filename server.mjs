import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import { Groq } from 'groq-sdk'
import { pipeline } from '@huggingface/transformers'
import { GoogleGenAI } from '@google/genai'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
const supabase = supabaseUrl && supabaseServiceKey ? createClient(supabaseUrl, supabaseServiceKey) : null
if (supabase) console.log('[supabase] server client initialized')
else console.log('[supabase] not configured — running in local-only mode')

const app = express()
app.use(cors())
app.use(express.json({ limit: '8mb' }))

const model = 'openai/gpt-oss-120b'
const embeddingModel = 'Xenova/all-MiniLM-L6-v2'
const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null
let extractorPromise
// Google GenAI as FIRST try (has vision) – https://ai.google.dev/gemma
const googleApiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || 'AIzaSyAjzMcjGZmQa5giPsmt3VA_BQL0gcQiNBw'
const googleModel = process.env.GOOGLE_MODEL || 'gemma-4-26b-a4b-it'
const googleAI = googleApiKey ? new GoogleGenAI({ apiKey: googleApiKey }) : null
async function googleChat({ messages, temperature = 0.05, max_tokens = 1200 }) {
  if (!googleAI) throw new Error('Google AI not configured')
  const prompt = messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n')
  const response = await googleAI.models.generateContent({
    model: googleModel,
    contents: prompt,
    config: { temperature, maxOutputTokens: max_tokens },
  })
  const text = typeof response.text === 'function' ? response.text() : response.text
  const out = typeof text === 'string' ? text : String(text || '')
  if (!out.trim()) throw new Error('Google AI returned empty')
  return out
}
async function googleVisionOCR(imageBase64, mimeType = 'image/png') {
  if (!googleAI) throw new Error('Google AI not configured')
  const cleanB64 = String(imageBase64).replace(/^data:[^,]+,/, '')
  const response = await googleAI.models.generateContent({
    model: googleModel,
    contents: [
      {
        role: 'user',
        parts: [
          { text: 'You are a drilling report OCR. Extract ALL text from this image. Preserve line breaks and table layout. Return only the transcribed text, no explanation.' },
          { inlineData: { mimeType, data: cleanB64 } },
        ],
      },
    ],
    config: { temperature: 0.1, maxOutputTokens: 4000 },
  })
  const text = typeof response.text === 'function' ? response.text() : response.text
  return typeof text === 'string' ? text : String(text || '')
}
// Osaurus local LLM fallback for LLM-only queries (http://127.0.0.1:1337)
const osaurusUrl = process.env.OSAURUS_URL || 'http://127.0.0.1:1337'
const osaurusModelEnv = process.env.OSAURUS_MODEL || 'gemma-4-e2b-it-qat-mxfp4'
let cachedOsaurusModel = null
async function getOsaurusModel() {
  if (cachedOsaurusModel) return cachedOsaurusModel
  // Respect explicit requested id (qat-mxfp4) directly – don't auto-discover 8bit
  if (osaurusModelEnv === 'gemma-4-e2b-it-qat-mxfp4') { cachedOsaurusModel = osaurusModelEnv; return cachedOsaurusModel }
  if (process.env.OSAURUS_MODEL) { cachedOsaurusModel = process.env.OSAURUS_MODEL; return cachedOsaurusModel }
  try {
    const r = await fetch(`${osaurusUrl}/models`, { signal: AbortSignal.timeout(3000) })
    if (r.ok) {
      const j = await r.json()
      const id = j?.data?.[0]?.id || j?.models?.[0]?.name || j?.models?.[0]?.id
      if (id) { cachedOsaurusModel = id; return cachedOsaurusModel }
    }
  } catch {}
  try {
    const r = await fetch(`${osaurusUrl}/tags`, { signal: AbortSignal.timeout(3000) })
    if (r.ok) {
      const j = await r.json()
      const id = j?.models?.[0]?.name || j?.models?.[0]?.id
      if (id) { cachedOsaurusModel = id; return cachedOsaurusModel }
    }
  } catch {}
  cachedOsaurusModel = osaurusModelEnv
  return cachedOsaurusModel
}
async function osaurusChat({ messages, temperature = 0.05, max_tokens = 1200, response_format }) {
  const mdl = await getOsaurusModel()
  // Osaurus gemma with response_format:json_object is strict and can 400 on truncation – omit for fallback and rely on jsonFrom repair
  const body = { model: mdl, messages, temperature, max_tokens }
  // only pass response_format if caller explicitly wants it and model is not gemma fallback (qAT/mxfp4 is also gemma)
  if (response_format && !mdl.includes('gemma-4-e2b')) body.response_format = response_format
  const res = await fetch(`${osaurusUrl}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) })
  if (!res.ok) throw new Error(`Osaurus ${res.status}: ${await res.text().then((t) => t.slice(0, 800))}`)
  const data = await res.json()
  const content = data?.choices?.[0]?.message?.content
  if (!content) throw new Error('Osaurus returned empty content')
  return content
}
const clean = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

function jsonFrom(value) {
  const cleaned = String(value || '').replace(/```json|```/gi, '').trim()
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('Groq did not return a JSON object.')
  const candidate = match[0]
  try { return JSON.parse(candidate) } catch {
    // Repair common LLM JSON slips: trailing commas, stray newlines
    const repaired = candidate.replace(/,\s*([}\]])/g, '$1').replace(/[\u2018\u2019]/g, "'")
    return JSON.parse(repaired)
  }
}

function fallbackReport(text, headings) {
  const raw = String(text || '')
  // Robust field extraction: take text between label: and next label: to handle inline table cells (pdfjs linearizes rows)
  const nextLabelPattern = '(?:Report Date|API\\s*\\/\\s*UWI|Report No|Latitude|Spud Date|Longitude|Operator|Lease\\/Block|Rig Name|Current MD|Midnight MD|Current TVD|Progress|Avg ROP|Rotating Hours|Formation|Hole section|Mud Type|Mud Weight|Viscosity|PV\\s*\\/\\s*YP|Oil\\/Water Ratio|Chlorides|From|To|Hrs|Code|Operational Description|Interval|Observed condition|Risk interpretation|Time|Event|Depth|Severity|Mitigation|Survey MD|Inclination|Azimuth|TVD|Offset well|Planned casing|Setting depth|Cement objective|Watch item)\\s*(?:\\([^)]*\\))?\\s*:'
  const fieldValue = (label) => {
    const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(esc + '(?:\\s*\\([^)]*\\))?\\s*:\\s*', 'i')
    const m = raw.match(re)
    if (!m || m.index === undefined) return null
    const start = m.index + m[0].length
    const sub = raw.slice(start)
    const probe = sub.slice(0, 600)
    const nextRe = new RegExp(nextLabelPattern, 'i')
    const nextIdx = probe.search(nextRe)
    let val
    if (nextIdx !== -1) val = sub.slice(0, nextIdx)
    else {
      const nl = sub.indexOf('\n')
      val = nl !== -1 ? sub.slice(0, nl) : sub.slice(0, 120)
    }
    return val.trim().replace(/\s+/g, ' ').replace(/\[PAGE[^\]]*\]/gi, '').trim() || null
  }
  const num = (label) => {
    const v = fieldValue(label)
    if (!v) return null
    const n = parseFloat(String(v).replace(/,/g, '').match(/[\d.]+/)?.[0] || '')
    return Number.isFinite(n) ? n : null
  }
  const lat = num('Latitude')
  const lon = num('Longitude')
  return {
    well_name: fieldValue('Well Name'),
    report_date: fieldValue('Report Date'),
    report_number: fieldValue('Report No'),
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(lon) ? lon : null,
    current_md: num('Current MD'),
    current_tvd: num('Current TVD'),
    formation: fieldValue('Formation'),
    mud_weight: fieldValue('Mud Weight'),
    operator: fieldValue('Operator'),
    rig_name: fieldValue('Rig Name'),
    lease_block: fieldValue('Lease/Block'),
    progress: num('Progress'),
    avg_rop: num('Avg ROP'),
    formations: [],
    events: [],
    risks: [],
    offset_wells: [],
    sections: headings.map((h) => ({ label: h, anchor: h, summary: '', evidence: String(text).slice(0, 400) })),
  }
}

function isHeading(line) {
  if (line.length < 8 || line.length > 96 || !/[A-Z]{3}/.test(line)) return false
  if (/^(?:\[PAGE|PAGE \d|NWIS DEMO DATASET|DAILY DRILLING REPORT|DDR CONTINUATION|INTELLIGENCE$)/i.test(line)) return false
  const letters = line.match(/[A-Za-z]/g) || []
  const uppercase = line.match(/[A-Z]/g) || []
  return letters.length >= 6 && uppercase.length / letters.length > .88 && line.split(/\s+/).length >= 2
}

function isHeadingRelaxed(line) {
  // Handwritten / OCR fallback: allow Title Case, lower uppercase ratio, shorter lines
  const t = line.trim()
  if (t.length < 5 || t.length > 96) return false
  if (/^(?:\[PAGE|PAGE \d|NWIS DEMO DATASET|DAILY DRILLING REPORT|DDR CONTINUATION|INTELLIGENCE$)/i.test(t)) return false
  const letters = t.match(/[A-Za-z]/g) || []
  if (letters.length < 4) return false
  // Accept either ALLCAPS-ish or Title Case (first letter capital)
  const isTitleCase = /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/.test(t) || /^[A-Z][A-Z\s\/&-]+$/.test(t)
  if (!isTitleCase && !/[A-Z]{2}/.test(t)) return false
  return t.split(/\s+/).length >= 2
}

function detectHeadings(text, words) {
  const hasHandwritten = Array.isArray(words) && words.some((w) => w.fromOcr)
  const lines = String(text).split(/\r?\n/).map((line) => line.trim().replace(/\s+/g, ' '))
  const pageLines = new Map()
  for (const word of words) {
    const page = Number(word.page)
    const y = Number(word.y)
    if (!Number.isFinite(page) || !Number.isFinite(y) || !String(word.text || '').trim()) continue
    const existing = pageLines.get(page) || []
    const yTol = hasHandwritten ? Math.max(1.2, Number(word.h || 0) * 0.8) : Math.max(.75, Number(word.h || 0) * .55)
    let line = existing.find((candidate) => Math.abs(candidate.y - y) <= yTol)
    if (!line) { line = { y, words: [] }; existing.push(line); pageLines.set(page, existing) }
    line.words.push(word)
  }
  for (const page of [...pageLines.keys()].sort((a, b) => a - b)) {
    for (const line of pageLines.get(page).sort((a, b) => a.y - b.y)) {
      lines.push(line.words.sort((a, b) => Number(a.x) - Number(b.x)).map((word) => String(word.text).trim()).join(' ').replace(/\s+/g, ' ').trim())
    }
  }
  const strict = lines.filter((line) => isHeading(line))
  if (strict.length > 0 || !hasHandwritten) return [...new Set(strict)]
  // Handwritten fallback: relaxed heading
  const relaxed = lines.filter((line) => isHeadingRelaxed(line))
  return [...new Set(relaxed.length ? relaxed : strict)]
}

function locateSegments(sections, words) {
  const isHandwritten = Array.isArray(words) && words.some((w) => w.fromOcr)
  const threshold = isHandwritten ? 0.32 : 0.58
  const hits = []
  for (const [index, section] of sections.entries()) {
    const anchor = clean(section.anchor || section.label)
    const anchorTokens = new Set(anchor.split(' ').filter((token) => token.length > 1))
    // For handwritten, also try bigrams for better fuzzy match
    const match = words.map((word) => {
      const candidate = clean(word.text)
      const candidateTokens = new Set(candidate.split(' ').filter((token) => token.length > 1))
      const overlap = [...anchorTokens].filter((token) => candidateTokens.has(token)).length
      const coverage = overlap / Math.max(1, anchorTokens.size)
      const score = candidate.includes(anchor) || anchor.includes(candidate) ? 2 + coverage : coverage
      return { word, score }
    }).filter(({ score }) => score >= threshold).sort((a, b) => b.score - a.score)[0]?.word
    if (match) hits.push({ page: Number(match.page), x: 3.5, y: Math.max(0, Number(match.y) - .8), w: 93, h: 10, label: String(section.label || 'Section').toUpperCase(), tone: index % 2 ? 'amber' : 'cyan' })
  }
  // Fallback: if no heading/word matches (common for handwritten scans where OCR text diverges from anchor), distribute sections evenly so viewer always shows borders
  if (hits.length === 0 && sections.length > 0) {
    const byPage = new Map()
    // Group sections by page if we have any hit hints, else assume all on page 1 for single-page scans
    const pageForFallback = words.length ? Math.min(...words.map((w) => Number(w.page) || 1)) : 1
    for (const s of sections) {
      const p = pageForFallback
      if (!byPage.has(p)) byPage.set(p, [])
      byPage.get(p).push(s)
    }
    for (const [page, secs] of byPage.entries()) {
      secs.forEach((sec, idx) => {
        const y = 8 + (idx / Math.max(1, secs.length)) * 78
        hits.push({ page, x: 3.5, y, w: 93, h: Math.max(7, 78 / secs.length - 1.5), label: String(sec.label || 'Section').toUpperCase(), tone: idx % 2 ? 'amber' : 'cyan' })
      })
    }
  }
  return hits.map((hit) => {
    const next = hits.filter((candidate) => candidate.page === hit.page && candidate.y > hit.y).sort((a, b) => a.y - b.y)[0]
    return { ...hit, h: Math.max(7, Math.min(38, next ? next.y - hit.y - 1.25 : 18)) }
  })
}

function semanticProjection(vectors) {
  if (vectors.length === 1) return [{ x: 50, y: 50 }]
  const dimensions = vectors[0].length
  const mean = Array.from({ length: dimensions }, (_, dimension) => vectors.reduce((sum, vector) => sum + vector[dimension], 0) / vectors.length)
  const centered = vectors.map((vector) => vector.map((value, dimension) => value - mean[dimension]))
  const gram = centered.map((left) => centered.map((right) => left.reduce((sum, value, dimension) => sum + value * right[dimension], 0)))
  const power = (matrix, seed) => {
    let vector = matrix.map((_, index) => Math.sin((index + 1) * seed) + .1)
    for (let iteration = 0; iteration < 60; iteration += 1) {
      const next = matrix.map((row) => row.reduce((sum, value, column) => sum + value * vector[column], 0))
      const norm = Math.hypot(...next) || 1
      vector = next.map((value) => value / norm)
    }
    const product = matrix.map((row) => row.reduce((sum, value, column) => sum + value * vector[column], 0))
    const eigenvalue = vector.reduce((sum, value, index) => sum + value * product[index], 0)
    return { vector, eigenvalue: Math.max(0, eigenvalue) }
  }
  const first = power(gram, 1.7)
  const deflated = gram.map((row, i) => row.map((value, j) => value - first.eigenvalue * first.vector[i] * first.vector[j]))
  const second = power(deflated, 2.3)
  const raw = vectors.map((_, index) => ({ x: first.vector[index] * Math.sqrt(first.eigenvalue), y: second.vector[index] * Math.sqrt(second.eigenvalue) }))
  const xs = raw.map((point) => point.x); const ys = raw.map((point) => point.y)
  const xMin = Math.min(...xs); const xMax = Math.max(...xs); const yMin = Math.min(...ys); const yMax = Math.max(...ys)
  return raw.map((point, index) => ({ x: 12 + ((point.x - xMin) / Math.max(.0001, xMax - xMin)) * 76, y: vectors.length === 2 ? 50 + (index ? 12 : -12) : 12 + ((point.y - yMin) / Math.max(.0001, yMax - yMin)) * 76 }))
}

function fallbackVectors(source, dim = 384) {
  // Deterministic hash-based vectors when the transformer model is offline – keeps the explorer usable without network.
  const vectors = source.map((entry) => {
    const text = String(entry.text || '').toLowerCase()
    const hashed = Array.from({ length: dim }, (_, i) => {
      let h = 2166136261
      for (let c = 0; c < text.length; c += 1) h = Math.imul(h ^ text.charCodeAt(c + i * 7), 16777619)
      return ((h >>> 8) % 2000) / 1000 - 1
    })
    const norm = Math.hypot(...hashed) || 1
    return hashed.map((v) => v / norm)
  })
  const coordinates = semanticProjection(vectors)
  return { vectors, coordinates }
}

async function getDocumentVector(report, corpus) {
  const docText = [
    report.well_name, report.formation, report.lease_block, report.operator,
    ...report.sections.map((s) => s.summary),
    ...report.events.map((e) => `${e.type} ${e.evidence}`),
    ...report.risks.map((r) => r.label),
    String(corpus || '').slice(0, 1500),
  ].filter(Boolean).join(' | ').slice(0, 2000)
  if (!docText.trim()) return null
  try {
    extractorPromise ||= pipeline('feature-extraction', embeddingModel)
    const extractor = await extractorPromise
    const tensor = await extractor([docText], { pooling: 'mean', normalize: true })
    const list = tensor.tolist()
    // transformers.js returns [[...384]] for single input; handle both shapes
    return Array.isArray(list[0]) ? list[0] : list
  } catch (error) {
    console.warn('[documentVector] transformer unavailable, using fallback:', error instanceof Error ? error.message : String(error))
    extractorPromise = undefined
    const text = docText.toLowerCase()
    const dim = 384
    const hashed = Array.from({ length: dim }, (_, i) => {
      let h = 2166136261
      for (let c = 0; c < text.length; c += 1) h = Math.imul(h ^ text.charCodeAt(c + i * 7), 16777619)
      return ((h >>> 8) % 2000) / 1000 - 1
    })
    const norm = Math.hypot(...hashed) || 1
    return hashed.map((v) => v / norm)
  }
}

async function textEmbeddings(text, sections) {
  const source = sections.length ? sections.map((section) => ({ label: section.label, text: String(section.evidence || section.summary || section.label) })) : String(text).split(/\n{2,}|(?<=[.!?])\s+/).filter((chunk) => chunk.trim().length > 25).slice(0, 40).map((chunk, index) => ({ label: `Passage ${index + 1}`, text: chunk }))
  if (!source.length) return []
  try {
    extractorPromise ||= pipeline('feature-extraction', embeddingModel)
    const extractor = await extractorPromise
    const tensor = await extractor(source.map((entry) => entry.text), { pooling: 'mean', normalize: true })
    const vectors = tensor.tolist()
    const coordinates = semanticProjection(vectors)
    return source.map((entry, index) => ({ id: `chunk-${index + 1}`, label: String(entry.label || `Passage ${index + 1}`), excerpt: entry.text.slice(0, 240), x: coordinates[index].x, y: coordinates[index].y }))
  } catch (error) {
    console.warn('[embeddings] transformer unavailable, using fallback vectors:', error instanceof Error ? error.message : String(error))
    extractorPromise = undefined
    const { coordinates } = fallbackVectors(source, 384)
    return source.map((entry, index) => ({ id: `chunk-${index + 1}`, label: String(entry.label || `Passage ${index + 1}`), excerpt: entry.text.slice(0, 240), x: coordinates[index].x, y: coordinates[index].y }))
  }
}

app.get('/api/health', (_req, res) => res.json({ ready: Boolean(groq), model, embeddingModel, embeddingsReady: true, googleModel, osaurusModel: osaurusModelEnv, supabase: Boolean(supabase) }))
app.get('/api/supabase/health', (_req, res) => res.json({ configured: Boolean(supabase), url: supabaseUrl ? supabaseUrl.slice(0, 28) + '...' : null }))
// Proxy for documents when RLS blocks anon — uses service key
app.get('/api/supabase/documents', async (_req, res) => {
  if (!supabase) return res.status(503).json({ error: 'Supabase not configured' })
  const { data, error } = await supabase.from('documents').select('*').order('created_at', { ascending: false }).limit(50)
  if (error) return res.status(500).json({ error: error.message })
  res.json({ data })
})

// Vision OCR via Google Gemma (first try for images, has vision)
app.post('/api/vision-ocr', async (req, res) => {
  const { imageBase64, mimeType } = req.body || {}
  const b64 = String(imageBase64 || '').replace(/^data:[^,]+,/, '')
  if (!b64) return res.status(400).json({ error: 'imageBase64 required' })
  try {
    const text = await googleVisionOCR(b64, mimeType || 'image/png')
    res.json({ text })
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
  }
})

app.post('/api/structure-ddr', async (req, res) => {
  if (!groq) return res.status(503).json({ error: 'GROQ_API_KEY is not configured.' })
  const text = String(req.body?.text || '').slice(0, 12000)
  const words = Array.isArray(req.body?.words) ? req.body.words.slice(0, 8000) : []
  if (!text.trim()) return res.status(400).json({ error: 'No OCR text supplied.' })
  try {
    const headingCandidates = detectHeadings(text, words)
    let report
    // Build messages once for all LLM tries
    const structureMessages = [
      { role: 'system', content: 'You extract factual oil and gas drilling data. Never infer missing values. Use null or [] when the document does not explicitly contain a value. Return JSON only.' },
      { role: 'user', content: `Extract this drilling document using this exact schema:
{"well_name":string|null,"report_date":string|null,"report_number":string|null,"latitude":number|null,"longitude":number|null,"current_md":number|null,"current_tvd":number|null,"formation":string|null,"mud_weight":string|null,"operator":string|null,"rig_name":string|null,"lease_block":string|null,"progress":number|null,"avg_rop":number|null,"formations":[{"name":string,"top_md":number|null,"bottom_md":number|null}],"events":[{"time":string|null,"type":string,"depth":number|null,"severity":"high"|"medium"|"low"|null,"mitigation":string|null,"evidence":string}],"risks":[{"label":string,"probability":number|null,"trend":"rising"|"steady"|"falling"|null,"evidence":string}],"offset_wells":[{"id":string,"latitude":number|null,"longitude":number|null,"depth":number|null,"distance_km":number|null,"relationship":string|null}],"sections":[{"label":string,"anchor":string,"summary":string,"evidence":string}]}
Probability must be null unless the document explicitly states a percentage. Preserve coordinate signs. Do not invent offset wells, depths, events, formations, or risks.
The OCR layout detector found these top-level headings: ${JSON.stringify(headingCandidates)}
sections MUST contain exactly one entry for every heading in that list, in document order. anchor must exactly copy that heading. label may normalize capitalization but not meaning. evidence must be a concise verbatim excerpt from that section.
OCR TEXT:\n${text}` },
    ]
    try {
      // FIRST TRY: Google GenAI (gemma-4-26b-a4b-it) – has vision, best for handwritten
      const googleContent = await googleChat({ messages: structureMessages, temperature: 0.05, max_tokens: 1800 })
      report = jsonFrom(googleContent)
      console.log('[structure-ddr] Google succeeded')
    } catch (googleErr) {
      console.warn('[structure-ddr] Google failed, falling back to Groq:', googleErr instanceof Error ? googleErr.message.slice(0, 300) : String(googleErr).slice(0, 300))
      try {
        const completion = await groq.chat.completions.create({
          model, temperature: 0.05, max_completion_tokens: 3200, response_format: { type: 'json_object' },
          messages: structureMessages,
        })
      report = jsonFrom(completion.choices[0]?.message?.content)
    } catch (groqErr) {
      const msg = groqErr instanceof Error ? groqErr.message : String(groqErr)
      if (msg.includes('429') || msg.includes('rate_limit') || msg.includes('Rate limit')) {
        console.warn('[structure-ddr] Groq rate limited, trying Osaurus fallback...')
        try {
          const osaurusContent = await osaurusChat({
            messages: [
              { role: 'system', content: 'You extract factual oil and gas drilling data. Never infer missing values. Use null or [] when the document does not explicitly contain a value. Return JSON only.' },
              { role: 'user', content: `Extract this drilling document using this exact schema:
{"well_name":string|null,"report_date":string|null,"report_number":string|null,"latitude":number|null,"longitude":number|null,"current_md":number|null,"current_tvd":number|null,"formation":string|null,"mud_weight":string|null,"operator":string|null,"rig_name":string|null,"lease_block":string|null,"progress":number|null,"avg_rop":number|null,"formations":[{"name":string,"top_md":number|null,"bottom_md":number|null}],"events":[{"time":string|null,"type":string,"depth":number|null,"severity":"high"|"medium"|"low"|null,"mitigation":string|null,"evidence":string}],"risks":[{"label":string,"probability":number|null,"trend":"rising"|"steady"|"falling"|null,"evidence":string}],"offset_wells":[{"id":string,"latitude":number|null,"longitude":number|null,"depth":number|null,"distance_km":number|null,"relationship":string|null}],"sections":[{"label":string,"anchor":string,"summary":string,"evidence":string}]}
Probability must be null unless the document explicitly states a percentage. Preserve coordinate signs. Do not invent offset wells, depths, events, formations, or risks.
The OCR layout detector found these top-level headings: ${JSON.stringify(headingCandidates)}
sections MUST contain exactly one entry for every heading in that list, in document order. anchor must exactly copy that heading. label may normalize capitalization but not meaning. evidence must be a concise verbatim excerpt from that section.
OCR TEXT:\n${text}` },
            ],
            temperature: 0.05, max_tokens: 1500,
          })
          report = jsonFrom(osaurusContent)
          console.log('[structure-ddr] Osaurus fallback succeeded')
        } catch (osaurusErr) {
          console.warn('[structure-ddr] Osaurus fallback failed, using regex fallback:', osaurusErr instanceof Error ? osaurusErr.message : String(osaurusErr))
          report = fallbackReport(text, headingCandidates)
        }
      } else {
        throw groqErr
      }
    }
    }
    // Ensure sections align with detected headings – groq may still miss one if OCR is noisy
    let sections = Array.isArray(report.sections) ? report.sections : []
    if (headingCandidates.length && sections.length !== headingCandidates.length) {
      console.warn(`[structure-ddr] heading/section mismatch: ${headingCandidates.length} headings vs ${sections.length} sections`)
    }
    const embeddings = await textEmbeddings(text, sections)
    const documentVector = await getDocumentVector(report, text)
    // best-effort Supabase persistence (well + document) — client also persists with file name; server keeps well registry
    if (supabase) {
      try {
        if (report?.well_name) {
          await supabase.from('wells').upsert({
            well_name: report.well_name,
            latitude: report.latitude, longitude: report.longitude,
            current_md: report.current_md, current_tvd: report.current_tvd,
            formation: report.formation, operator: report.operator,
            rig_name: report.rig_name, lease_block: report.lease_block,
            progress: report.progress, avg_rop: report.avg_rop,
          }, { onConflict: 'well_name' })
        }
        const docName = String(req.body?.name || req.body?.fileName || '').slice(0, 120).trim()
        if (docName) {
          const vectorJson = documentVector ? documentVector : null
          await supabase.from('documents').upsert({
            name: docName,
            well_name: report?.well_name ?? null,
            report, corpus: text, embedding_model: embeddingModel,
            document_vector: null,
            document_vector_json: vectorJson,
            segments: locateSegments(sections, words),
            embeddings, pages: Math.max(1, Math.ceil(String(text).split('[PAGE').length - 1) || 1),
          }, { onConflict: 'name' })
        }
      } catch (e) { console.warn('[supabase] structure-ddr persist', e instanceof Error ? e.message : String(e)) }
    }
    res.json({ report, segments: locateSegments(sections, words), embeddings, embeddingModel, corpus: text, documentVector })
  } catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : 'Groq structuring failed.' }) }
})

app.post('/api/ask', async (req, res) => {
  if (!groq) return res.status(503).json({ error: 'GROQ_API_KEY is not configured.' })
  const question = String(req.body?.question || '').slice(0, 3000)
  const corpus = String(req.body?.corpus || '').slice(0, 50000)
  if (!question || !corpus) return res.status(400).json({ error: 'Question and indexed document context are required.' })
  const askMessages = [
    { role: 'system', content: 'You are NWIS drilling decision support. Answer only from uploaded-document evidence. If evidence is insufficient, say so. Include Evidence and Recommended check sections. Never invent wells, depths, events, or probabilities.' },
    { role: 'user', content: `UPLOADED DOCUMENT CONTEXT:\n${corpus}\n\nENGINEER QUESTION:\n${question}` },
  ]
  try {
    // FIRST TRY: Google (gemma-4-26b-a4b-it) – best for handwritten + vision
    try {
      const answer = await googleChat({ messages: askMessages, temperature: 0.1, max_tokens: 900 })
      console.log('[ask] Google succeeded')
      res.json({ answer })
      return
    } catch (googleErr) {
      console.warn('[ask] Google failed, falling back to Groq:', googleErr instanceof Error ? googleErr.message.slice(0, 300) : String(googleErr).slice(0, 300))
    }
    try {
      const response = await groq.chat.completions.create({ model, temperature: 0.1, max_completion_tokens: 1600, messages: askMessages })
      res.json({ answer: response.choices[0]?.message?.content || 'No answer returned.' })
      return
    } catch (groqErr) {
      const msg = groqErr instanceof Error ? groqErr.message : String(groqErr)
      if (msg.includes('429') || msg.includes('rate_limit') || msg.includes('Rate limit')) {
        console.warn('[ask] Groq rate limited, trying Osaurus fallback...')
        const answer = await osaurusChat({ messages: askMessages, temperature: 0.1, max_tokens: 800 })
        res.json({ answer })
        return
      }
      throw groqErr
    }
  } catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : 'Groq answer failed.' }) }
})

app.listen(process.env.PORT || 8787, '127.0.0.1', () => console.log('NWIS server ready at http://127.0.0.1:8787'))
