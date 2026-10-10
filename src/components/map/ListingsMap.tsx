'use client'

/**
 * ListingsMap: MapLibre GL / react-map-gl split-screen map
 * - MapTiler "positron" base style (light, minimal, warm-palette friendly)
 * - Price-pill markers in short US dollars ("$45", "$1.4k")
 * - Supercluster for marker clustering; a cluster shows how many homes it holds
 * - Tap a pin: popup card (photo, title, location, rating, price) that links
 *   to the listing. Tap the map, the close button or press Escape to close.
 * - Tap a cluster: zoom in until its pins separate. Homes too close together
 *   to ever separate open a list popup instead.
 * - highlightId / onSelect link the pins to the cards in the list
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import Map, {
  Marker,
  Popup,
  NavigationControl,
  MapRef,
  MapMouseEvent,
} from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import Supercluster from 'supercluster'
import { Star, X, Map as MapIcon } from 'lucide-react'
import { formatUsdCompact } from '@/lib/utils'
import { shortUsd, clusterLabel } from '@/lib/mapLabels'
import { CheckedBadge } from '@/components/listing/CheckedBadge'
import type { PublicCheck } from '@/lib/listingCheckRules'

// ── Types ─────────────────────────────────────────────────────────────────

export type MapListing = {
  id: string
  title: string
  neighbourhood: string
  city: string
  photo: string
  rating: number
  reviews: number
  /** USD price and unit, exactly as the listing card shows them */
  price: number
  unit: string
  /** Set while FieGH's check of the address and photos stands */
  check?: PublicCheck | null
  coordinates: [number, number]   // [lng, lat]
}

type ViewState = {
  longitude: number
  latitude: number
  zoom: number
}

type PointProperties = {
  cluster?: false
  listingId: string
}

type ClusterProperties = {
  cluster: true
  cluster_id: number
  point_count: number
}

type AnyFeature =
  | GeoJSON.Feature<GeoJSON.Point, ClusterProperties>
  | GeoJSON.Feature<GeoJSON.Point, PointProperties>

// ── Constants ─────────────────────────────────────────────────────────────

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

// The map stops zooming here and homes are clustered all the way up to it, so
// a cluster that is still together at this zoom can never be zoomed apart:
// tapping it lists its homes instead.
const MAX_ZOOM = 18

// The popup always opens above its pin, and the map slides just enough to
// fit it, so it never hangs off the edge of a narrow screen.
const PIN_HEIGHT = 30
const POPUP_GAP = 6
const POPUP_WIDTH = 260      // matches .map-popup-card
const POPUP_HEIGHT = 280     // tallest popup: the list of homes at its full height
const POPUP_MARGIN = 8

// ── Sub-components ────────────────────────────────────────────────────────

function PriceMarker({
  listing, active, open, onClick, onHover,
}: {
  listing: MapListing
  active: boolean
  open: boolean
  onClick: (fromKeyboard: boolean) => void
  onHover: (hovering: boolean) => void
}) {
  return (
    <button
      type="button"
      data-map-pin={listing.id}
      className="map-pin focus-ring"
      aria-label={`${listing.title}, ${formatUsdCompact(listing.price)}${listing.unit}`}
      aria-expanded={open}
      // A click with no pointer behind it (detail 0) came from Enter or Space
      onClick={(e) => onClick(e.detail === 0)}
      // Hover highlight is for a real pointer only: a tap must not leave it stuck
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') onHover(true) }}
      onPointerLeave={(e) => { if (e.pointerType === 'mouse') onHover(false) }}
      style={{
        display: 'block',
        position: 'relative',
        fontFamily: "var(--font-sans)",
        fontSize: '12px',
        fontWeight: 600,
        lineHeight: '16px',
        padding: '5px 10px',
        borderRadius: '999px',
        border: '1.5px solid',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transition: 'transform 0.15s ease, background-color 0.15s ease, color 0.15s ease',
        transform: active ? 'scale(1.08)' : 'scale(1)',
        backgroundColor: active ? '#1F1B16' : '#FAF7F2',
        color:           active ? '#FAF7F2' : '#1F1B16',
        borderColor:     active ? '#1F1B16' : '#D4C9B8',
        boxShadow: active
          ? '0 4px 16px rgba(31,27,22,0.28)'
          : '0 2px 8px rgba(31,27,22,0.14)',
      }}
    >
      {shortUsd(listing.price)}
    </button>
  )
}

