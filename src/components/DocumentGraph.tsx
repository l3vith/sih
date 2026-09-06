import { useMemo, useState } from 'react'
import { Bounds, Html, Line, OrbitControls } from '@react-three/drei'
import WebglSafe from './WebglSafe'

type Doc = { name: string; documentVector: number[] | null; embeddingModel: string; report: { well_name: string | null; formation: string | null; events?: { type: string; evidence: string }[]; risks?: { label: string; evidence: string }[] } }
type Position = [number, number, number]

export default function DocumentGraph({ documents, activeName, onSelect }: { documents: Doc[]; activeName: string; onSelect: (name: string) => void }) {
  const [threshold, setThreshold] = useState(0.5)
  const [reset, setReset] = useState(0)
  const [hovered, setHovered] = useState<{ a: number; b: number; score: number } | null>(null)
  const pairs = useMemo(() => {
    const result: { a: number; b: number; score: number }[] = []
    documents.forEach((doc, a) => documents.slice(a + 1).forEach((other, offset) => {
      const x = doc.documentVector, y = other.documentVector
      if (!x?.length || !y || x.length !== y.length || doc.embeddingModel !== other.embeddingModel || !x.every(Number.isFinite) || !y.every(Number.isFinite)) return
      const denominator = Math.hypot(...x) * Math.hypot(...y)
      if (!denominator) return
      const score = Math.max(-1, Math.min(1, x.reduce((sum, value, i) => sum + value * y[i], 0) / denominator))
      result.push({ a, b: a + offset + 1, score })
    }))
    return result
  }, [documents])
  const edges = pairs.filter((edge) => edge.score >= threshold)
  const positions = useMemo<Position[]>(() => {
    const points: Position[] = documents.map((_, index) => {
    if (documents.length === 1) return [0, 0, 0]
    const y = 1 - 2 * (index + 0.5) / documents.length
    const radius = Math.sqrt(1 - y * y) * 6
    const angle = index * 2.399963
    return [Math.cos(angle) * radius, y * 5, Math.sin(angle) * radius]
    })
    // Minimize pairwise distance error: high cosine similarity has a shorter target.
    // Use all comparable pairs so changing edge visibility does not move the layout.
    for (let iteration = 0; iteration < 350; iteration++) {
      const forces = points.map(() => [0, 0, 0])
      for (const { a, b, score } of pairs) {
        const delta = points[b].map((value, axis) => value - points[a][axis])
        const distance = Math.hypot(...delta) || 0.001
        const target = 2 + 10 * (1 - score)
        const magnitude = (distance - target) * 0.12 / Math.max(1, documents.length)
        for (let axis = 0; axis < 3; axis++) {
          const force = delta[axis] / distance * magnitude
          forces[a][axis] += force; forces[b][axis] -= force
        }
      }
      points.forEach((point, index) => point.forEach((_, axis) => { point[axis] += forces[index][axis] }))
    }
    return points
  }, [documents, pairs])
  const selectedIndex = documents.findIndex((doc) => doc.name === activeName)
  const connections = edges.filter((edge) => edge.a === selectedIndex || edge.b === selectedIndex).sort((a, b) => b.score - a.score)
  return <div className="document-graph">
    <div className="graph-toolbar"><strong>{documents.length} documents · {edges.length} connections</strong><label>Minimum similarity <input aria-label="Minimum similarity" type="range" min="0" max="1" step="0.05" value={threshold} onChange={(event) => setThreshold(Number(event.target.value))} /><output>{threshold.toFixed(2)}</output></label><button onClick={() => setReset((value) => value + 1)}>Reset view</button></div>
    <div className="graph-canvas">
      <WebglSafe key={reset} camera={{ position: [14, 10, 18], fov: 45 }} dpr={[1, 1.5]} frameloop="demand">
        <color attach="background" args={['#f1f7f5']} /><ambientLight intensity={1.6} /><directionalLight position={[10, 15, 10]} intensity={2} />
        <Bounds fit clip observe margin={1.5}>
          {edges.map((edge) => <group key={`${edge.a}-${edge.b}`}>
            <Line points={[positions[edge.a], positions[edge.b]]} color={hovered === edge ? '#c45838' : edge.a === selectedIndex || edge.b === selectedIndex ? '#dc876c' : '#9bbdb7'} lineWidth={hovered === edge ? 5 : 1 + edge.score * 2} transparent opacity={0.8} />
            <Line points={[positions[edge.a], positions[edge.b]]} lineWidth={16} transparent opacity={0} depthWrite={false} onPointerOver={(event) => { event.stopPropagation(); setHovered(edge) }} onPointerOut={() => setHovered(null)} onClick={(event) => { event.stopPropagation(); setHovered(edge) }} />
          </group>)}
          {documents.map((doc, index) => <group key={doc.name} position={positions[index]}>
            <mesh onClick={(event) => { event.stopPropagation(); onSelect(doc.name) }}><sphereGeometry args={[index === selectedIndex ? 0.48 : 0.34, 24, 16]} /><meshStandardMaterial color={index === selectedIndex ? '#e86b4d' : '#409b92'} roughness={0.35} /></mesh>
            <Html position={[0, 0.7, 0]} center><button className={`graph-node-label ${index === selectedIndex ? 'selected' : ''}`} onClick={() => onSelect(doc.name)} title={doc.name}>{doc.report.well_name || doc.name}</button></Html>
          </group>)}
        </Bounds><OrbitControls makeDefault />
      </WebglSafe>
      {hovered && hovered.score >= threshold && <div className="graph-edge-tooltip" role="tooltip">
        <strong>{documents[hovered.a].report.well_name || documents[hovered.a].name} ↔ {documents[hovered.b].report.well_name || documents[hovered.b].name}</strong>
        <b>Similarity {hovered.score.toFixed(2)}</b>
        {documents[hovered.a].report.formation && documents[hovered.a].report.formation === documents[hovered.b].report.formation && <p>Shared formation: {documents[hovered.a].report.formation}</p>}
        {[hovered.a, hovered.b].map((index) => {
          const doc = documents[index]
          const issues = [...(doc.report.events || []).map((event) => ({ label: event.type, evidence: event.evidence })), ...(doc.report.risks || [])].slice(0, 3)
          return <section key={doc.name}><b>{doc.name}</b>{issues.length ? issues.map((issue, i) => <p key={i}><strong>{issue.label}</strong>{issue.evidence && ` — ${issue.evidence.slice(0, 150)}`}</p>) : <p>No issues extracted from this report.</p>}</section>
        })}
      </div>}
      <p className="graph-hint">Drag to rotate · scroll to zoom · select a document</p>
    </div>
    <div className="graph-connections"><strong>Connections for {documents[selectedIndex]?.report.well_name || activeName}</strong>{connections.length ? connections.map((edge) => {
      const other = documents[edge.a === selectedIndex ? edge.b : edge.a]
      return <button key={other.name} onClick={() => onSelect(other.name)}><span>{other.name}</span><b>{edge.score.toFixed(2)} similarity</b></button>
    }) : <p>{documents.length === 1 ? 'Upload another document to create connections.' : 'No comparable embeddings meet this threshold.'}</p>}<small>Closer nodes represent greater similarity in stored embeddings. The 3D layout approximates pairwise distances. Hover an edge to compare extracted issues.</small></div>
  </div>
}
