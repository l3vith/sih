import { strFromU8, strToU8, unzlibSync, zlibSync } from 'fflate'

export type FieldNote = { id: string; well: string; author: string; observedAt: string; depth: number | null; text: string; photos: { name: string; data: string }[]; received?: boolean; formation?: string; linkedWell?: string; updateCurrentDepth?: boolean }
export type FieldPackage = { version: 1; kind: 'notes'; id: string; notes: FieldNote[] }
export const QR_FRAME_CHARS = 400
const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}
const base64ToBytes = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0))
export function validatePackage(value: unknown): FieldPackage {
  const p = value as FieldPackage
  if (!p || p.version !== 1 || p.kind !== 'notes' || typeof p.id !== 'string' || !Array.isArray(p.notes) || !p.notes.length || p.notes.length > 100) throw new Error('This is not a supported NWIS update package.')
  const ids = new Set<string>()
  for (const n of p.notes) {
    if ((n?.formation !== undefined && (typeof n.formation !== 'string' || n.formation.length > 200)) || (n?.linkedWell !== undefined && (typeof n.linkedWell !== 'string' || n.linkedWell.length > 200)) || (n?.updateCurrentDepth !== undefined && typeof n.updateCurrentDepth !== 'boolean')) throw new Error('Invalid field note metadata.')
    if (!n || typeof n.id !== 'string' || !n.id || ids.has(n.id) || typeof n.well !== 'string' || !n.well.trim() || n.well.length > 200 || typeof n.author !== 'string' || n.author.length > 200 || typeof n.text !== 'string' || !n.text.trim() || n.text.length > 20000 || !Number.isFinite(Date.parse(n.observedAt)) || (n.depth !== null && (!Number.isFinite(n.depth) || n.depth < 0)) || !Array.isArray(n.photos) || n.photos.length > 6 || n.photos.some(x => typeof x.name !== 'string' || typeof x.data !== 'string' || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(x.data))) throw new Error('The package contains an invalid note. Nothing was imported.')
    ids.add(n.id)
  }
  return p
}
export async function checksum(text: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), b => b.toString(16).padStart(2, '0')).join('')
}
export async function framesFor(p: FieldPackage) {
  const bytes = strToU8(JSON.stringify({ ...p, notes: p.notes.map(n => ({ ...n, photos: [] })) }))
  const encoded = bytesToBase64(zlibSync(bytes, { level: 9 }))
  if (encoded.length <= QR_FRAME_CHARS) return [JSON.stringify({ n: 2, d: encoded })]
  const hash = await checksum(encoded)
  const chunkSize = 300
  const count = Math.ceil(encoded.length / chunkSize)
  if (count > 500) throw new Error('This batch is too large for QR. Export an update file instead.')
  return Array.from({ length: count }, (_, i) => JSON.stringify({ n: 2, t: p.id, h: hash, i, c: count, d: encoded.slice(i * chunkSize, (i + 1) * chunkSize) }))
}
export class FrameCollector {
  id = ''; hash = ''; count = 0; zip = 0; pieces = new Map<number, string>()
  async add(text: string): Promise<FieldPackage | null> {
    let f: Record<string, unknown>
    try { f = JSON.parse(text) } catch { throw new Error('Incomplete QR read.') }
    if (f.n === 2 && typeof f.d === 'string' && f.c === undefined) {
      if (f.d.length > QR_FRAME_CHARS) throw new Error('This is not an NWIS transfer QR.')
      return validatePackage(JSON.parse(strFromU8(unzlibSync(base64ToBytes(f.d)))))
    }
    const compact = f.n === 2
    const id = compact ? f.t : f.id
    const hash = compact ? f.h : f.hash
    const count = compact ? f.c : f.count
    const index = f.i
    const data = compact ? f.d : f.data
    const zip = compact || f.zip === 1 ? 1 : 0
    const maxFrameLength = compact ? 300 : zip ? QR_FRAME_CHARS : 650
    if ((!compact && f.nwis !== 1) || typeof id !== 'string' || typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash) || !Number.isInteger(count) || (count as number) < 1 || (count as number) > 500 || !Number.isInteger(index) || (index as number) < 0 || (index as number) >= (count as number) || typeof data !== 'string' || data.length > maxFrameLength) throw new Error('This is not an NWIS transfer QR.')
    if (this.id && (this.id !== id || this.hash !== hash || this.count !== count || this.zip !== zip)) throw new Error('A different transfer is in progress. Restart scanning to switch.')
    this.id = id; this.hash = hash; this.count = count as number; this.zip = zip; this.pieces.set(index as number, data)
    if (this.pieces.size !== this.count) return null
    const encoded = Array.from({ length: this.count }, (_, i) => this.pieces.get(i)).join('')
    if (await checksum(encoded) !== this.hash) throw new Error('Transfer checksum failed. Restart scanning.')
    const decoded = base64ToBytes(encoded)
    const p = validatePackage(JSON.parse(this.zip ? strFromU8(unzlibSync(decoded)) : strFromU8(decoded)))
    if (p.id !== this.id) throw new Error('Transfer identity does not match.')
    return p
  }
}