function ClusterMarker({
  pinKey, count, lists, open, onClick,
}: {
  pinKey: string
  count: number
  /** Its homes cannot be zoomed apart, so a tap lists them */
  lists: boolean
  open: boolean
  onClick: (fromKeyboard: boolean) => void
}) {
  return (
    <button
      type="button"
      data-map-pin={pinKey}
      className="map-pin focus-ring"
      aria-label={`${count} homes. ${lists ? 'Show list' : 'Zoom in'}`}
      aria-expanded={lists ? open : undefined}
      onClick={(e) => onClick(e.detail === 0)}
      style={{
        display: 'block',
        position: 'relative',
        fontFamily: "var(--font-sans)",
        fontSize: '12px',
        fontWeight: 700,
        lineHeight: '16px',
        padding: '5px 10px',
        minWidth: 40,
        textAlign: 'center',
        borderRadius: '999px',
        border: '1.5px solid #B37F22',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        backgroundColor: '#C9932E',
        color: '#1F1B16',
        boxShadow: '0 4px 16px rgba(201,147,46,0.4)',
      }}
    >
      {clusterLabel(count)}
    </button>
  )
}

function CloseButton({ onClose }: { onClose: (fromKeyboard: boolean) => void }) {
  // 44px target around a smaller visible circle
  return (
    <button
      type="button"
      onClick={(e) => onClose(e.detail === 0)}
      aria-label="Close"
      className="map-popup-close"
    >
      <span>
        <X size={15} color="#1F1B16" aria-hidden />
      </span>
    </button>
  )
}

