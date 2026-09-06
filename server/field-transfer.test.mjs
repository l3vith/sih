import test from 'node:test'
import assert from 'node:assert/strict'
import { FrameCollector, framesFor, QR_FRAME_CHARS, validatePackage } from '../src/lib/field-transfer.ts'
const note = { id: 'note-1', well: 'A-12', author: 'Engineer', observedAt: '2026-09-06T10:00:00Z', depth: 2800, text: 'हिंदी observation '.repeat(200), photos: [] }
const pack = { version: 1, kind: 'notes', id: 'transfer-1', notes: [note] }
test('QR reconstructs Unicode in reverse order and tolerates repeated frames', async () => {
  const frames = await framesFor(pack), collector = new FrameCollector()
  assert.ok(frames.length > 1)
  assert.ok(frames.every(frame => JSON.parse(frame).data.length <= QR_FRAME_CHARS))
  await collector.add(frames.at(-1)); await collector.add(frames.at(-1))
  let result
  for (const frame of frames.slice().reverse()) result = await collector.add(frame)
  assert.deepEqual(result, pack)
})
test('mixed transfers and corrupted frames are rejected', async () => {
  const frames = await framesFor(pack), other = await framesFor({ ...pack, id: 'other' })
  const c = new FrameCollector(); await c.add(frames[0]); await assert.rejects(c.add(other[0]))
  const broken = new FrameCollector()
  const first = JSON.parse(frames[0]); first.data = 'X' + first.data.slice(1)
  await broken.add(JSON.stringify(first))
  await assert.rejects(async () => { for (const f of frames.slice(1)) await broken.add(f) }, /checksum/)
})
test('duplicate IDs, invalid depths and unsupported attachments are rejected', () => {
  assert.throws(() => validatePackage({ ...pack, notes: [note, note] }))
  assert.throws(() => validatePackage({ ...pack, notes: [{ ...note, depth: -1 }] }))
  assert.throws(() => validatePackage({ ...pack, notes: [{ ...note, photos: [{ name: 'bad', data: 'javascript:alert(1)' }] }] }))
})
