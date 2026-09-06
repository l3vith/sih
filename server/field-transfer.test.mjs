import test from 'node:test'
import assert from 'node:assert/strict'
import { FrameCollector, framesFor, QR_FRAME_CHARS, validatePackage } from '../src/lib/field-transfer.ts'
const note = { id: 'note-1', well: 'A-12', author: 'Engineer', observedAt: '2026-09-06T10:00:00Z', depth: 2800, text: 'हिंदी observation '.repeat(200), photos: [] }
const pack = { version: 1, kind: 'notes', id: 'transfer-1', notes: [note] }
const noisyText = Array.from({ length: 1600 }, (_, i) => ((i * 2654435761) >>> 0).toString(36)).join(' ')
const multiPack = { ...pack, notes: [{ ...note, text: noisyText }] }
test('QR reconstructs Unicode in reverse order and tolerates repeated frames', async () => {
  const frames = await framesFor(multiPack), collector = new FrameCollector()
  assert.ok(frames.length > 1)
  assert.ok(frames.every(frame => (JSON.parse(frame).d || JSON.parse(frame).data).length <= QR_FRAME_CHARS))
  await collector.add(frames.at(-1)); await collector.add(frames.at(-1))
  let result
  for (const frame of frames.slice().reverse()) result = await collector.add(frame)
  assert.deepEqual(result, multiPack)
})
test('a normal field observation fits in one stationary QR code', async () => {
  const ordinary = { ...pack, notes: [{ ...note, text: 'Partial returns observed. Pumped LCM and reduced flow while monitoring pit volume.' }] }
  assert.equal((await framesFor(ordinary)).length, 1)
})
test('mixed transfers and corrupted frames are rejected', async () => {
  const frames = await framesFor(multiPack), other = await framesFor({ ...multiPack, id: 'other' })
  const c = new FrameCollector(); await c.add(frames[0]); await assert.rejects(c.add(other[0]))
  const broken = new FrameCollector()
  const first = JSON.parse(frames[0]); first.d = 'X' + first.d.slice(1)
  await broken.add(JSON.stringify(first))
  await assert.rejects(async () => { for (const f of frames.slice(1)) await broken.add(f) }, /checksum/)
})
test('duplicate IDs, invalid depths and unsupported attachments are rejected', () => {
  assert.throws(() => validatePackage({ ...pack, notes: [note, note] }))
  assert.throws(() => validatePackage({ ...pack, notes: [{ ...note, depth: -1 }] }))
  assert.throws(() => validatePackage({ ...pack, notes: [{ ...note, photos: [{ name: 'bad', data: 'javascript:alert(1)' }] }] }))
})