/** Opened from the keyboard: move focus into the popup, once, so Enter follows it */
function useFocusOnOpen<T extends HTMLElement>(takeFocus: boolean) {
  const ref = useRef<T>(null)
  useEffect(() => {
    if (!takeFocus) return
    // The map attaches the popup to the page just after it renders
    const frame = requestAnimationFrame(() => ref.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [takeFocus])
  return ref
}

function PopupCard({
  listing, href, takeFocus, onClose,
}: { listing: MapListing; href: string; takeFocus: boolean; onClose: (fromKeyboard: boolean) => void }) {
  const linkRef = useFocusOnOpen<HTMLAnchorElement>(takeFocus)

  return (
    <div className="map-popup-card">
      {/* The whole card is the link; the close button sits on top of it */}
      <Link
        href={href}
        className="map-popup-link focus-ring"
        ref={linkRef}
      >
        <div style={{ position: 'relative', height: 132, backgroundColor: '#E8E1D6' }}>
          {listing.photo && (
            <Image
              src={listing.photo}
              alt=""
              fill
              sizes="260px"
              style={{ objectFit: 'cover' }}
            />
          )}
        </div>

        <div style={{ padding: '10px 12px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <p
              style={{
                flex: 1, minWidth: 0,
                fontSize: 14, fontWeight: 600, color: '#1F1B16', lineHeight: 1.35,
                display: '-webkit-box', WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical', overflow: 'hidden',
              }}
            >
              {listing.title}
            </p>
            <span style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0, paddingTop: 2 }}>
              <Star size={11} fill="#C9932E" color="#C9932E" aria-hidden />
              <span style={{ fontSize: 12, fontWeight: 600, color: '#1F1B16' }}>
                <span className="sr-only">Rated </span>
                {listing.rating.toFixed(1)}
              </span>
            </span>
          </div>

          <p style={{ fontSize: 12, color: '#6B645C', marginTop: 2 }}>
            {listing.neighbourhood}, {listing.city}
          </p>

          <p style={{ marginTop: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#1F1B16' }}>
              {formatUsdCompact(listing.price)}
            </span>
            <span style={{ fontSize: 12, color: '#6B645C', marginLeft: 2 }}>{listing.unit}</span>
          </p>
          {listing.unit === '/year' && (
            <p style={{ fontSize: 11, color: '#6B645C', marginTop: 2 }}>
              About {formatUsdCompact(listing.price / 12)} a month
            </p>
          )}
          {listing.check && <div style={{ marginTop: 8 }}><CheckedBadge check={listing.check} /></div>}
        </div>
      </Link>

      <CloseButton onClose={onClose} />
    </div>
  )
}

/** Homes that share a spot on the map: a short list, each row a link */
function GroupCard({
  listings, hrefFor, takeFocus, onClose,
}: {
  listings: MapListing[]
  hrefFor: (id: string) => string
  takeFocus: boolean
  onClose: (fromKeyboard: boolean) => void
}) {
  const firstRef = useFocusOnOpen<HTMLAnchorElement>(takeFocus)

  return (
    <div className="map-popup-card">
      <p className="map-popup-heading">{listings.length} homes here</p>
      <ul className="map-popup-list">
        {listings.map((listing, i) => (
          <li key={listing.id}>
            <Link
              href={hrefFor(listing.id)}
              ref={i === 0 ? firstRef : undefined}
              className="map-popup-row focus-ring"
            >
              <span className="map-popup-thumb">
                {listing.photo && (
                  <Image src={listing.photo} alt="" fill sizes="56px" style={{ objectFit: 'cover' }} />
                )}
              </span>
              <span style={{ minWidth: 0 }}>
                <span className="map-popup-row-title">{listing.title}</span>
                <span style={{ display: 'block', marginTop: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#1F1B16' }}>
                    {formatUsdCompact(listing.price)}
                  </span>
                  <span style={{ fontSize: 12, color: '#6B645C', marginLeft: 2 }}>{listing.unit}</span>
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <CloseButton onClose={onClose} />
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

interface ListingsMapProps {
  listings: MapListing[]
  initialRegion?: string
  /** Query string (with its "?") carried to the listing page, e.g. chosen dates */
  listingQuery?: string
  /** A listing to highlight from outside, e.g. the card being hovered */
  highlightId?: string | null
  /** Called with the listing whose popup opened, or null when it closed */
  onSelect?: (id: string | null) => void
}

export function ListingsMap({
  listings, initialRegion, listingQuery = '', highlightId = null, onSelect,
}: ListingsMapProps) {
  const mapRef = useRef<MapRef>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Determine initial center from region or default to Accra
  const initialCenter = useMemo<ViewState>(() => {
    if (initialRegion && REGION_CENTERS[initialRegion]) {
      const [lng, lat] = REGION_CENTERS[initialRegion]
      return { longitude: lng, latitude: lat, zoom: 11 }
    }
    return ACCRA_DEFAULT
  }, [initialRegion])

  const [viewState, setViewState] = useState<ViewState>(initialCenter)

  // Re-center when the region prop changes. viewState already starts on the
  // initial region, so this only reacts to later changes (adjusting state
  // during render rather than in an effect).
  const [centeredRegion, setCenteredRegion] = useState(initialRegion)
  if (initialRegion !== centeredRegion) {
    setCenteredRegion(initialRegion)
    if (initialRegion && REGION_CENTERS[initialRegion]) {
      const [lng, lat] = REGION_CENTERS[initialRegion]
      setViewState((v) => ({ ...v, longitude: lng, latitude: lat, zoom: 11 }))
    }
  }

  // Visible map bounds, updated on load / move end; clusters derive from them
  const [viewBounds, setViewBounds] = useState<{
    bbox: [number, number, number, number]
    zoom: number
  } | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [popupId, setPopupId]     = useState<string | null>(null)
  const [popupFromKeyboard, setPopupFromKeyboard] = useState(false)
  // A list popup for homes that share a spot: which cluster, and who is in it
  const [group, setGroup] = useState<{
    pinKey: string
    ids: string[]
    coordinates: [number, number]
  } | null>(null)

  const byId = useMemo(() => new globalThis.Map(listings.map((l) => [l.id, l])), [listings])

  // Only one popup at a time, and none for a listing the results no longer hold
  const popupListing = popupId ? byId.get(popupId) ?? null : null
  const groupListings = useMemo(
    () => (group ? group.ids.flatMap((id) => byId.get(id) ?? []) : []),
    [group, byId],
  )

  const points = useMemo<GeoJSON.Feature<GeoJSON.Point, PointProperties>[]>(
    () =>
      listings.map((l) => ({
        type: 'Feature' as const,
        properties: { listingId: l.id },
        geometry: { type: 'Point' as const, coordinates: l.coordinates },
      })),
    [listings],
  )

  // Build supercluster index from listings
  const index = useMemo(() => {
    const sc = new Supercluster<PointProperties>({ radius: 55, maxZoom: MAX_ZOOM })
    sc.load(points)
    return sc
  }, [points])

  const clusters = useMemo<AnyFeature[]>(
    () => (viewBounds ? (index.getClusters(viewBounds.bbox, viewBounds.zoom) as AnyFeature[]) : []),
    [index, viewBounds],
  )

  const updateBounds = useCallback(() => {
    const map = mapRef.current?.getMap()
    if (!map) return
    const bounds = map.getBounds()
    if (!bounds) return
    setViewBounds({
      bbox: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
      // An animated zoom can land a hair under its target (11.9999), which
      // would leave a tapped cluster unsplit, so nudge before flooring
      zoom: Math.floor(map.getZoom() + 0.01),
    })
  }, [])

  // Slide the map so a popup above this point sits fully inside it. `rise` is
  // how far above the point the popup's bottom edge sits.
  function makeRoomFor([lng, lat]: [number, number], rise: number) {
    const map = mapRef.current?.getMap()
    if (!map) return
    const { x, y } = map.project([lng, lat])
    const width = map.getContainer().clientWidth
    const half = Math.min(POPUP_WIDTH, window.innerWidth - 48) / 2 + POPUP_MARGIN
    const top = POPUP_HEIGHT + rise + POPUP_MARGIN

    let dx = 0
    if (width < half * 2) dx = x - width / 2
    else if (x < half) dx = x - half
    else if (x > width - half) dx = x - (width - half)
    const dy = y < top ? y - top : 0

    if (dx || dy) map.panBy([dx, dy], { duration: 300 })
  }

  function select(id: string | null, fromKeyboard = false) {
    const listing = id ? byId.get(id) : null
    if (listing) makeRoomFor(listing.coordinates, PIN_HEIGHT + POPUP_GAP)
    setGroup(null)
    setPopupId(id)
    setPopupFromKeyboard(fromKeyboard)
    onSelect?.(id)
  }

  // True when the cluster's homes are still together at the closest zoom
  function staysTogether(clusterId: number) {
    return index.getClusterExpansionZoom(clusterId) > MAX_ZOOM
  }

  function handleClusterClick(clusterId: number, lng: number, lat: number, fromKeyboard: boolean) {
    const pinKey = `cluster-${clusterId}`
    const wasOpen = group?.pinKey === pinKey
    select(null)

    if (!staysTogether(clusterId)) {
      mapRef.current?.flyTo({
        center: [lng, lat],
        zoom: index.getClusterExpansionZoom(clusterId),
        duration: 500,
      })
      return
    }
    if (wasOpen) return

    // Cluster bubbles are centred on their point, so the popup clears half of one
    makeRoomFor([lng, lat], PIN_HEIGHT / 2 + POPUP_GAP)
    setGroup({
      pinKey,
      ids: index.getLeaves(clusterId, Infinity).map((leaf) => leaf.properties.listingId),
      coordinates: [lng, lat],
    })
    setPopupFromKeyboard(fromKeyboard)
  }

  // A tap on the bare map closes the popup. Pins sit inside the map's own
  // canvas container, so their taps reach this handler too and are skipped.
  function handleMapClick(e: MapMouseEvent) {
    const target = e.originalEvent?.target
    if (target instanceof Element && target.closest('[data-map-pin], .maplibregl-popup')) return
    if (popupId || group) select(null)
  }

  // Closing from the keyboard hands focus back to the pin that opened the popup
  function closeToPin() {
    const pinKey = popupId ?? group?.pinKey
    if (!pinKey) return
    const pin = wrapRef.current?.querySelector<HTMLElement>(`[data-map-pin="${CSS.escape(pinKey)}"]`)
    select(null)
    pin?.focus()
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') closeToPin()
  }

  if (!MAPTILER_KEY) {
    return (
      <div
        className="w-full h-full flex items-center justify-center rounded-2xl"
        style={{ backgroundColor: '#F4F2EE', border: '1px solid #E8E1D6' }}
      >
        <div className="text-center px-6">
          <MapIcon size={32} strokeWidth={1.5} aria-hidden style={{ color: '#9C9589', margin: '0 auto 12px' }} />
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
    <div
      ref={wrapRef}
      onKeyDown={handleKeyDown}
      style={{ width: '100%', height: '100%', borderRadius: 16, overflow: 'hidden' }}
    >
      <Map
        ref={mapRef}
        {...viewState}
        onMove={(e) => setViewState(e.viewState)}
        onMoveEnd={updateBounds}
        onLoad={updateBounds}
        onClick={handleMapClick}
        style={{ width: '100%', height: '100%' }}
        mapStyle={MAP_STYLE}
        maxZoom={MAX_ZOOM}
        attributionControl={false}
      >
        <NavigationControl position="bottom-right" showCompass={false} />

        {clusters.map((feature) => {
          const [lng, lat] = feature.geometry.coordinates
          const props = feature.properties

          // ── Cluster pill ───────────────────────────────────────────
          if (props.cluster) {
            const { cluster_id, point_count } = props
            const pinKey = `cluster-${cluster_id}`
            return (
              <Marker
                key={`cluster-${cluster_id}`}
                longitude={lng}
                latitude={lat}
                anchor="center"
              >
                <ClusterMarker
                  pinKey={pinKey}
                  count={point_count}
                  lists={staysTogether(cluster_id)}
                  open={group?.pinKey === pinKey}
                  onClick={(fromKeyboard) => handleClusterClick(cluster_id, lng, lat, fromKeyboard)}
                />
              </Marker>
            )
          }

          // ── Individual price marker ────────────────────────────────
          const { listingId } = props
          const listing = byId.get(listingId)
          if (!listing) return null

          const open   = popupId === listingId
          const active = open || hoveredId === listingId || highlightId === listingId

          return (
            <Marker
              key={`marker-${listingId}`}
              longitude={lng}
              latitude={lat}
              anchor="bottom"
              style={{ zIndex: active ? 2 : 1 }}
            >
              <PriceMarker
                listing={listing}
                active={active}
                open={open}
                onClick={(fromKeyboard) => select(open ? null : listingId, fromKeyboard)}
                onHover={(hovering) => setHoveredId(hovering ? listingId : null)}
              />
            </Marker>
          )
        })}

        {/* Popup: keyed by listing so each one opens fresh */}
        {popupListing && (
          <Popup
            key={popupListing.id}
            longitude={popupListing.coordinates[0]}
            latitude={popupListing.coordinates[1]}
            anchor="bottom"
            offset={[0, -(PIN_HEIGHT + POPUP_GAP)]}
            closeButton={false}
            closeOnClick={false}
            focusAfterOpen={false}
            className="map-popup"
            maxWidth="none"
          >
            <PopupCard
              listing={popupListing}
              href={`/listings/${popupListing.id}${listingQuery}`}
              takeFocus={popupFromKeyboard}
              onClose={(fromKeyboard) => (fromKeyboard ? closeToPin() : select(null))}
            />
          </Popup>
        )}

        {/* List popup for homes that cannot be zoomed apart */}
        {group && groupListings.length > 0 && (
          <Popup
            key={group.pinKey}
            longitude={group.coordinates[0]}
            latitude={group.coordinates[1]}
            anchor="bottom"
            offset={[0, -(PIN_HEIGHT / 2 + POPUP_GAP)]}
            closeButton={false}
            closeOnClick={false}
            focusAfterOpen={false}
            className="map-popup"
            maxWidth="none"
          >
            <GroupCard
              listings={groupListings}
              hrefFor={(id) => `/listings/${id}${listingQuery}`}
              takeFocus={popupFromKeyboard}
              onClose={(fromKeyboard) => (fromKeyboard ? closeToPin() : select(null))}
            />
          </Popup>
        )}
      </Map>
    </div>
  )
}
