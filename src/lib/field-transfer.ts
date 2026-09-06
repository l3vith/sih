export type FieldNote = { id: string; well: string; author: string; observedAt: string; depth: number | null; text: string; photos: { name: string; data: string }[]; received?: boolean; formation?: string; linkedWell?: string; updateCurrentDepth?: boolean }
export type FieldPackage = { version: 1; kind: 'notes'; id: string; notes: FieldNote[] }
export const QR_FRAME_CHARS = 180
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
  const bytes = new TextEncoder().encode(JSON.stringify({ ...p, notes: p.notes.map(n => ({ ...n, photos: [] })) }))
  const encoded = btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''))
  const hash = await checksum(encoded)
  const count = Math.ceil(encoded.length / QR_FRAME_CHARS)
  if (count > 500) throw new Error('This batch is too large for QR. Export an update file instead.')
  return Array.from({ length: count }, (_, i) => JSON.stringify({ nwis: 1, id: p.id, hash, i, count, data: encoded.slice(i * QR_FRAME_CHARS, (i + 1) * QR_FRAME_CHARS) }))
}
export class FrameCollector {
  id = ''; hash = ''; count = 0; pieces = new Map<number, string>()
  async add(text: string): Promise<FieldPackage | null> {
    let f: Record<string, unknown>
    try { f = JSON.parse(text) } catch { throw new Error('The camera saw a partial QR. Keep it steady and centered.') }
    if (f.nwis !== 1 || typeof f.id !== 'string' || typeof f.hash !== 'string' || !/^[a-f0-9]{64}$/.test(f.hash) || !Number.isInteger(f.count) || (f.count as number) < 1 || (f.count as number) > 500 || !Number.isInteger(f.i) || (f.i as number) < 0 || (f.i as number) >= (f.count as number) || typeof f.data !== 'string' || f.data.length > QR_FRAME_CHARS) throw new Error('This is not an NWIS transfer QR.')
    if (this.id && (this.id !== f.id || this.hash !== f.hash || this.count !== f.count)) throw new Error('A different transfer is in progress. Restart scanning to switch.')
    this.id = f.id; this.hash = f.hash; this.count = f.count as number; this.pieces.set(f.i as number, f.data)
    if (this.pieces.size !== this.count) return null
    const encoded = Array.from({ length: this.count }, (_, i) => this.pieces.get(i)).join('')
    if (await checksum(encoded) !== this.hash) throw new Error('Transfer checksum failed. Restart scanning.')
    const p = validatePackage(JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encoded), c => c.charCodeAt(0)))))
    if (p.id !== this.id) throw new Error('Transfer identity does not match.')
    return p
  }
}
