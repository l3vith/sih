import type { FieldNote } from './field-transfer'

const normalize = (s: string) => s.trim().toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ')
const wellCode = (s: string) => normalize(s).split('/')[0].replace(/[^a-z0-9]/g, '')
export function resolveFieldWell(note: FieldNote, wells: string[]): string | null {
  const distinct = [...new Set(wells)]
  if (note.linkedWell) return distinct.find(w => normalize(w) === normalize(note.linkedWell!)) || null
  const exact = distinct.filter(w => normalize(w) === normalize(note.well))
  if (exact.length === 1) return exact[0]
  const code = distinct.filter(w => wellCode(w) === wellCode(note.well))
  return code.length === 1 ? code[0] : null
}
type Formation = { name: string; top_md: number | null; bottom_md: number | null }
export function resolveFieldFormation(note: FieldNote, formations: Formation[]): string | null {
  if (note.formation?.trim()) return note.formation.trim()
  if (note.depth === null) return null
  const matches = formations.filter(f => f.top_md !== null && f.bottom_md !== null && note.depth! >= f.top_md && note.depth! < f.bottom_md)
  return matches.length === 1 ? matches[0].name : null
}
type DataDocument = { name: string; corpus: string; report: { well_name: string | null; report_date: string | null; current_md: number | null; formation: string | null; formations: Formation[]; events: { time: string | null; type: string; depth: number | null; severity: 'high' | 'medium' | 'low' | null; mitigation: string | null; evidence: string; field_note_id?: string }[] } }
export function integrateFieldNotes<T extends DataDocument>(documents: T[], notes: FieldNote[]): T[] {
  const wells = documents.map(d => d.report.well_name || d.name)
  const unique = [...new Map(notes.map(n => [n.id, n])).values()]
  return documents.map(doc => {
    const matched = unique.filter(n => resolveFieldWell(n, wells) === (doc.report.well_name || doc.name)).sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt) || a.id.localeCompare(b.id))
    if (!matched.length) return doc
    const entries = matched.map(n => {
      const formation = resolveFieldFormation(n, doc.report.formations || [])
      return { field_note_id: n.id, source: 'field' as const, author: n.author, formation, time: n.observedAt, type: n.text.split('\n')[0].slice(0, 120), depth: n.depth, severity: null, mitigation: null, evidence: `Field observation · ${n.author} · ${n.observedAt}${formation ? ` · ${formation}` : ''}\n${n.text}` }
    })
    const newest = matched.find(n => n.updateCurrentDepth && n.depth !== null && Date.parse(n.observedAt) >= (Date.parse(doc.report.report_date || '') || 0))
    return { ...doc, corpus: doc.corpus + '\n\nACCEPTED ENGINEER FIELD OBSERVATIONS:\n' + entries.map(e => `${e.evidence}\nObserved MD: ${e.depth ?? 'not stated'} m`).join('\n\n'), report: { ...doc.report,
      current_md: newest?.depth ?? doc.report.current_md,
      formation: newest ? resolveFieldFormation(newest, doc.report.formations || []) || doc.report.formation : doc.report.formation,
      field_observations: matched,
      field_depth_updated_at: newest?.observedAt,
      source_current_md: doc.report.current_md,
      events: [...entries, ...doc.report.events.filter(e => !e.field_note_id || !matched.some(n => n.id === e.field_note_id))],
    } }
  })
}
