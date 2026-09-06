import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Pause, Play, ScanLine } from 'lucide-react'
import { useLang } from '../lang'

type Formation = { name: string; top_md: number | null; bottom_md: number | null }
type Event = { time: string | null; type: string; depth: number | null; severity: 'high' | 'medium' | 'low' | null; mitigation: string | null; evidence: string }
type Report = { well_name: string | null; current_md: number | null; current_tvd: number | null; formation: string | null; mud_weight: string | null; formations: Formation[]; events: Event[] }

const palette = ['aquifer', 'slate', 'coral', 'ochre', 'sand', 'clay']
const formatDepth = (depth: number) => depth.toLocaleString()

export default function WellDive({ report, compact = false, onExpand }: { report: Report; compact?: boolean; onExpand?: () => void }) {
  const { t } = useLang()
  const formations = useMemo(() => report.formations?.length ? report.formations : [{ name: report.formation || t('wdFormationNA'), top_md: 0, bottom_md: report.current_md || 2500 }], [report.formations, report.formation, report.current_md, t])
  const maxDepth = Math.max(100, report.current_md || 0, ...formations.map(item => item.bottom_md || 0), ...report.events.map(event => event.depth || 0))
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

  return <section className={`well-dive ${compact ? 'compact' : ''}`} aria-label={t('wdDiveAria', { depth: formatDepth(maxDepth) })}>
    <div className="well-dive-toolbar">
      <div className="well-dive-status"><i /> {t('wdLive')}</div>
      <div className="well-dive-toolbar-actions">
        {compact && onExpand && <button onClick={onExpand}>{t('wdOpenFull')}</button>}
        <button className={auto ? 'playing' : ''} onClick={() => setAuto(value => !value)} aria-label={auto ? t('wdPauseAuto') : t('wdStartAuto')}>{auto ? <Pause size={13} /> : <Play size={13} />} {auto ? t('wdPause') : t('wdAuto')}</button>
      </div>
    </div>

    <div className="well-dive-scene">
      <div className="well-dive-sky" aria-hidden="true" />
      <div className="well-dive-strata" style={{ transform: `translateY(${-progress * 8}px)` }}>
        {bands.map((band, index) => <div className={`well-dive-band tone-${palette[index % palette.length]}`} style={{ height: `${band.height}%` }} key={`${band.name}-${index}`}>
          <div className="strata-fold strata-fold-a" /><div className="strata-fold strata-fold-b" />
          <span><b>{band.name}</b><small>{formatDepth(band.top)} – {formatDepth(band.bottom)}{t('unitM')}</small></span>
        </div>)}
      </div>

      <div className="well-dive-casing" aria-hidden="true">
        <span className="casing-wall casing-left" /><span className="casing-wall casing-right" />
        <span className="casing-rib casing-rib-left" /><span className="casing-rib casing-rib-right" />
        <span className="drill-string" /><span className="drill-collar" style={{ top: `${Math.max(48, markerTop - 14)}%` }} />
        <span className="drill-bit" style={{ top: `${markerTop}%` }}><i /><i /><i /></span>
      </div>

      <div className="well-depth-line" style={{ top: `${markerTop}%` }} aria-hidden="true" />
      <output className="well-depth-badge" style={{ top: `${markerTop}%` }}>{t('wdMetres', { depth: formatDepth(visibleDepth) })}</output>
      <div className="well-depth-pulse" style={{ top: `${markerTop}%` }} aria-hidden="true"><i /></div>

      <article className="formation-inspector">
        <span>{t('wdActive')}</span><strong>{activeFormation?.name || report.formation || t('wdFormationNA')}</strong>
        <p>{formatDepth(activeFormation?.top || 0)}–{formatDepth(activeFormation?.bottom || maxDepth)}{t('unitM')}. {t('wdInspect')}</p><ScanLine size={17} />
      </article>

      {nearestEvent?.depth !== null && nearestEvent && <article className="dive-event-callout" style={{ top: `${Math.min(84, Math.max(18, (nearestEvent.depth! / maxDepth) * 100))}%` }}>
        <span>{nearestEvent.severity ? t(nearestEvent.severity === 'high' ? 'sevHigh' : nearestEvent.severity === 'medium' ? 'sevMedium' : 'sevLow') : t('wdEventFb')}</span><b>{nearestEvent.type}</b><small>{t('wdMetres', { depth: formatDepth(nearestEvent.depth!) })}</small>
      </article>}

      <div className="well-depth-scale" aria-hidden="true">{[.25, .5, .75, 1].map(value => <span key={value} style={{ top: `${value * 100}%` }}>{t('wdMetres', { depth: formatDepth(Math.round(maxDepth * value)) })}</span>)}</div>
    </div>

    <div className="well-dive-controls">
      <div className="well-dive-slider-label"><span>{t('wdShallow')}</span><strong>{t('wdMetres', { depth: formatDepth(visibleDepth) })}</strong><span>{t('wdDeep')}</span></div>
      <input type="range" min={0} max={maxDepth} step={10} value={visibleDepth} onChange={event => { setAuto(false); setVisibleDepth(Number(event.target.value)) }} aria-label={t('wdInspectDepth')} />
      <div className="well-dive-control-meta"><span>{activeFormation?.name}</span><small>{t(events.length === 1 ? 'wdTaggedOne' : 'wdTaggedMany', { count: events.length })}</small></div>
    </div>

    {!compact && <div className="well-dive-mobile-events">{events.map((event, index) => <button key={`${event.type}-${index}`} onClick={() => event.depth !== null && setVisibleDepth(event.depth)}><span>{event.type}</span><small>{t('wdMetres', { depth: event.depth?.toLocaleString() ?? '—' })}</small><ChevronDown size={14} /></button>)}</div>}
  </section>
}
