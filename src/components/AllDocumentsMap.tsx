import { useEffect, useMemo, useRef, useState } from 'react'
import { Map as MapLibreMap, NavigationControl, Popup, setWorkerUrl, type StyleSpecification } from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import type { FeatureCollection, Point } from 'geojson'
import { MapPinned, Maximize2, X } from 'lucide-react'
import { useLang } from '../lang'

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

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

const HOVER_NEIGHBOURS = 3
const emptyLinks = (): FeatureCollection => ({ type: 'FeatureCollection', features: [] })

export default function AllDocumentsMap({ documents, activeName, onSelect }: {
  documents: MapDocument[]
  activeName: string
  onSelect: (name: string) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const { t } = useLang()
  const [formation, setFormation] = useState('all')
  const [fullscreen, setFullscreen] = useState(false)
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

  const shownRef = useRef(shown)
  shownRef.current = shown

  // fullscreen: lock background scroll, resize map to the fixed viewport, exit on Escape
  useEffect(() => {
    if (!fullscreen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const resize = () => mapRef.current?.resize()
    const frame = requestAnimationFrame(resize)
    const timer = setTimeout(resize, 120)
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setFullscreen(false) }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      cancelAnimationFrame(frame)
      clearTimeout(timer)
      window.removeEventListener('keydown', onKey)
      // let the wrap collapse back first, then fit the map to it
      requestAnimationFrame(resize)
    }
  }, [fullscreen])

  useEffect(() => {
    if (!containerRef.current || features.features.length === 0) return
    mapRef.current?.remove()
    const coordinates = features.features.map((feature) => feature.geometry.coordinates as [number, number])
    const selected = features.features.find((feature) => feature.properties?.state === 'active')?.geometry.coordinates as [number, number] | undefined
    const map = new MapLibreMap({ container: containerRef.current, style, center: selected || coordinates[0], zoom: 8, minZoom: 3, maxZoom: 16, attributionControl: false, renderWorldCopies: false })
    mapRef.current = map
    map.addControl(new NavigationControl({ showCompass: true }), 'top-right')
    type GeojsonSource = { setData: (data: unknown) => void }
    const setSourceData = (id: string, data: unknown) => {
      try { (map.getSource(id) as unknown as GeojsonSource | undefined)?.setData(data) } catch { /* ignore */ }
    }
    const formatKm = (km: number) => (km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`)
    const clearHoverLinks = () => {
      setSourceData('hover-links', emptyLinks())
      setSourceData('hover-link-labels', emptyLinks())
      setSourceData('hover-ring', emptyLinks())
    }
    const showHoverLinks = (docName: string) => {
      const docs = shownRef.current
      const hovered = docs.find((doc) => doc.name === docName)
      if (!hovered || !Number.isFinite(hovered.report.latitude) || !Number.isFinite(hovered.report.longitude)) {
        clearHoverLinks()
        return
      }
      const lat1 = hovered.report.latitude as number
      const lon1 = hovered.report.longitude as number
      const neighbours = docs
        .filter((doc) => doc.name !== docName && Number.isFinite(doc.report.latitude) && Number.isFinite(doc.report.longitude))
        .map((doc) => ({
          doc,
          km: haversineKm(lat1, lon1, doc.report.latitude as number, doc.report.longitude as number),
        }))
        .sort((a, b) => a.km - b.km)
        .slice(0, HOVER_NEIGHBOURS)
      if (!neighbours.length) { clearHoverLinks(); return }
      setSourceData('hover-links', {
        type: 'FeatureCollection',
        features: neighbours.map(({ doc }) => ({
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: [[lon1, lat1], [doc.report.longitude as number, doc.report.latitude as number]],
          },
        })),
      })
      setSourceData('hover-link-labels', {
        type: 'FeatureCollection',
        features: neighbours.map(({ doc, km }) => ({
          type: 'Feature',
          properties: { label: `${doc.report.well_name || doc.name} · ${formatKm(km)}` },
          geometry: {
            type: 'Point',
            coordinates: [(lon1 + (doc.report.longitude as number)) / 2, (lat1 + (doc.report.latitude as number)) / 2],
          },
        })),
      })
      setSourceData('hover-ring', {
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lon1, lat1] } }],
      })
    }
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
      // hover spider lines to nearest wells + distance labels (under dots, above labels)
      map.addSource('hover-links', { type: 'geojson', data: emptyLinks() as never })
      map.addLayer({ id: 'hover-links-line', type: 'line', source: 'hover-links', paint: {
        'line-color': '#e86b4d', 'line-width': 2, 'line-dasharray': [5, 3], 'line-opacity': 0.95,
      } })
      map.addSource('hover-link-labels', { type: 'geojson', data: emptyLinks() as never })
      map.addLayer({ id: 'hover-link-labels', type: 'symbol', source: 'hover-link-labels', layout: {
        'text-field': ['get', 'label'], 'text-size': 11, 'text-offset': [0, -0.9],
        'text-allow-overlap': true, 'text-ignore-placement': true,
      }, paint: { 'text-color': '#7a2f20', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 } })
      map.addSource('hover-ring', { type: 'geojson', data: emptyLinks() as never })
      map.addLayer({ id: 'hover-ring', type: 'circle', source: 'hover-ring', paint: {
        'circle-radius': 14, 'circle-color': 'transparent',
        'circle-stroke-color': '#e86b4d', 'circle-stroke-width': 2.5, 'circle-stroke-opacity': 0.9,
      } })
      map.on('click', 'uploaded-document-points', (event) => {
        const feature = event.features?.[0]
        if (!feature) return
        const point = feature.geometry as Point
        const properties = feature.properties || {}
        if (properties.docName) showHoverLinks(String(properties.docName))
        new Popup({ closeButton: false, offset: 14 })
          .setLngLat(point.coordinates as [number, number])
          .setHTML(`<strong>${properties.id}</strong><br>${properties.depth ? `${Number(properties.depth).toLocaleString()} m` : 'Depth not found'} · ${properties.formation}`)
          .addTo(map)
        if (properties.docName) onSelect(String(properties.docName))
      })
      map.on('mousemove', 'uploaded-document-points', (event) => {
        map.getCanvas().style.cursor = 'pointer'
        const docName = event.features?.[0]?.properties?.docName
        if (docName) showHoverLinks(String(docName))
      })
      map.on('mouseenter', 'uploaded-document-points', () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', 'uploaded-document-points', () => { map.getCanvas().style.cursor = ''; clearHoverLinks() })
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
  return <div className={`real-map-wrap all-documents-map ${fullscreen ? 'fullscreen' : ''}`}>
    <div ref={containerRef} className="real-map" />
    <div className="map-overlay-title">UPLOADED DOCUMENTS <span>• {shown.length} / {documents.length} LOCATED</span></div>
    <div className="map-control-strip all-documents-controls">
      <div className="strip-well"><b>{located.length} mapped reports</b><small>Orange is selected · hover a well for 3 nearest links · click to open</small></div>
      <label className="strip-group"><span>FORMATION</span><select value={formation} onChange={(event) => setFormation(event.target.value)}><option value="all">All formations</option>{formations.map((name) => <option key={name}>{name}</option>)}</select></label>
      <button className="strip-icon-btn" aria-label={t('toggleFs')} onClick={() => setFullscreen((v) => !v)}>{fullscreen ? <X size={14} /> : <Maximize2 size={14} />}</button>
    </div>
  </div>
}
