import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Pause, Play, ScanLine } from 'lucide-react'

type Formation = { name: string; top_md: number | null; bottom_md: number | null }
type Event = { time: string | null; type: string; depth: number | null; severity: 'high' | 'medium' | 'low' | null; mitigation: string | null; evidence: string }
type Report = { well_name: string | null; current_md: number | null; current_tvd: number | null; formation: string | null; mud_weight: string | null; formations: Formation[]; events: Event[] }

const palette = ['aquifer', 'slate', 'coral', 'ochre', 'sand', 'clay']
const formatDepth = (depth: number) => depth.toLocaleString()

export default function WellDive({ report, compact = false, onExpand }: { report: Report; compact?: boolean; onExpand?: () => void }) {
  const formations = useMemo(() => report.formations?.length ? report.formations : [{ name: report.formation || 'Formation not identified', top_md: 0, bottom_md: report.current_md || 2500 }], [report.formations, report.formation, report.current_md])
  const maxDepth = Math.max(100, report.current_md || Math.max(...formations.map(item => item.bottom_md || 0), 2500))
  const [visibleDepth, setVisibleDepth] = useState(Math.round(maxDepth * .86))
  const [auto, setAuto] = useState(false)
  const progress = Math.min(1, Math.max(0, visibleDepth / maxDepth))
  const events = useMemo(() => report.events.filter(event => typeof event.depth === 'number').slice(0, 5), [report.events])

  useEffect(() => setVisibleDepth(value => Math.min(maxDepth, value)), [maxDepth])
  useEffect(() => {
    if (!auto) return
    let frame = 0
    let previous = performance.now()
    const tick = (now: number) => {
      const elapsed = (now - previous) / 1000
      previous = now
      setVisibleDepth(value => {
        const next = value + Math.max(80, maxDepth / 14) * elapsed
        if (next >= maxDepth) { setAuto(false); return maxDepth }
        return Math.round(next)
      })
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [auto, maxDepth])

  const bands = useMemo(() => formations.map((formation, index) => {
    const top = formation.top_md ?? index / formations.length * maxDepth
    const bottom = formation.bottom_md ?? (index + 1) / formations.length * maxDepth
    return { ...formation, top, bottom, height: Math.max(10, (bottom - top) / maxDepth * 100) }
  }), [formations, maxDepth])
  const activeFormation = bands.find(band => visibleDepth >= band.top && visibleDepth <= band.bottom) || bands[bands.length - 1]
  const nearestEvent = events.reduce<Event | null>((nearest, event) => !nearest || Math.abs((event.depth || 0) - visibleDepth) < Math.abs((nearest.depth || 0) - visibleDepth) ? event : nearest, null)
  const markerTop = Math.min(92, Math.max(7, progress * 100))

  return <section className={`well-dive ${compact ? 'compact' : ''}`} aria-label={`Interactive well section to ${formatDepth(maxDepth)} metres`}>
    <div className="well-dive-toolbar">
      <div className="well-dive-status"><i /> LIVE DEPTH MODEL</div>
      <div className="well-dive-toolbar-actions">
        {compact && onExpand && <button onClick={onExpand}>Open full dive</button>}
        <button className={auto ? 'playing' : ''} onClick={() => setAuto(value => !value)} aria-label={auto ? 'Pause automatic dive' : 'Start automatic dive'}>{auto ? <Pause size={13} /> : <Play size={13} />} {auto ? 'Pause' : 'Auto dive'}</button>
      </div>
    </div>

    <div className="well-dive-scene">
      <div className="well-dive-sky" aria-hidden="true" />
      <div className="well-dive-strata" style={{ transform: `translateY(${-progress * 8}px)` }}>
        {bands.map((band, index) => <div className={`well-dive-band tone-${palette[index % palette.length]}`} style={{ height: `${band.height}%` }} key={`${band.name}-${index}`}>
          <div className="strata-fold strata-fold-a" /><div className="strata-fold strata-fold-b" />
          <span><b>{band.name}</b><small>{formatDepth(band.top)} – {formatDepth(band.bottom)} m</small></span>
        </div>)}
      </div>

      <div className="well-dive-casing" aria-hidden="true">
        <span className="casing-wall casing-left" /><span className="casing-wall casing-right" />
        <span className="casing-rib casing-rib-left" /><span className="casing-rib casing-rib-right" />
        <span className="drill-string" /><span className="drill-collar" style={{ top: `${Math.max(48, markerTop - 14)}%` }} />
        <span className="drill-bit" style={{ top: `${markerTop}%` }}><i /><i /><i /></span>
      </div>

      <div className="well-depth-line" style={{ top: `${markerTop}%` }} aria-hidden="true" />
      <output className="well-depth-badge" style={{ top: `${markerTop}%` }}>{formatDepth(visibleDepth)} m</output>
      <div className="well-depth-pulse" style={{ top: `${markerTop}%` }} aria-hidden="true"><i /></div>

      <article className="formation-inspector">
        <span>ACTIVE INTERVAL</span><strong>{activeFormation?.name || report.formation || 'Formation not identified'}</strong>
        <p>{formatDepth(activeFormation?.top || 0)}–{formatDepth(activeFormation?.bottom || maxDepth)} m. Move the depth control to inspect formation and event evidence.</p><ScanLine size={17} />
      </article>

      {nearestEvent?.depth !== null && nearestEvent && <article className="dive-event-callout" style={{ top: `${Math.min(84, Math.max(18, (nearestEvent.depth! / maxDepth) * 100))}%` }}>
        <span>{nearestEvent.severity || 'EVENT'}</span><b>{nearestEvent.type}</b><small>{formatDepth(nearestEvent.depth!)} m</small>
      </article>}

      <div className="well-depth-scale" aria-hidden="true">{[.25, .5, .75, 1].map(value => <span key={value} style={{ top: `${value * 100}%` }}>{formatDepth(Math.round(maxDepth * value))} m</span>)}</div>
    </div>

    <div className="well-dive-controls">
      <div className="well-dive-slider-label"><span>SHALLOW</span><strong>{formatDepth(visibleDepth)} m</strong><span>DEEP</span></div>
      <input type="range" min={0} max={maxDepth} step={10} value={visibleDepth} onChange={event => { setAuto(false); setVisibleDepth(Number(event.target.value)) }} aria-label="Inspect well depth" />
      <div className="well-dive-control-meta"><span>{activeFormation?.name}</span><small>{events.length} depth-tagged event{events.length === 1 ? '' : 's'} · MD from uploaded report</small></div>
    </div>

    {!compact && <div className="well-dive-mobile-events">{events.map((event, index) => <button key={`${event.type}-${index}`} onClick={() => event.depth !== null && setVisibleDepth(event.depth)}><span>{event.type}</span><small>{event.depth?.toLocaleString()} m</small><ChevronDown size={14} /></button>)}</div>}
  </section>
}
