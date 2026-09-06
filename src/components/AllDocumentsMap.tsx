import { useEffect, useMemo, useRef, useState } from 'react'
import { Map as MapLibreMap, NavigationControl, Popup, setWorkerUrl, type StyleSpecification } from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import type { FeatureCollection, Point } from 'geojson'
import { MapPinned } from 'lucide-react'

setWorkerUrl(maplibreWorkerUrl)

type MapDocument = {
  name: string
  report: {
    well_name: string | null
    latitude: number | null
    longitude: number | null
    current_md: number | null
    formation: string | null
    lease_block: string | null
  }
}

const style: StyleSpecification = {
  version: 8,
  sources: {
    imagery: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© Esri',
    },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#edf7f5' } },
    { id: 'imagery', type: 'raster', source: 'imagery', paint: { 'raster-opacity': 0.84 } },
  ],
}

export default function AllDocumentsMap({ documents, activeName, onSelect }: {
  documents: MapDocument[]
  activeName: string
  onSelect: (name: string) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const [formation, setFormation] = useState('all')
  const formations = useMemo(() => [...new Set(documents.map((doc) => doc.report.formation).filter(Boolean) as string[])], [documents])
  const located = useMemo(() => documents.filter((doc) =>
    Number.isFinite(doc.report.latitude) && Number.isFinite(doc.report.longitude)
  ), [documents])
  const shown = useMemo(() => formation === 'all' ? located : located.filter((doc) => doc.report.formation === formation), [located, formation])
  const features = useMemo<FeatureCollection<Point>>(() => ({
    type: 'FeatureCollection',
    features: shown.map((doc) => ({
      type: 'Feature',
      properties: {
        id: doc.report.well_name || doc.name,
        docName: doc.name,
        depth: doc.report.current_md,
        formation: doc.report.formation || 'Formation not stated',
        lease: doc.report.lease_block || '',
        state: doc.name === activeName ? 'active' : 'indexed',
      },
      geometry: { type: 'Point', coordinates: [doc.report.longitude as number, doc.report.latitude as number] },
    })),
  }), [shown, activeName])

  useEffect(() => {
    if (!containerRef.current || features.features.length === 0) return
    mapRef.current?.remove()
    const coordinates = features.features.map((feature) => feature.geometry.coordinates as [number, number])
    const selected = features.features.find((feature) => feature.properties?.state === 'active')?.geometry.coordinates as [number, number] | undefined
    const map = new MapLibreMap({ container: containerRef.current, style, center: selected || coordinates[0], zoom: 8, minZoom: 3, maxZoom: 16, attributionControl: false, renderWorldCopies: false })
    mapRef.current = map
    map.addControl(new NavigationControl({ showCompass: true }), 'top-right')
    map.on('load', () => {
      map.addSource('uploaded-documents', { type: 'geojson', data: features })
      map.addLayer({ id: 'uploaded-document-points', type: 'circle', source: 'uploaded-documents', paint: {
        'circle-radius': ['case', ['==', ['get', 'state'], 'active'], 10, 7],
        'circle-color': ['case', ['==', ['get', 'state'], 'active'], '#e86b4d', '#51b8b1'],
        'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2.5,
      } })
      map.addLayer({ id: 'uploaded-document-labels', type: 'symbol', source: 'uploaded-documents', layout: {
        'text-field': ['get', 'id'], 'text-offset': [0, 1.45], 'text-size': 11, 'text-allow-overlap': false,
      }, paint: { 'text-color': '#274f4b', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 } })
      map.on('click', 'uploaded-document-points', (event) => {
        const feature = event.features?.[0]
        if (!feature) return
        const point = feature.geometry as Point
        const properties = feature.properties || {}
        new Popup({ closeButton: false, offset: 14 })
          .setLngLat(point.coordinates as [number, number])
          .setHTML(`<strong>${properties.id}</strong><br>${properties.depth ? `${Number(properties.depth).toLocaleString()} m` : 'Depth not found'} · ${properties.formation}`)
          .addTo(map)
        if (properties.docName) onSelect(String(properties.docName))
      })
      map.on('mouseenter', 'uploaded-document-points', () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', 'uploaded-document-points', () => { map.getCanvas().style.cursor = '' })
      if (coordinates.length > 1) {
        const bounds: [[number, number], [number, number]] = [[...coordinates[0]], [...coordinates[0]]]
        for (const [lon, lat] of coordinates) {
          bounds[0][0] = Math.min(bounds[0][0], lon); bounds[0][1] = Math.min(bounds[0][1], lat)
          bounds[1][0] = Math.max(bounds[1][0], lon); bounds[1][1] = Math.max(bounds[1][1], lat)
        }
        map.fitBounds(bounds, { padding: 55, maxZoom: 11, duration: 0 })
      }
    })
    const observer = new ResizeObserver(() => map.resize())
    observer.observe(containerRef.current)
    return () => { observer.disconnect(); map.remove(); if (mapRef.current === map) mapRef.current = null }
  }, [features, onSelect])

  if (!located.length) return <div className="map-missing"><MapPinned size={26} /><b>No uploaded-document coordinates found</b><span>Add latitude and longitude to at least one report.</span></div>
  return <div className="real-map-wrap all-documents-map">
    <div ref={containerRef} className="real-map" />
    <div className="map-overlay-title">UPLOADED DOCUMENTS <span>• {shown.length} / {documents.length} LOCATED</span></div>
    <div className="map-control-strip all-documents-controls">
      <div className="strip-well"><b>{located.length} mapped reports</b><small>Orange is selected · click any well to open its document</small></div>
      <label className="strip-group"><span>FORMATION</span><select value={formation} onChange={(event) => setFormation(event.target.value)}><option value="all">All formations</option>{formations.map((name) => <option key={name}>{name}</option>)}</select></label>
    </div>
  </div>
}
