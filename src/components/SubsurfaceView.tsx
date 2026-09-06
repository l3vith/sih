import { useEffect, useMemo, useState } from 'react'
import { Bounds, Html, OrbitControls } from '@react-three/drei'
import { createTubeGeometry, getSplineCurve, type Vec3 } from '@equinor/videx-3d/sdk'
import WebglSafe from './WebglSafe'

type SurveyPoint = { md: number; tvd: number | null; inclination: number | null; azimuth: number | null; northing: number | null; easting: number | null }
type Casing = { name: string; top_md: number | null; bottom_md: number | null; diameter_in: number | null }
type Formation = { name: string; top_md: number | null; bottom_md: number | null }
type SubsurfaceReport = { well_name: string | null; current_md: number | null; current_tvd: number | null; trajectory?: SurveyPoint[]; casings?: Casing[]; formations: Formation[] }
type PathSample = { md: number; point: Vec3 }

const palette = ['#52b9b2', '#efb85c', '#e88970', '#7598a7', '#b6a079']

function Tube({ points, radius, color, opacity = 1 }: { points: Vec3[]; radius: number; color: string; opacity?: number }) {
  const geometry = useMemo(() => {
    const curve = getSplineCurve(points)
    return curve ? createTubeGeometry(curve, { radius, radialSegments: 20, segmentsPerMeter: 0.35, computeNormals: true, startCap: true, endCap: true }) : null
  }, [points, radius])
  useEffect(() => () => geometry?.dispose(), [geometry])
  if (!geometry) return null
  return <mesh geometry={geometry}><meshStandardMaterial color={color} roughness={0.38} metalness={0.38} transparent={opacity < 1} opacity={opacity} /></mesh>
}

function pointAtMd(samples: PathSample[], md: number): Vec3 {
  if (md <= samples[0].md) return samples[0].point
  if (md >= samples[samples.length - 1].md) return samples[samples.length - 1].point
  const upperIndex = samples.findIndex((sample) => sample.md >= md)
  const lower = samples[upperIndex - 1]
  const upper = samples[upperIndex]
  const ratio = (md - lower.md) / Math.max(0.001, upper.md - lower.md)
  return lower.point.map((value, index) => value + (upper.point[index] - value) * ratio) as Vec3
}

function pathBetween(samples: PathSample[], top: number, bottom: number): Vec3[] {
  return [pointAtMd(samples, top), ...samples.filter((sample) => sample.md > top && sample.md < bottom).map((sample) => sample.point), pointAtMd(samples, bottom)]
}

