'use client'

/**
 * ListingsMap — MapLibre GL / react-map-gl split-screen map
 * - MapTiler "positron" base style (light, minimal, warm-palette friendly)
 * - Custom price-pill markers (GH₵ amount)
 * - Supercluster for marker clustering
 * - Click marker → popup mini-card (photo, title, price, rating)
 * - Cluster click → zoom in
 */

import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import Map, {
  Marker,
  Popup,
  NavigationControl,
  MapRef,
  MapMouseEvent,
} from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import Supercluster from 'supercluster'
import { Star, X } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────

export type MapListing = {
  id: string
  title: string
  neighbourhood: string
  city: string
  photo: string
  rating: number
  reviews: number
  priceNightly?: number
  priceMonthly?: number
  priceAnnual?: number
  coordinates: [number, number]   // [lng, lat]
  activeMode?: string
}

type ViewState = {
  longitude: number
  latitude: number
  zoom: number
}

type ClusterProperties = {
  cluster: true
  cluster_id: number
  point_count: number
}

type PointProperties = {
  cluster: false
  listingId: string
}

type AnyFeature =
  | GeoJSON.Feature<GeoJSON.Point, ClusterProperties>
  | GeoJSON.Feature<GeoJSON.Point, PointProperties>

// ── Constants ─────────────────────────────────────────────────────────────

const GHS_RATE = 15.5

export const REGION_CENTERS: Record<string, [number, number]> = {
  'Greater Accra': [-0.187, 5.55],
  'Ashanti':       [-1.623, 6.694],
  'Western':       [-1.741, 4.901],
  'Central':       [-1.279, 5.105],
  'Eastern':       [-0.447, 6.10],
  'Northern':      [-0.853, 9.407],
  'Volta':         [0.448,  7.00],
  'Upper East':    [-0.489, 10.93],
  'Upper West':    [-2.333, 10.25],
  'Bono':          [-2.25,  7.65],
  'Ahafo':         [-2.40,  7.25],
  'Bono East':     [-1.45,  7.70],
  'Oti':           [0.15,   8.10],
  'Savannah':      [-1.70,  8.80],
  'North East':    [-0.20,  10.50],
  'Western North': [-2.75,  5.80],
}

const ACCRA_DEFAULT: ViewState = { longitude: -0.187, latitude: 5.55, zoom: 11.5 }

const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY || ''
const MAP_STYLE = `https://api.maptiler.com/maps/positron/style.json?key=${MAPTILER_KEY}`

// ── Helpers ───────────────────────────────────────────────────────────────

function formatGHS(usdPrice: number): string {
  const ghs = Math.round(usdPrice * GHS_RATE)
  if (ghs >= 10000) return `GH₵${(ghs / 1000).toFixed(0)}k`
  if (ghs >= 1000)  return `GH₵${(ghs / 1000).toFixed(1)}k`
  return `GH₵${ghs}`
}

function getDisplayPrice(listing: MapListing): number {
  if (listing.activeMode === 'SHORT_STAY' && listing.priceNightly) return listing.priceNightly
  if (listing.activeMode === 'PERMANENT' && listing.priceAnnual)   return listing.priceAnnual
  return listing.priceMonthly ?? listing.priceNightly ?? listing.priceAnnual ?? 0
}

// ── Sub-components ────────────────────────────────────────────────────────

function PriceMarker({
  price, hovered, onClick,
}: { price: string; hovered: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontFamily: "'Plus Jakarta Sans', sans-serif",
        fontSize: '12px',
        fontWeight: 600,
        padding: '5px 10px',
        borderRadius: '999px',
        border: '1.5px solid',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transition: 'transform 0.15s ease, background 0.15s ease, color 0.15s ease',
        transform: hovered ? 'scale(1.08)' : 'scale(1)',
        backgroundColor: hovered ? '#C9932E' : '#FAF7F2',
        color:           hovered ? '#fff'     : '#1F1B16',
        borderColor:     hovered ? '#B37F22'  : '#D4C9B8',
        boxShadow: hovered
          ? '0 4px 16px rgba(201,147,46,0.35)'
          : '0 2px 8px rgba(31,27,22,0.14)',
      }}
    >
      {price}
    </button>
  )
}

