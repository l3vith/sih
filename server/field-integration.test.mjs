import test from 'node:test'
import assert from 'node:assert/strict'
import { integrateFieldNotes, resolveFieldWell, resolveFieldFormation } from '../src/lib/field-integration.ts'
const doc = { name: 'A12.pdf', corpus: 'Original source', report: { well_name: 'A-12 / Barail South', report_date: '2026-09-01', current_md: 2902, formation: 'Barail', formations: [{ name: 'Upper Barail', top_md: 2700, bottom_md: 2800 }, { name: 'Lower Barail', top_md: 2800, bottom_md: 2950 }], events: [{ type: 'Source event', time: null, depth: 2700, evidence: 'Source', severity: null, mitigation: null }] } }
const note = { id: 'n1', well: 'A-12', author: 'Engineer', observedAt: '2026-09-06T12:00:00Z', depth: 2850, text: 'Coolant fluid leak', photos: [] }
test('well aliases resolve uniquely without prefix collisions or ambiguous matches', () => {
  assert.equal(resolveFieldWell(note, [doc.report.well_name, 'A-21 / North']), doc.report.well_name)
  assert.equal(resolveFieldWell({ ...note, well: 'A-1' }, [doc.report.well_name]), null)
  assert.equal(resolveFieldWell(note, [doc.report.well_name, 'A-12 / Other']), null)
  assert.equal(resolveFieldWell({ ...note, linkedWell: 'A-12 / Other' }, [doc.report.well_name, 'A-12 / Other']), 'A-12 / Other')
})
test('accepted notes become events and AI evidence only for their well, without mutating source', () => {
  const other = { ...doc, name: 'A21.pdf', report: { ...doc.report, well_name: 'A-21 / Tipam North' } }
  const result = integrateFieldNotes([doc, other], [note, note])
  assert.equal(result[0].report.events.length, 2)
  assert.equal(result[0].report.events[0].formation, 'Lower Barail')
  assert.equal(result[0].report.events[0].author, 'Engineer')
  assert.equal(result[0].report.current_md, 2902)
  assert.match(result[0].corpus, /Coolant fluid leak/)
  assert.equal(result[1], other)
  assert.equal(doc.report.events.length, 1)
  assert.equal(doc.corpus, 'Original source')
})
test('only an explicitly accepted newer depth changes data; late imports do not rewind depth', () => {
  const newer = { ...note, id: 'new', depth: 5000, observedAt: '2026-09-07T10:00:00Z', updateCurrentDepth: true }
  const older = { ...note, id: 'old', depth: 3000, updateCurrentDepth: true }
  const [result] = integrateFieldNotes([doc], [newer, older])
  assert.equal(result.report.current_md, 5000)
  assert.equal(result.report.source_current_md, 2902)
  assert.equal(result.report.field_depth_updated_at, newer.observedAt)
  assert.equal(integrateFieldNotes([doc], [{ ...older, observedAt: '2026-08-01T00:00:00Z' }])[0].report.current_md, 2902)
})
test('formation depth boundaries are precise and unsupported intervals stay unknown', () => {
  assert.equal(resolveFieldFormation({ ...note, depth: 2800 }, doc.report.formations), 'Lower Barail')
  assert.equal(resolveFieldFormation({ ...note, depth: 5000 }, doc.report.formations), null)
  assert.equal(resolveFieldFormation({ ...note, depth: null, formation: 'Engineer formation' }, []), 'Engineer formation')
})
