import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import QrScanner from 'qr-scanner'
import { get, set, update } from 'idb-keyval'
import { FrameCollector, framesFor, validatePackage, type FieldNote, type FieldPackage } from '../lib/field-transfer'
import './FieldCompanion.css'
import { FileText, Smartphone, ScanLine, Upload, ArrowUpRight, CheckCircle2 } from 'lucide-react'
import { resolveFieldWell, resolveFieldFormation } from '../lib/field-integration'

const NOTES = 'nwis-field-notes-v1', IMPORTS = 'nwis-field-imports-v1'
function download(data: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }))
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function Scanner({ onRead, onClose, preferredCamera }: { onRead: (text: string) => Promise<void>; onClose: () => void; preferredCamera: 'user' | 'environment' }) {
  const video = useRef<HTMLVideoElement>(null), callback = useRef(onRead)
  callback.current = onRead
  const [error, setError] = useState('')
  useEffect(() => {
    let busy = false
    const scanner = new QrScanner(video.current!, async result => {
      if (busy) return; busy = true
      try { await callback.current(result.data); setError('') } catch (e) { setError(String((e as Error).message)) } finally { busy = false }
    }, { returnDetailedScanResult: true, preferredCamera, highlightScanRegion: true, highlightCodeOutline: true, maxScansPerSecond: 12 })
    const secure = window.isSecureContext || ['localhost', '127.0.0.1'].includes(window.location.hostname)
    if (!secure) { setError('Camera scanning requires HTTPS. Open the deployed NWIS site, or use Import update file.'); return () => scanner.destroy() }
    scanner.start().catch(() => setError('Camera unavailable. Allow camera access in browser settings, then retry.'))
    return () => scanner.destroy()
  }, [preferredCamera])
  return <div className="field-scan"><video ref={video} playsInline muted /><p>{error || 'Hold the QR 20–35 cm from the camera and fill most of the scan box. Keep it steady and avoid glare.'}</p><button onClick={onClose}>Stop camera</button></div>
}
function TransferQr({ frames }: { frames: string[] }) {
  const [index, setIndex] = useState(0), [paused, setPaused] = useState(false), [src, setSrc] = useState('')
  useEffect(() => { setIndex(0) }, [frames])
  useEffect(() => { if (paused || frames.length < 2) return; const timer = setInterval(() => setIndex(i => (i + 1) % frames.length), 3000); return () => clearInterval(timer) }, [frames, paused])
  useEffect(() => { let live = true; QRCode.toDataURL(frames[index] || frames[0], { width: 640, margin: 6, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } }).then(s => { if (live) setSrc(s) }); return () => { live = false } }, [frames, index])
  return <div className="field-qr">{src && <img src={src} alt="NWIS offline transfer QR code" />}<p>{frames.length === 1 ? 'One code · Hold it steady until the laptop confirms receipt.' : `Frame ${index + 1} of ${frames.length} · Keep this screen visible until every frame is received.`}</p>{frames.length > 1 && <div className="field-actions"><button onClick={() => setPaused(p => !p)}>{paused ? 'Play' : 'Pause'}</button><button onClick={() => { setPaused(true); setIndex(i => (i + 1) % frames.length) }}>Next frame</button></div>}</div>
}
type WellReport = { well: string; depth: number | null; formations: { name: string; top_md: number | null; bottom_md: number | null }[] }
export default function FieldCompanion({ receiver = false, wells = [], reports = [], onApplied }: { receiver?: boolean; wells?: string[]; reports?: WellReport[]; onApplied?: (notes: FieldNote[]) => void }) {
  const [notes, setNotes] = useState<FieldNote[]>([]), [pending, setPending] = useState<FieldPackage | null>(null), [frames, setFrames] = useState<string[]>([])
  const [scanning, setScanning] = useState(false), [progress, setProgress] = useState(''), [message, setMessage] = useState(''), [ready, setReady] = useState(false), [busy, setBusy] = useState(false)
  const [well, setWell] = useState(''), [author, setAuthor] = useState(''), [depth, setDepth] = useState(''), [text, setText] = useState(''), [observed, setObserved] = useState(''), [photos, setPhotos] = useState<FieldNote['photos']>([])
  const collector = useRef(new FrameCollector()), transfer = useRef<FieldPackage | null>(null)
  const [formation, setFormation] = useState('')
  function receive(p: FieldPackage) { setPending({ ...p, notes: p.notes.map(n => ({ ...n, linkedWell: undefined, updateCurrentDepth: false })) }); setFrames([]) }
  function editReview(id: string, change: Partial<FieldNote>) { setPending(p => p ? { ...p, notes: p.notes.map(n => n.id === id ? { ...n, ...change } : n) } : p) }
  const key = receiver ? IMPORTS : NOTES
  useEffect(() => { get<FieldNote[]>(key).then(n => { setNotes(n || []); setReady(true) }).catch(() => setMessage('Local storage is unavailable. Notes cannot be saved in this browser.')) }, [key])
  useEffect(() => { if (!receiver) navigator.storage?.persist?.().catch(() => {}) }, [receiver])
  async function run(fn: () => Promise<void>) { setBusy(true); setMessage(''); try { await fn() } catch (e) { setMessage((e as Error).message) } finally { setBusy(false) } }
  async function saveNote() {
    const note: FieldNote = { id: crypto.randomUUID(), well: well.trim(), author: author.trim(), depth: depth === '' ? null : Number(depth), text: text.trim(), observedAt: new Date(observed || Date.now()).toISOString(), photos, formation: formation.trim() || undefined }
    validatePackage({ version: 1, kind: 'notes', id: crypto.randomUUID(), notes: [note] })
    await update<FieldNote[]>(NOTES, old => [...(old || []), note]); setNotes(await get<FieldNote[]>(NOTES) || []); setText(''); setPhotos([]); setMessage('Saved on this phone.'); setFrames([])
  }
  async function exportNotes(qr: boolean) {
    const unsent = qr ? notes.filter(n => !n.received) : notes
    if (!unsent.length) throw new Error('No unconfirmed notes to transfer.')
    const p: FieldPackage = { version: 1, kind: 'notes', id: crypto.randomUUID(), notes: unsent }
    transfer.current = p
    await set('nwis-field-pending-transfer', p)
    if (qr) { setFrames(await framesFor(p)); setMessage('QR sends text only. Export the update file to include photos.') }
    else download(p, `nwis-updates-${p.id}.json`)
  }
  async function readQr(value: string) {
    if (!receiver) {
      let receipt: { kind?: string; version?: number; id?: string }
      try { receipt = JSON.parse(value) } catch { return }
      const sent = transfer.current || await get<FieldPackage>('nwis-field-pending-transfer')
      if (!sent || receipt.kind !== 'receipt' || receipt.version !== 1 || receipt.id !== sent.id) throw new Error('This confirmation does not match your last transfer.')
      const ids = new Set(sent.notes.map(n => n.id))
      await update<FieldNote[]>(NOTES, old => (old || []).map(n => ids.has(n.id) ? { ...n, received: true } : n))
      setNotes(await get<FieldNote[]>(NOTES) || []); setScanning(false); setFrames([]); setMessage('Laptop confirmed receipt. Your phone copies are retained.'); return
    }
    const result = await collector.current.add(value)
    setProgress(`${collector.current.pieces.size} / ${collector.current.count} frames received`)
    if (result) { receive(result); setScanning(false) }
  }
  async function accept() {
    if (!pending) return
    const resolved = pending.notes.map(note => {
      const linkedWell = resolveFieldWell(note, wells)
      if (!linkedWell) throw new Error(`Choose a matching well for ${note.well} before accepting. Upload its report first if it is not listed.`)
      const report = reports.find(r => r.well === linkedWell)
      return { ...note, linkedWell, formation: resolveFieldFormation(note, report?.formations || []) || undefined }
    })
    let added: FieldNote[] = []
    await update<FieldNote[]>(IMPORTS, old => {
      const result = [...(old || [])]
      for (const note of resolved) {
        const existing = result.find(n => n.id === note.id)
        if (existing) {
          if (existing.text !== note.text || existing.well !== note.well || existing.depth !== note.depth || existing.author !== note.author || existing.observedAt !== note.observedAt) throw new Error('A note ID conflicts with an existing record. Nothing was imported.')
          if (note.photos.length && !existing.photos.length) existing.photos = note.photos
          existing.linkedWell = note.linkedWell; existing.formation = note.formation
          existing.updateCurrentDepth = existing.updateCurrentDepth || note.updateCurrentDepth
        } else { const incoming = { ...note, received: true }; result.push(incoming); added.push(incoming) }
      }
      return result
    })
    const saved = await get<FieldNote[]>(IMPORTS) || []
    setNotes(saved); onApplied?.(saved)
    const receipt = JSON.stringify({ version: 1, kind: 'receipt', id: pending.id })
    setFrames([receipt]); setPending(null); setMessage(`${added.length} new observations integrated into the matching well event logs. Scan this receipt on the phone to confirm transfer.`)
  }
  return <section className={`field-companion ${receiver ? 'field-receiver' : 'field-phone'}`}>
    <header className="field-heading"><div className="field-heading-title">{receiver ? <FileText size={18} /> : <span className="field-brand">N°</span>}<div>{receiver ? <h2>Field updates</h2> : <h1>NWIS Companion</h1>}<p>{receiver ? 'Receive, review, and link observations to your wells.' : 'Nearby Wells Intelligence · Field notebook'}</p></div></div>{receiver && <a href="https://nwis-field-companion.vercel.app/companion.html" target="_blank" rel="noreferrer"><Smartphone size={14} /> Phone companion <ArrowUpRight size={14} /></a>}</header>
    {!receiver && <p className="field-help">Open this page once over HTTPS and add it to your home screen. Wait for “Ready offline” before disconnecting. Notes stay in this browser; export a backup before clearing browser data.</p>}
    {!receiver && <OfflineStatus />}
    <div className="field-actions">{receiver ? <><button disabled={!ready || busy} onClick={() => { collector.current = new FrameCollector(); setProgress(''); setScanning(true); setFrames([]) }}><ScanLine size={15} /> Scan phone QR</button><label className="field-file"><Upload size={15} /> Import update file<input type="file" accept=".json,application/json" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void run(async () => { if (file.size > 45_000_000) throw new Error('File is too large (45 MB limit).'); receive(validatePackage(JSON.parse(await file.text()))) }) }} /></label></> : <><button disabled={!ready || busy} onClick={() => void run(() => exportNotes(true))}>Show transfer QR</button><button disabled={!ready || busy} onClick={() => void run(() => exportNotes(false))}>Export with photos</button><button onClick={() => setScanning(true)}>Scan confirmation</button></>}</div>
    {message && <p className="field-message" role="status">{message}</p>}{scanning && <><Scanner preferredCamera={receiver ? 'user' : 'environment'} onRead={readQr} onClose={() => setScanning(false)} /><p role="status">{progress}</p></>}{frames.length > 0 && <TransferQr frames={frames} />}
    {pending && <section className="field-review"><div className="field-section-heading"><h2>Review incoming observations</h2><span>{pending.notes.length} to review</span></div><p className="field-help">Confirm the well and formation. Accepted observations appear in the event stream, Well Dive, search, and Ask NWIS.</p>{pending.notes.map(n => { const target = resolveFieldWell(n, wells); const report = reports.find(r => r.well === target); const inferred = resolveFieldFormation(n, report?.formations || []); return <div className="field-review-item" key={n.id}><Note note={n} duplicate={notes.some(x => x.id === n.id)} /><div className="field-form-row"><label>Link to well<select value={target || ''} onChange={e => editReview(n.id, { linkedWell: e.target.value, formation: undefined, updateCurrentDepth: false })}><option value="">Choose a well…</option>{[...new Set(wells)].map(w => <option key={w}>{w}</option>)}</select></label><label>Formation<input value={n.formation || ''} placeholder={inferred || 'Not identified at this depth'} list={`formation-${n.id}`} maxLength={200} onChange={e => editReview(n.id, { formation: e.target.value })} /><datalist id={`formation-${n.id}`}>{report?.formations.map((f, i) => <option key={i}>{f.name}</option>)}</datalist><small>{inferred ? `Linked to ${inferred}` : 'Leave blank if the formation is unknown.'}</small></label></div>{n.depth !== null && <label className="field-depth-check"><input type="checkbox" checked={!!n.updateCurrentDepth} onChange={e => editReview(n.id, { updateCurrentDepth: e.target.checked })} /><span>Update current measured depth: {report?.depth?.toLocaleString() ?? 'Not stated'} → {n.depth.toLocaleString()} m<small>Use only if this is the current drilling depth. Older observations never replace a newer reading.</small></span></label>}{!target && <p role="status" className="field-unmatched">Select a well before accepting this observation.</p>}</div> })}<div className="field-actions"><button disabled={busy || pending.notes.some(n => !resolveFieldWell(n, wells))} onClick={() => void run(accept)}><CheckCircle2 size={15} /> Accept and update well logs</button><button className="field-secondary" onClick={() => setPending(null)}>Cancel import</button></div></section>}
    {!receiver && <form onSubmit={e => { e.preventDefault(); void run(saveNote) }}><h2>New observation</h2><div className="field-form-row"><label>Well<input required maxLength={200} list="field-wells" value={well} onChange={e => setWell(e.target.value)} placeholder="A-12 / Barail South" /><datalist id="field-wells">{wells.map(w => <option key={w}>{w}</option>)}</datalist></label><label>Engineer<input required maxLength={200} value={author} onChange={e => setAuthor(e.target.value)} autoComplete="name" /></label></div><div className="field-form-row"><label>Observed at<input type="datetime-local" value={observed} onChange={e => setObserved(e.target.value)} /><small>Leave blank to use the save time.</small></label><label>Measured depth (m)<input type="number" min="0" step="any" value={depth} onChange={e => setDepth(e.target.value)} /></label></div><label>Formation (if known)<input maxLength={200} value={formation} onChange={e => setFormation(e.target.value)} placeholder="e.g. Upper Barail" /></label><label>Operation / observation<textarea required maxLength={20000} rows={5} value={text} onChange={e => setText(e.target.value)} placeholder="What happened? Include the action taken and anything the next shift should know." /></label><label>Photos (up to 6, 5 MB each)<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={e => { const files = Array.from(e.target.files || []); void run(async () => { if (files.length > 6 || files.some(f => f.size > 5_000_000)) throw new Error('Choose up to 6 photos, each smaller than 5 MB.'); setPhotos(await Promise.all(files.map(f => new Promise<{ name: string; data: string }>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve({ name: f.name, data: String(reader.result) }); reader.onerror = reject; reader.readAsDataURL(f) })))); }) }} /><small>{photos.length} photos attached · Photos transfer by file.</small></label><button disabled={!ready || busy} type="submit">{busy ? 'Saving…' : 'Save on phone'}</button></form>}
    <section className="field-history"><h2>{receiver ? 'Integrated field observations' : 'Saved notes'} <span>({notes.length})</span></h2>{!notes.length && <p className="field-empty">{receiver ? 'No field observations yet. Scan a phone or import an update file to link the next shift’s notes.' : 'Your saved observations will appear here.'}</p>}{[...notes].reverse().map(n => <Note key={n.id} note={n} />)}</section>
  </section>
}
function Note({ note, duplicate }: { note: FieldNote; duplicate?: boolean }) { return <article className="field-note"><header><strong>{note.linkedWell || note.well}</strong><span>{duplicate ? 'Already imported' : note.received ? 'Integrated into well logs' : 'Saved on phone'}</span></header><p className="field-meta">{note.author} · {new Date(note.observedAt).toLocaleString()}{note.depth !== null ? ` · ${note.depth.toLocaleString()} m MD` : ''}{note.formation ? ' · ' + note.formation : ''}</p><p>{note.text}</p>{note.photos.map((p, i) => <a key={i} href={p.data} download={p.name}><img src={p.data} alt={p.name} /></a>)}</article> }
function OfflineStatus() {
  const [ready, setReady] = useState(false)
  useEffect(() => { if (!('serviceWorker' in navigator)) return; navigator.serviceWorker.ready.then(() => setReady(true)) }, [])
  return <p role="status" className="field-meta">{ready ? 'Ready offline on this device' : 'Offline setup pending — use the installed production build over HTTPS.'}</p>
}
