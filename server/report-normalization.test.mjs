import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeExtractedReport } from './report-normalization.mjs'

test('activity codes are rejected while meaningful time-log incidents are named from evidence', () => {
  const report = normalizeExtractedReport({ events: [
    { time: '06:00–09:00', type: 'P', depth: null, evidence: 'MWD check; circulate.', severity: null },
    { time: '09:00–15:00', type: 'D', depth: 2040, evidence: 'Drill Giruj sand 2,010–2,040 m; no loss.', severity: null },
    { time: '15:00–19:00', type: 'D', depth: 2050, evidence: 'Cement channeling at 2,050 m; returns low.', severity: 'medium' },
    { time: '19:00–03:00', type: 'NPT', depth: null, evidence: 'Cement squeeze; 5 h NPT.', severity: null },
    { time: '03:00–06:00', type: 'P', depth: null, evidence: 'Condition.', severity: null },
  ] })
  assert.deepEqual(report.events.map(({ type }) => type), ['Cement channeling', 'Cement squeeze'])
  assert.equal(report.events[0].depth, 2050)
})

test('descriptive extracted events are preserved and duplicates are removed', () => {
  const report = normalizeExtractedReport({ events: [
    { time: '12:00', type: 'Kick', depth: '2100', evidence: 'Influx observed', severity: 'high' },
    { time: '12:00', type: 'Kick / influx', depth: 2100, evidence: 'Influx observed', severity: 'high' },
  ] })
  assert.equal(report.events.length, 1)
  assert.equal(report.events[0].type, 'Kick / influx')
  assert.equal(report.events[0].depth, 2100)
})
