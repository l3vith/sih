import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Vite exposes VITE_ vars to client; also accept SUPABASE_ for users who set without prefix
const env = (import.meta as unknown as { env: Record<string, string> }).env ?? {}
const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL || ''
const anonKey = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || ''

export const isSupabaseConfigured = Boolean(url && anonKey)
export const supabase: SupabaseClient | null = isSupabaseConfigured ? createClient(url, anonKey) : null

// Types matching supabase/schema.sql
export type DbDocument = {
  id: string
  name: string
  well_name: string | null
  report: unknown
  corpus: string | null
  embedding_model: string | null
  document_vector: number[] | null
  segments: unknown
  embeddings: unknown
  pages: number | null
  created_at: string
}

// ---- Documents ----
export async function saveDocumentToSupabase(doc: { name: string; report: unknown; corpus: string; embeddingModel: string; documentVector: number[] | null; segments: unknown; embeddings: unknown; pages: number }) {
  if (!supabase) return { error: 'Supabase not configured' as const }
  const payload = {
    name: doc.name,
    well_name: (doc.report as { well_name?: string | null })?.well_name ?? null,
    report: doc.report,
    corpus: doc.corpus,
    embedding_model: doc.embeddingModel,
    document_vector: doc.documentVector,
    segments: doc.segments,
    embeddings: doc.embeddings,
    pages: doc.pages,
  }
  const { error } = await supabase.from('documents').upsert(payload as never, { onConflict: 'name' })
  return { error: error?.message ?? null }
}

export async function loadDocumentsFromSupabase(): Promise<{ data: DbDocument[] | null; error: string | null }> {
  if (!supabase) return { data: null, error: 'Supabase not configured' }
  const { data, error } = await supabase.from('documents').select('*').order('created_at', { ascending: false }).limit(50)
  if (error) return { data: null, error: error.message }
  return { data: data as unknown as DbDocument[], error: null }
}

export async function deleteDocumentFromSupabase(name: string) {
  if (!supabase) return { error: 'Supabase not configured' as const }
  const { error } = await supabase.from('documents').delete().eq('name', name)
  return { error: error?.message ?? null }
}

// ---- Wells (derived from documents) ----
export async function upsertWellFromReport(report: { well_name: string | null; latitude: number | null; longitude: number | null; current_md: number | null; current_tvd: number | null; formation: string | null; operator: string | null; rig_name: string | null; lease_block: string | null }) {
  if (!supabase || !report.well_name) return
  const { error } = await supabase.from('wells').upsert({
    well_name: report.well_name,
    latitude: report.latitude,
    longitude: report.longitude,
    current_md: report.current_md,
    current_tvd: report.current_tvd,
    formation: report.formation,
    operator: report.operator,
    rig_name: report.rig_name,
    lease_block: report.lease_block,
  } as never, { onConflict: 'well_name' })
  if (error) console.warn('[supabase] upsert well failed', error.message)
}

// ---- Telemetry ----
export async function saveTelemetryBatch(wellName: string | null, samples: Array<{ time: string; depth: number; wob: number | null; rop: number | null; rpm: number | null; torque: number | null; spp: number | null; flow_in: number | null; flow_out: number | null; mud_weight: number | null; gas: number | null; hook_load: number | null; quality: string }>) {
  if (!supabase || !wellName) return
  const { data: well } = await supabase.from('wells').select('id').eq('well_name', wellName).single() as { data: { id: string } | null }
  const wellId = well?.id
  if (!wellId) return
  const rows = samples.slice(-30).map(s => ({
    well_id: wellId,
    time: s.time,
    depth: s.depth,
    wob: s.wob, rop: s.rop, rpm: s.rpm, torque: s.torque, spp: s.spp,
    flow_in: s.flow_in, flow_out: s.flow_out, mud_weight: s.mud_weight, gas: s.gas, hook_load: s.hook_load, quality: s.quality,
  }))
  const { error } = await supabase.from('telemetry_samples').insert(rows as never)
  if (error) console.warn('[supabase] telemetry insert failed', error.message)
}

// ---- Alerts ----
export async function saveAlert(wellName: string | null, alert: { time: string; depth: number | null; kind: string; severity: string; message: string; evidence: string }) {
  if (!supabase || !wellName) return
  const { data: well } = await supabase.from('wells').select('id').eq('well_name', wellName).single() as { data: { id: string } | null }
  const wellId = well?.id
  if (!wellId) return
  const { error } = await supabase.from('alerts').insert({
    well_id: wellId,
    time: alert.time, depth: alert.depth, kind: alert.kind, severity: alert.severity,
    message: alert.message, evidence: alert.evidence, acknowledged: false, suppressed: false,
  } as never)
  if (error) console.warn('[supabase] alert insert failed', error.message)
}

export async function fetchAlertsForWell(wellName: string | null) {
  if (!supabase || !wellName) return []
  const { data: well } = await supabase.from('wells').select('id').eq('well_name', wellName).single() as { data: { id: string } | null }
  if (!well?.id) return []
  const { data } = await supabase.from('alerts').select('*').eq('well_id', well.id).order('created_at', { ascending: false }).limit(30) as { data: unknown[] | null }
  return (data ?? []) as never[]
}
