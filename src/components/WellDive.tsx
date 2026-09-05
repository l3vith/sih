import { useEffect, useMemo, useRef, useState } from 'react'

type Formation = { name: string; top_md: number | null; bottom_md: number | null }
type Event = { time: string | null; type: string; depth: number | null; severity: 'high' | 'medium' | 'low' | null; mitigation: string | null; evidence: string }
type Risk = { label: string; probability: number | null; trend: 'rising' | 'steady' | 'falling' | null; evidence: string }
type Report = {
  well_name: string | null; report_date: string | null; report_number: string | null; latitude: number | null; longitude: number | null;
  current_md: number | null; current_tvd: number | null; formation: string | null; mud_weight: string | null; operator: string | null;
  rig_name: string | null; lease_block: string | null; progress: number | null; avg_rop: number | null; formations: Formation[];
  events: Event[]; risks: Risk[]; offset_wells: { id: string }[]; sections: { label: string }[];
}

export default function WellDive({ report, compact = false, onExpand }: { report: Report; compact?: boolean; onExpand?: () => void }) {
  const formations = useMemo(() => {
    if (report.formations?.length) return report.formations
    if (report.formation) return [{ name: report.formation, top_md: null, bottom_md: null }]
    return [] as Formation[]
  }, [report.formations, report.formation])

  const maxDepth = useMemo(() => {
    if (report.current_md && Number.isFinite(report.current_md)) return report.current_md
    const bottoms = formations.map(f => f.bottom_md).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    if (bottoms.length) return Math.max(...bottoms)
    return 3200
  }, [report.current_md, formations])

  const minDepth = useMemo(() => {
    const tops = formations.map(f => f.top_md).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    if (tops.length) return Math.min(...tops, 0)
    return 0
  }, [formations])

  const range = Math.max(200, maxDepth - minDepth)
  const [visibleDepth, setVisibleDepth] = useState(() => Math.round(maxDepth * 0.86))
  const [auto, setAuto] = useState(false)

  useEffect(() => {
    setVisibleDepth(v => Math.min(maxDepth, Math.max(minDepth, v)))
  }, [maxDepth, minDepth])

  useEffect(() => {
    if (!auto) return
    let raf = 0
    let last = performance.now()
    const speed = 180
    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      setVisibleDepth(prev => {
        const next = prev + speed * dt
        if (next >= maxDepth) { setAuto(false); return maxDepth }
        return Math.round(next)
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [auto, maxDepth])

  const progress = useMemo(() => {
    const p = (visibleDepth - minDepth) / range
    return Math.min(1, Math.max(0, p))
  }, [visibleDepth, minDepth, range])

  const bands = useMemo(() => {
    if (!formations.length) return [{ name: 'Undifferentiated', top: minDepth, bottom: maxDepth, pct: 100 }]
    const total = range
    const MIN = 8
    const raw = formations.map((f, i) => {
      const top = typeof f.top_md === 'number' && Number.isFinite(f.top_md) ? f.top_md! : minDepth + (i / formations.length) * total
      const bottom = typeof f.bottom_md === 'number' && Number.isFinite(f.bottom_md) ? f.bottom_md! : top + total / formations.length
      const clampedTop = Math.max(minDepth, Math.min(maxDepth, top))
      const clampedBottom = Math.max(minDepth, Math.min(maxDepth, bottom))
      const pct = ((clampedBottom - clampedTop) / total) * 100
      return { name: f.name, top: clampedTop, bottom: clampedBottom, pct }
    })
    // floor thin bands at MIN so their labels stay legible, then take the
    // excess back from bands above MIN so the total stays exactly 100%
    // (previously the total could exceed 100% and push labels out of view)
    const out = raw.map(b => ({ ...b, pct: Math.max(b.pct, MIN) }))
    const sum = out.reduce((s, b) => s + b.pct, 0)
    if (sum > 100) {
      const over = sum - 100
      const adjustable = out.reduce((s, b) => s + Math.max(0, b.pct - MIN), 0)
      if (adjustable > 0) {
        for (const b of out) b.pct -= over * (Math.max(0, b.pct - MIN) / adjustable)
      } else {
        const scale = 100 / sum
        for (const b of out) b.pct *= scale
      }
    }
    return out
  }, [formations, minDepth, maxDepth, range])

  const depthEvents = useMemo(() => report.events.filter(e => typeof e.depth === 'number' && Number.isFinite(e.depth as number) && e.depth !== null).slice(0, 6) as Required<Event>[], [report.events])

  const activeFormation = useMemo(() => {
    for (const b of bands) if (visibleDepth >= b.top && visibleDepth <= b.bottom) return b.name
    return report.formation || bands[bands.length - 1]?.name || '—'
  }, [bands, visibleDepth, report.formation])

  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReduced) return
    const ctx = canvas.getContext('2d', { alpha: true } as never)
    if (!ctx) return
    let raf = 0
    const count = compact ? 18 : 32
    let particles = Array.from({ length: count }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: 0.7 + Math.random() * 1.8,
      vx: -0.18 + Math.random() * 0.36,
      vy: 0.35 + Math.random() * 0.9,
      a: 0.18 + Math.random() * 0.42,
    }))
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    const draw = () => {
      const rect = canvas.getBoundingClientRect()
      const w = rect.width, h = rect.height
      ctx.clearRect(0, 0, w, h)
      const drift = progress * 18
      for (const p of particles) {
        p.x += p.vx
        p.y += p.vy + drift * 0.02
        if (p.y > h + 4) { p.y = -4; p.x = Math.random() * w }
        if (p.x < -4) p.x = w + 4
        if (p.x > w + 4) p.x = -4
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(255,255,255,${p.a})`
        if (p.r > 1.6) ctx.fillStyle = `rgba(232,107,77,${p.a * 0.55})`
        else if (p.r < 1) ctx.fillStyle = `rgba(85,201,197,${p.a * 0.45})`
        ctx.fill()
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [progress])

  const depthLabel = (d: number) => d.toLocaleString()

  const toneFor = (name: string) => {
    const n = name.toLowerCase()
    if (n.includes('barail')) return 'barail'
    if (n.includes('tipam') || n.includes('bokabil')) return 'tipam'
    if (n.includes('girus') || n.includes('lakadong')) return 'girus'
    if (n.includes('kopili')) return 'kopili'
    return 'default'
  }

  const strataY = -progress * 44
  const pipeYpct = progress * 100

  return (
    <div className={`well-dive ${compact ? 'compact' : ''}`}>
      <div className="well-dive-toolbar">
        <span className="well-dive-formation"><i /> {activeFormation}</span>
        <span className="well-dive-depth">{depthLabel(visibleDepth)}<em>m MD</em></span>
        {compact && onExpand && <button className="well-dive-expand" onClick={onExpand} aria-label="Open full dive">⤢ Expand</button>}
        <button className={`well-dive-auto ${auto ? 'playing' : ''}`} onClick={() => setAuto(v => !v)} aria-label="Auto dive">
          {auto ? '⏸︎ Pause' : '▶ Auto dive'}
        </button>
      </div>

      <div className="well-dive-chart" aria-label={`Well dive from ${minDepth} to ${maxDepth} metres`}>
        <div className="well-dive-backdrop" style={{ opacity: 0.55 + progress * 0.45 }} />
        <div className="well-dive-strata" style={{ transform: `translateY(${strataY}px)` }}>
          {bands.map((b, i) => (
            <div key={`${b.name}-${i}`} className={`well-dive-band tone-${toneFor(b.name)}${b.pct < 14 ? ' thin' : ''}`} style={{ flex: `0 0 ${b.pct}%` }}>
              <span className="band-name" title={b.name}>{b.name}</span>
              <span className="band-range">{depthLabel(b.top)} – {depthLabel(b.bottom)} m</span>
              <i className="band-grain" />
            </div>
          ))}
        </div>
        <div className="well-dive-gamma" style={{ transform: `translateX(${progress * 10 - 5}px)` }} />
        <div className="well-dive-bore">
          <div className="bore-line" />
          <div className="bore-dots">
            {bands.map((_, i) => {
              const isHot = depthEvents.some(ev => {
                const evPct = ((ev.depth as unknown as number) - minDepth) / range
                const dotPct = (i + 0.5) / bands.length
                return Math.abs(evPct - dotPct) < 0.08
              })
              return <i key={i} className={isHot ? 'hot' : ''} />
            })}
          </div>
        </div>
        <div className="well-dive-pipe" style={{ top: `${pipeYpct}%` }}>
          <div className="pipe-shaft" />
          <div className="pipe-bit"><span /></div>
          <div className="pipe-glow" />
        </div>
        {depthEvents.map((ev, idx) => {
          const rawPct = ((ev.depth as unknown as number) - minDepth) / range * 100
          const pct = Math.min(92, Math.max(8, rawPct))
          const dist = Math.abs((ev.depth as unknown as number) - visibleDepth)
          const near = dist < 180
          return (
            <div key={`${ev.type}-${idx}`} className={`well-dive-event ${ev.severity || ''} ${near ? 'near' : ''}`} style={{ top: `${pct}%` }}>
              <b>{ev.type}</b>
              <small>{ev.depth} m · {ev.severity || 'not rated'}</small>
              <em>{near ? ev.evidence.slice(0, 64) : ''}</em>
            </div>
          )
        })}
        <canvas ref={canvasRef} className="well-dive-particles" aria-hidden="true" />
        <div className="well-dive-tick" style={{ top: `${pipeYpct}%` }}>
          <span>{depthLabel(visibleDepth)} m</span>
        </div>
        <div className="well-dive-ruler">
          {[0, 0.25, 0.5, 0.75, 1].map(t => {
            const d = Math.round(minDepth + t * range)
            const labelTop = Math.min(95, Math.max(5, t * 100))
            return <span key={t} style={{ top: `${labelTop}%` }}>{depthLabel(d)}</span>
          })}
        </div>
        <div className="well-dive-rail">
          {bands.map((b, i) => (
            <span key={`rail-${i}`} className={visibleDepth >= b.top && visibleDepth <= b.bottom ? 'active' : ''} style={{ flex: `0 0 ${b.pct}%` }}>
              {b.name}
            </span>
          ))}
        </div>
      </div>

      <div className="well-dive-controls">
        <div className="well-dive-slider">
          <span>SHALLOW</span>
          <input type="range" min={minDepth} max={maxDepth} step={10} value={visibleDepth} onChange={e => { setAuto(false); setVisibleDepth(parseInt(e.target.value)) }} aria-label="Dive depth" />
          <span>DEEP</span>
          <strong>{depthLabel(visibleDepth)} m</strong>
        </div>
        <div className="well-dive-hints">
          <small>Drag to plunge · {depthEvents.length ? `${depthEvents.length} event pin(s)` : 'No depth-tagged events'}</small>
          <small className="well-dive-formation-hint">{bands.length} formation(s) · dust drifts deeper with depth</small>
        </div>
      </div>
    </div>
  )
}