function ClusterMarker({
  count, onClick,
}: { count: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontFamily: "'Plus Jakarta Sans', sans-serif",
        fontSize: '12px',
        fontWeight: 700,
        padding: '6px 12px',
        borderRadius: '999px',
        border: '2px solid #B37F22',
        cursor: 'pointer',
        backgroundColor: '#C9932E',
        color: '#fff',
        boxShadow: '0 4px 16px rgba(201,147,46,0.4)',
        transition: 'transform 0.15s ease',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.08)' }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)' }}
    >
      {count} stays
    </button>
  )
}

function PopupCard({
  listing,
  onClose,
}: { listing: MapListing; onClose: () => void }) {
  const price = getDisplayPrice(listing)
  const unit  = listing.activeMode === 'SHORT_STAY' ? '/night'
              : listing.activeMode === 'PERMANENT'  ? '/year' : '/mo'

  return (
    <div
      style={{
        width: 240,
        borderRadius: 16,
        overflow: 'hidden',
        backgroundColor: '#fff',
        boxShadow: '0 12px 40px rgba(31,27,22,0.18)',
        fontFamily: "'Plus Jakarta Sans', sans-serif",
      }}
    >
      {/* Photo */}
      <div style={{ position: 'relative', height: 130 }}>
        <img
          src={listing.photo}
          alt={listing.title}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
        <button
          onClick={onClose}
          style={{
            position: 'absolute', top: 8, right: 8,
            width: 28, height: 28, borderRadius: '50%',
            backgroundColor: 'rgba(255,255,255,0.9)',
            border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <X size={14} color="#1F1B16" />
        </button>
      </div>

      {/* Body */}
      <div style={{ padding: '10px 12px 12px' }}>
        <p
          style={{
            fontSize: 13, fontWeight: 600, color: '#1F1B16',
            lineHeight: 1.35, marginBottom: 4,
            display: '-webkit-box', WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}
        >
          {listing.title}
        </p>

        <p style={{ fontSize: 11, color: '#6B645C', marginBottom: 8 }}>
          {listing.neighbourhood}, {listing.city}
        </p>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#1F1B16' }}>
              ${price.toLocaleString()}
            </span>
            <span style={{ fontSize: 11, color: '#6B645C' }}>{unit}</span>
            <div style={{ fontSize: 10, color: '#9C9589', marginTop: 1 }}>
              ≈ {formatGHS(price)}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <Star size={11} fill="#C9932E" color="#C9932E" />
            <span style={{ fontSize: 12, fontWeight: 600, color: '#1F1B16' }}>
              {listing.rating}
            </span>
            <span style={{ fontSize: 11, color: '#9C9589' }}>({listing.reviews})</span>
          </div>
        </div>

        <a
          href={`/listings/${listing.id}`}
          style={{
            display: 'block', marginTop: 10, textAlign: 'center',
            padding: '7px 0', borderRadius: 999,
            backgroundColor: '#C9932E', color: '#fff',
            fontSize: 12, fontWeight: 600, textDecoration: 'none',
          }}
        >
          View listing →
        </a>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

interface ListingsMapProps {
  listings: MapListing[]
  initialRegion?: string
}

export function ListingsMap({ listings, initialRegion }: ListingsMapProps) {
  const mapRef = useRef<MapRef>(null)

  // Determine initial center from region or default to Accra
  const initialCenter = useMemo<ViewState>(() => {
    if (initialRegion && REGION_CENTERS[initialRegion]) {
      const [lng, lat] = REGION_CENTERS[initialRegion]
      return { longitude: lng, latitude: lat, zoom: 11 }
    }
    return ACCRA_DEFAULT
  }, [initialRegion])

  const [viewState, setViewState] = useState<ViewState>(initialCenter)
  const [clusters, setClusters] = useState<AnyFeature[]>([])
  const [hoveredId, setHoveredId]   = useState<string | null>(null)
  const [popupListing, setPopupListing] = useState<MapListing | null>(null)

  // Build supercluster from listings
  const sc = useRef(
    new Supercluster<PointProperties, Record<string, never>>({ radius: 55, maxZoom: 16 })
  )

  const points = useMemo<GeoJSON.Feature<GeoJSON.Point, PointProperties>[]>(
    () =>
      listings.map((l) => ({
        type: 'Feature' as const,
        properties: { cluster: false, listingId: l.id },
        geometry: { type: 'Point' as const, coordinates: l.coordinates },
      })),
    [listings],
  )

  useEffect(() => {
    sc.current.load(points)
    recalcClusters()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points])

  // Re-center when region changes
  useEffect(() => {
    if (initialRegion && REGION_CENTERS[initialRegion]) {
      const [lng, lat] = REGION_CENTERS[initialRegion]
      setViewState((v) => ({ ...v, longitude: lng, latitude: lat, zoom: 11 }))
    }
  }, [initialRegion])

  function recalcClusters() {
    const map = mapRef.current?.getMap()
    if (!map) return
    const bounds = map.getBounds()
    if (!bounds) return
    const zoom = Math.floor(map.getZoom())
    const next = sc.current.getClusters(
      [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
      zoom,
    ) as AnyFeature[]
    setClusters(next)
  }

  const handleMoveEnd = useCallback(() => recalcClusters(), [])

  function handleClusterClick(clusterId: number, lng: number, lat: number) {
    const expansionZoom = Math.min(
      sc.current.getClusterExpansionZoom(clusterId), 16
    )
    mapRef.current?.flyTo({ center: [lng, lat], zoom: expansionZoom, duration: 500 })
  }

  if (!MAPTILER_KEY) {
    return (
      <div
        className="w-full h-full flex items-center justify-center rounded-2xl"
        style={{ backgroundColor: '#F4F2EE', border: '1px solid #E8E1D6' }}
      >
        <div className="text-center px-6">
          <div className="text-4xl mb-3">🗺️</div>
          <p style={{ color: '#6B645C', fontSize: 14, fontWeight: 600 }}>
            Map unavailable
          </p>
          <p style={{ color: '#9C9589', fontSize: 12, marginTop: 4 }}>
            Add NEXT_PUBLIC_MAPTILER_KEY to .env to enable the map
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ width: '100%', height: '100%', borderRadius: 16, overflow: 'hidden' }}>
      <Map
        ref={mapRef}
        {...viewState}
        onMove={(e) => setViewState(e.viewState)}
        onMoveEnd={handleMoveEnd}
        onLoad={recalcClusters}
        style={{ width: '100%', height: '100%' }}
        mapStyle={MAP_STYLE}
        attributionControl={false}
      >
        <NavigationControl position="bottom-right" showCompass={false} />

        {clusters.map((feature) => {
          const [lng, lat] = feature.geometry.coordinates
          const props = feature.properties

          // ── Cluster pill ───────────────────────────────────────────
          if (props.cluster) {
            const { cluster_id, point_count } = props as ClusterProperties
            return (
              <Marker
                key={`cluster-${cluster_id}`}
                longitude={lng}
                latitude={lat}
                anchor="center"
              >
                <ClusterMarker
                  count={point_count}
                  onClick={() => handleClusterClick(cluster_id, lng, lat)}
                />
              </Marker>
            )
          }

          // ── Individual price marker ────────────────────────────────
          const { listingId } = props as PointProperties
          const listing = listings.find((l) => l.id === listingId)
          if (!listing) return null

          const usd   = getDisplayPrice(listing)
          const label = formatGHS(usd)

          return (
            <Marker
              key={`marker-${listingId}`}
              longitude={lng}
              latitude={lat}
              anchor="bottom"
            >
              <PriceMarker
                price={label}
                hovered={hoveredId === listingId}
                onClick={() => {
                  setPopupListing(popupListing?.id === listingId ? null : listing)
                }}
              />
              {/* Invisible hover zone — larger than the pill */}
              <div
                style={{ position: 'absolute', inset: -8, cursor: 'pointer' }}
                onMouseEnter={() => setHoveredId(listingId)}
                onMouseLeave={() => setHoveredId(null)}
              />
            </Marker>
          )
        })}

        {/* Popup */}
        {popupListing && (
          <Popup
            longitude={popupListing.coordinates[0]}
            latitude={popupListing.coordinates[1]}
            anchor="bottom"
            offset={[0, -12]}
            closeButton={false}
            closeOnClick={false}
            onClose={() => setPopupListing(null)}
            style={{ padding: 0 }}
            maxWidth="none"
          >
            <PopupCard
              listing={popupListing}
              onClose={() => setPopupListing(null)}
            />
          </Popup>
        )}
      </Map>
    </div>
  )
}