export default function SubsurfaceView({ report }: { report: SubsurfaceReport }) {
  const [expanded, setExpanded] = useState(true)
  const survey = Array.isArray(report.trajectory) ? report.trajectory.filter((point) => Number.isFinite(point.md)) : []
  const formations = (Array.isArray(report.formations) ? [...report.formations] : []).filter((formation) => formation.top_md !== null).sort((a, b) => (a.top_md as number) - (b.top_md as number))
  const casings = (Array.isArray(report.casings) ? report.casings : []).filter((casing) => casing.bottom_md !== null)
  const wellDepth = Math.max(report.current_md || 0, report.current_tvd || 0, ...survey.map((point) => point.md), 1)
  const sceneDepth = Math.max(
    wellDepth,
    ...formations.flatMap((formation) => [formation.top_md || 0, formation.bottom_md || 0]),
    ...casings.flatMap((casing) => [casing.top_md || 0, casing.bottom_md || 0]),
    1,
  )
  const orderedSurvey = [...survey].sort((a, b) => a.md - b.md)
  const firstSurvey = orderedSurvey[0]
  const hasOffsets = orderedSurvey.some((point) => point.easting !== null && point.northing !== null && (
    Math.abs(point.easting - (firstSurvey?.easting || 0)) > 0.01 || Math.abs(point.northing - (firstSurvey?.northing || 0)) > 0.01
  ))
  const hasAngles = orderedSurvey.some((point) => Number.isFinite(point.inclination) && Math.abs(point.inclination || 0) > 0.05)
  const verticalOnly = orderedSurvey.length < 2 || (!hasOffsets && !hasAngles)
  const samples = useMemo<PathSample[]>(() => {
    const scale = 72 / sceneDepth
    if (verticalOnly) return [{ md: 0, point: [0, 0, 0] }, { md: wellDepth, point: [0, -(report.current_tvd || report.current_md || 1) * scale, 0] }]
    const originEasting = orderedSurvey.find((point) => point.easting !== null)?.easting || 0
    const originNorthing = orderedSurvey.find((point) => point.northing !== null)?.northing || 0
    let east = 0
    let north = 0
    const calculated = orderedSurvey.map((point, index) => {
      if (hasOffsets) {
        east = (point.easting ?? originEasting) - originEasting
        north = (point.northing ?? originNorthing) - originNorthing
      } else if (index > 0) {
        const previous = orderedSurvey[index - 1]
        const deltaMd = Math.max(0, point.md - previous.md)
        const inclination = ((point.inclination ?? previous.inclination ?? 0) * Math.PI) / 180
        const azimuth = ((point.azimuth ?? previous.azimuth ?? 0) * Math.PI) / 180
        const horizontal = deltaMd * Math.sin(inclination)
        east += horizontal * Math.sin(azimuth)
        north += horizontal * Math.cos(azimuth)
      }
      return { md: point.md, point: [east * scale, -(point.tvd ?? point.md) * scale, north * scale] as Vec3 }
    })
    if (calculated[0]?.md > 0) calculated.unshift({ md: 0, point: [0, 0, 0] })
    return calculated
  }, [orderedSurvey, report.current_md, report.current_tvd, sceneDepth, wellDepth, verticalOnly, hasOffsets])
  const lastMd = samples[samples.length - 1].md
  const locatedFormations = formations.filter((formation) => (formation.top_md as number) <= lastMd)
  // A shared schematic depth mapping keeps the well and its intersections attached.
  // Insert every formation boundary into the path before applying the mapping.
  const tops = [...new Set(locatedFormations.map((formation) => formation.top_md as number))].sort((a, b) => a - b)
  const anchors = [0, ...tops.filter((md) => md > 0), ...(lastMd > (tops.at(-1) ?? 0) ? [lastMd] : [])]
  const displayDepths = anchors.map((_, index) => index === 0 ? 0 : index === 1 ? 22 : 22 + (index - 1) * 17)
  const displayPoint = (md: number): Vec3 => {
    const point = pointAtMd(samples, md)
    if (!expanded || tops.length < 2) return point
    const upper = anchors.findIndex((depth) => depth >= md)
    if (upper <= 0) return [point[0], 0, point[2]]
    const ratio = (md - anchors[upper - 1]) / (anchors[upper] - anchors[upper - 1])
    return [point[0], -(displayDepths[upper - 1] + ratio * (displayDepths[upper] - displayDepths[upper - 1])), point[2]]
  }
  const displaySamples = [...new Set([...samples.map((sample) => sample.md), ...anchors])].sort((a, b) => a - b).map((md) => ({ md, point: displayPoint(md) }))
  const trajectory = displaySamples.map((sample) => sample.point)

  return <div className="subsurface-shell">
    <WebglSafe orthographic camera={{ position: [90, 30, 95], zoom: 6.2, near: 0.1, far: 1000 }} dpr={[1, 1.7]}>
      <color attach="background" args={['#eef5f3']} />
      <ambientLight intensity={1.25} />
      <directionalLight position={[35, 60, 45]} intensity={2.1} />
      <Bounds key={`${report.well_name}-${expanded}`} fit clip observe margin={1.25}>
      <gridHelper args={[78, 13, '#83aaa5', '#d0dfdc']} position={[0, 0, 0]} />
      {locatedFormations.map((formation, index) => {
        const top = formation.top_md as number
        const position = displayPoint(top)
        const bottomPosition = formation.bottom_md !== null && formation.bottom_md > top && formation.bottom_md <= lastMd
          ? displayPoint(formation.bottom_md) : null
        const thickness = bottomPosition ? Math.max(0, position[1] - bottomPosition[1]) : 0
        return <group key={`${formation.name}-${index}`} position={position}>
          {thickness > 0 && <mesh position={[0, -thickness / 2, 0]}><boxGeometry args={[76, thickness, 62]} /><meshStandardMaterial color={palette[index % palette.length]} transparent opacity={0.16} depthWrite={false} side={2} /></mesh>}
          <mesh rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[76, 62]} /><meshBasicMaterial color={palette[index % palette.length]} transparent opacity={0.45} depthWrite={false} side={2} /></mesh>
        </group>
      })}
      {casings.map((casing, index) => {
        const top = Math.max(0, casing.top_md || 0)
        const bottom = Math.min(wellDepth, casing.bottom_md as number)
        if (bottom <= top) return null
        return <Tube key={`${casing.name}-${index}`} points={pathBetween(displaySamples, top, bottom)} radius={2.35 + index * 0.48} color={palette[(index + 2) % palette.length]} opacity={0.52} />
      })}
      <Tube points={trajectory} radius={1.5} color="#203a38" />
      <mesh position={trajectory[trajectory.length - 1]}><sphereGeometry args={[2.35, 24, 16]} /><meshStandardMaterial color="#e86b4d" roughness={0.35} /></mesh>
      <Html position={[0, 4, 0]} center><span className="subsurface-well-label">{report.well_name || 'Selected well'}</span></Html>
      </Bounds>
      <OrbitControls makeDefault target={[0, -34, 0]} enableDamping dampingFactor={0.08} />
    </WebglSafe>
    <button className="subsurface-scale-toggle" aria-pressed={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? 'Expanded layers · switch to true scale' : 'True scale · expand layers'}</button>
    {formations.length > 0 && <div className="subsurface-formations"><b>FORMATION TOPS</b>{formations.map((formation, index) => <span key={`${formation.name}-legend-${index}`}><i style={{ background: palette[index % palette.length] }} /><strong>{formation.name}</strong><small>{formation.top_md?.toLocaleString()} m</small></span>)}</div>}
    <div className="subsurface-legend"><span><i className="trajectory-key" /> Well path · width exaggerated</span><span><i className="horizon-key" /> Local formation intersections · horizontal extent illustrative</span><span>Depths in legend are MD</span>{formations.length > locatedFormations.length && <span>{formations.length - locatedFormations.length} tops outside survey coverage</span>}</div>
    {verticalOnly && <div className="subsurface-note">No directional survey found · showing the documented MD/TVD as a vertical projection</div>}
  </div>
}
