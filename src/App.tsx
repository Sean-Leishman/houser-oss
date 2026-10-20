import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, Crosshair, Info, MapPin, Pencil, RefreshCw, X } from 'lucide-react'
import { accessForListings, chainColor, dailyKinds, indexTransit, nearLine, shownPlaces, type PlaceChoices } from './access'
import { fetchChains, fetchCoverage, fetchLines, fetchListings, fetchParks, fetchPois, fetchReach, fetchRoute, fetchTrips, placeAt } from './api'
import { distanceKm, estimateMinutes, inBounds, loadedArea, walkingMinutes } from './geo'
import { altModes, kindLabels, modeLabels, modeVerbs, money, timeAgo } from './format'
import { REACH_OPTIONS, placeCategories, transitModes, type PlaceCategory, type ReachMinutes } from './layers'
import LayerLegend from './LayerLegend'
import LineBadge from './LineBadge'
import ListingCard, { modeIcons, placeIcons } from './ListingCard'
import ListingDetail from './ListingDetail'
import { mergeNetwork } from './network'
import PlaceSearch from './PlaceSearch'
import Popover from './Popover'
import { savedStatuses, useSavedHomes, useStoredState, type SavedStatus } from './storage'
import type { Coordinates, DailyPlace, HousingSource, LineSet, Listing, ListingKind, ParkPolygon, Place, Poi, ReachArea, Route, TransitMode, TravelMode, Trip } from './types'

const mapModule = import('./MapView')
const MapView = lazy(() => mapModule)
const noLines: LineSet = { features: [], stops: [] }

const ZURICH: Place = { id: 'default-zurich', name: 'Zürich', detail: 'Zurich, Switzerland', coordinates: [8.5417, 47.3769], city: 'Zürich', countryCode: 'CH' }
const travelModes: TravelMode[] = ['walk', 'bike', 'quiet', 'transit', 'car']
const listingKinds: ListingKind[] = ['room', 'studio', 'apartment', 'house']
type Sort = 'trip' | 'rent' | 'size' | 'rail'
const sorts: { id: Sort, label: string }[] = [{ id: 'trip', label: 'Shortest trip' }, { id: 'rent', label: 'Lowest rent' }, { id: 'size', label: 'Most space' }, { id: 'rail', label: 'Nearest rail' }]
const BUDGET_MIN = 500
const BUDGET_MAX = 6000
const BUDGET_STEP = 100
const PAGE_SIZE = 50
type Sheet = 'peek' | 'half' | 'full'

interface Housing { state: 'loading' | 'ready' | 'error', listings: Listing[], sources: HousingSource[], updatedAt: number | null, message: string, currency: string }
const emptyHousing: Housing = { state: 'loading', listings: [], sources: [], updatedAt: null, message: '', currency: 'CHF' }

const isPoint = (value: unknown) => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite)
const isPlace = (value: unknown) => Boolean(value) && typeof value === 'object' && isPoint((value as Place).coordinates) && typeof (value as Place).name === 'string'
const isList = <T,>(options: readonly T[]) => (value: unknown) => Array.isArray(value) && value.every((item) => options.includes(item as T))
const oneOf = <T,>(options: readonly T[]) => (value: unknown) => options.includes(value as T)
const defaultChoices: PlaceChoices = { supermarket: { hidden: [], walk: false }, gym: { hidden: [], walk: false } }
const isChoices = (value: unknown) => Boolean(value) && typeof value === 'object' && dailyKinds.every((kind) => {
  const choice = (value as PlaceChoices)[kind]
  return Boolean(choice) && typeof choice.walk === 'boolean' && Array.isArray(choice.hidden) && choice.hidden.every((chain) => typeof chain === 'string')
})

function useMedia(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const update = () => setMatches(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [query])
  return matches
}

export default function App() {
  const [city, setCity] = useStoredState<Place>('houser.city', ZURICH, isPlace)
  const [anchor, setAnchor] = useStoredState<Place | null>('houser.anchor', null, (value) => value === null || (isPlace(value) && distanceKm((value as Place).coordinates, city.coordinates) <= 60))
  const [mode, setMode] = useStoredState<TravelMode>('houser.mode', 'bike', oneOf(travelModes))
  const [minutes, setMinutes] = useStoredState<ReachMinutes>('houser.minutes', 30, oneOf(REACH_OPTIONS))
  const [budget, setBudget] = useStoredState<number | null>('houser.budget', null, (value) => value === null || (typeof value === 'number' && value > 0))
  const [minRooms, setMinRooms] = useStoredState('houser.rooms', 0, oneOf([0, 2, 3, 4]))
  const [kinds, setKinds] = useStoredState<ListingKind[]>('houser.kinds', [], isList(listingKinds))
  const [sort, setSort] = useStoredState<Sort>('houser.sort', 'trip', oneOf(sorts.map((item) => item.id)))
  const [lineModes, setLineModes] = useStoredState<TransitMode[]>('houser.lines.v2', ['train', 'metro', 'tram'], isList(transitModes.map((item) => item.id)))
  const [places, setPlaces] = useStoredState<PlaceCategory[]>('houser.places.v2', ['parks'], isList(placeCategories.map((item) => item.id)))
  const [placeChoices, setPlaceChoices] = useStoredState<PlaceChoices>('houser.chains', defaultChoices, isChoices)

  const [housing, setHousing] = useState<Housing>(emptyHousing)
  const [coverage, setCoverage] = useState<string[]>([])
  const [rail, setRail] = useState<LineSet | null>(null)
  const [bus, setBus] = useState<LineSet | null>(null)
  const [chains, setChains] = useState<DailyPlace[] | null>(null)
  const [pois, setPois] = useState<Poi[] | null>(null)
  const [parks, setParks] = useState<ParkPolygon[] | null>(null)
  const [shownCount, setShownCount] = useState(PAGE_SIZE)
  const [transitState, setTransitState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [trips, setTrips] = useState<Record<string, Trip>>({})
  const [tripsLoading, setTripsLoading] = useState(false)
  const [reach, setReach] = useState<ReachArea | null>(null)
  const [route, setRoute] = useState<Route | null>(null)
  const [altRoute, setAltRoute] = useState<Route | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [lineFilter, setLineFilter] = useState<number | null>(null)
  const [tab, setTab] = useState<'homes' | 'saved'>('homes')
  const [savedFilter, setSavedFilter] = useState<SavedStatus | 'all'>('all')
  const [picking, setPicking] = useState(false)
  const [editingAnchor, setEditingAnchor] = useState(false)
  const [sheet, setSheet] = useState<Sheet>('half')
  const { saved, toggle: toggleSaved, update: updateSaved, adoptLegacy } = useSavedHomes()
  const isMobile = useMedia('(max-width: 760px)')
  const dark = useMedia('(prefers-color-scheme: dark)')
  const housingRequest = useRef(0)
  const listScroll = useRef(0)
  const scroller = useRef<HTMLDivElement>(null)

  const loadHousing = useCallback((signal?: AbortSignal) => {
    const request = ++housingRequest.current
    setHousing(emptyHousing)
    fetchListings(city, signal ?? new AbortController().signal).then((data) => {
      if (request !== housingRequest.current) return
      const currency = data.currency ?? 'CHF'
      if (data.mode === 'live') setHousing({ state: 'ready', listings: data.listings ?? [], sources: data.sources ?? [], updatedAt: data.updatedAt ?? null, message: data.reason ?? '', currency })
      else setHousing({ state: 'error', listings: [], sources: data.sources ?? [], updatedAt: null, message: data.reason || 'Homes are unavailable right now.', currency })
    }).catch((error: unknown) => {
      if (request !== housingRequest.current || signal?.aborted) return
      setHousing((current) => ({ ...current, state: 'error', message: error instanceof Error ? error.message : 'Housing sources are unavailable right now.' }))
    })
  }, [city])

  useEffect(() => {
    const controller = new AbortController()
    fetchCoverage(controller.signal).then((data) => setCoverage(data.countries)).catch(() => {})
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    loadHousing(controller.signal)
    setShownCount(PAGE_SIZE)
    return () => controller.abort()
  }, [loadHousing])

  useEffect(() => { if (housing.listings.length) adoptLegacy(housing.listings) }, [housing.listings, adoptLegacy])

  const cityKey = city.coordinates.join(',')
  useEffect(() => {
    const controller = new AbortController()
    setRail(null)
    setBus(null)
    setChains(null)
    setPois(null)
    setParks(null)
    setTransitState('loading')
    fetchLines('rail', city.coordinates, controller.signal).then((data) => { setRail(data); setTransitState('ready') })
      .catch(() => { if (!controller.signal.aborted) setTransitState('error') })
    fetchChains(city.coordinates, controller.signal).then(setChains).catch(() => {})
    return () => controller.abort()
  }, [cityKey])

  const needBus = lineModes.includes('bus')
  useEffect(() => {
    if (!needBus || bus) return
    const controller = new AbortController()
    fetchLines('bus', city.coordinates, controller.signal).then(setBus).catch(() => {})
    return () => controller.abort()
  }, [cityKey, needBus, bus === null])

  const needPois = places.some((category) => category !== 'parks')
  useEffect(() => {
    if (!needPois || pois) return
    const controller = new AbortController()
    fetchPois(city.coordinates, controller.signal).then(setPois).catch(() => {})
    return () => controller.abort()
  }, [cityKey, needPois, pois === null])

  const showParks = places.includes('parks')
  useEffect(() => {
    if (!showParks || parks) return
    const controller = new AbortController()
    fetchParks(city.coordinates, controller.signal).then(setParks).catch(() => {})
    return () => controller.abort()
  }, [cityKey, showParks, parks === null])

  const transit = useMemo(() => rail || chains ? mergeNetwork(rail ?? noLines, bus, chains, pois) : null, [rail, bus, chains, pois])

  const anchorKey = anchor ? anchor.coordinates.map((value) => value.toFixed(4)).join(',') : ''
  const listingsKey = useMemo(() => housing.listings.map((listing) => listing.id).join('|'), [housing.listings])

  useEffect(() => {
    setTrips({})
    setTripsLoading(false)
    if (!anchor || mode === 'transit' || !housing.listings.length) return
    const controller = new AbortController()
    const list = [...housing.listings].sort((a, b) => distanceKm(a.coordinates, anchor.coordinates) - distanceKm(b.coordinates, anchor.coordinates)).slice(0, 500)
    const timer = setTimeout(() => {
      setTripsLoading(true)
      fetchTrips(mode, anchor.coordinates, list.map((listing) => listing.coordinates), controller.signal).then(({ durations, distances }) => {
        const next: Record<string, Trip> = {}
        list.forEach((listing, index) => {
          const seconds = durations[index]
          if (seconds != null) next[listing.id] = { minutes: Math.max(1, Math.round(seconds / 60)), km: distances[index], routed: true }
        })
        setTrips(next)
      }).catch(() => {}).finally(() => { if (!controller.signal.aborted) setTripsLoading(false) })
    }, 200)
    return () => { clearTimeout(timer); controller.abort() }
  }, [anchorKey, mode, listingsKey])

  useEffect(() => {
    setReach(null)
    if (!anchor || mode === 'transit') return
    const controller = new AbortController()
    fetchReach(mode, anchor.coordinates, controller.signal).then(setReach).catch(() => {})
    return () => controller.abort()
  }, [anchorKey, mode])

  const selected = useMemo(() => housing.listings.find((listing) => listing.id === selectedId) ?? (selectedId ? saved[selectedId]?.listing : undefined) ?? null, [housing.listings, selectedId, saved])

  useEffect(() => {
    setRoute(null)
    setAltRoute(null)
    if (!selected || !anchor || mode === 'transit') return
    const controller = new AbortController()
    fetchRoute(mode, selected.coordinates, anchor.coordinates, controller.signal).then(setRoute).catch(() => {})
    // A bike trip shows the other bike setting too, so fast and quiet can be compared on one card.
    const other = altModes[mode]
    if (other) fetchRoute(other, selected.coordinates, anchor.coordinates, controller.signal).then(setAltRoute).catch(() => {})
    return () => controller.abort()
  }, [selected?.id, anchorKey, mode])

  const accessIndex = useMemo(() => transit ? indexTransit(transit) : null, [transit])
  const access = useMemo(() => accessForListings(housing.listings, accessIndex, placeChoices), [housing.listings, accessIndex, placeChoices])
  const dailyPlaces = useMemo(() => accessIndex ? shownPlaces(accessIndex, placeChoices) : [], [accessIndex, placeChoices])
  const walkLimits = dailyKinds.filter((kind) => placeChoices[kind].walk)
  const walkLimited = walkLimits.length > 0
  const tripOf = useCallback((listing: Listing): Trip | null => !anchor || distanceKm(listing.coordinates, anchor.coordinates) > 80 ? null
    : trips[listing.id] ?? { minutes: estimateMinutes(listing.coordinates, anchor.coordinates, mode), routed: false }, [anchor, trips, mode])

  const area = useMemo(() => loadedArea(city.coordinates), [city.coordinates[0], city.coordinates[1]])
  const matching = useMemo(() => housing.listings.filter((listing) =>
    inBounds(listing.coordinates, area) &&
    (budget == null || listing.price <= budget) &&
    (!minRooms || (listing.kind !== 'room' && (listing.rooms ?? (listing.bedrooms != null ? listing.bedrooms + 1 : minRooms)) >= minRooms)) &&
    (!kinds.length || (listing.kind != null && kinds.includes(listing.kind))) &&
    (lineFilter == null || !accessIndex || nearLine(listing.coordinates, lineFilter, accessIndex)) &&
    (!accessIndex || walkLimits.every((kind) => {
      const place = access.get(listing.id)?.nearest[kind]
      return Boolean(place && walkingMinutes(place.km) <= 10)
    }))), [housing.listings, area, budget, minRooms, kinds, lineFilter, accessIndex, access, walkLimits.join()])
  const reachCounts = useMemo(() => REACH_OPTIONS.map((limit) => matching.filter((listing) => (tripOf(listing)?.minutes ?? Infinity) <= limit).length), [matching, tripOf])
  const visible = useMemo(() => {
    const shown = anchor ? matching.filter((listing) => (tripOf(listing)?.minutes ?? Infinity) <= minutes) : matching
    const value = (listing: Listing) => {
      switch (sort === 'trip' && !anchor ? 'rent' : sort) {
        case 'trip': return tripOf(listing)?.minutes ?? Infinity
        case 'size': return -(listing.areaM2 ?? -Infinity)
        case 'rail': return access.get(listing.id)?.railKm ?? Infinity
        default: return listing.price
      }
    }
    return [...shown].sort((a, b) => value(a) - value(b) || a.price - b.price)
  }, [matching, anchor, tripOf, minutes, sort, access])

  const savedIds = useMemo(() => new Set(Object.keys(saved)), [saved])
  const savedList = useMemo(() => Object.values(saved).sort((a, b) => b.savedAt - a.savedAt), [saved])
  const savedListings = useMemo(() => savedList.map((entry) => entry.listing), [savedList])
  const lineFilterLine = lineFilter == null ? null : transit?.features[lineFilter]?.properties ?? null
  const lineCounts = useMemo(() => {
    const counts: Record<TransitMode, number | null> = { train: 0, metro: 0, tram: 0, bus: 0 }
    const seen = new Set<string>()
    for (const feature of transit?.features ?? []) {
      const key = `${feature.properties.mode}:${feature.properties.code}`
      if (!seen.has(key)) { seen.add(key); counts[feature.properties.mode]!++ }
    }
    if (rail?.busLines != null) counts.bus = rail.busLines
    else if (!bus) counts.bus = null
    return counts
  }, [transit, bus, rail])

  const chooseCity = (place: Place) => {
    setCity({ ...place, city: place.city || place.name })
    setSelectedId(null)
    setLineFilter(null)
    setPicking(false)
    if (anchor && distanceKm(anchor.coordinates, place.coordinates) > 60) setAnchor(null)
  }

  const naming = useRef<AbortController | null>(null)
  const nameAnchor = (at: Coordinates) => {
    setAnchor({ id: `pin:${at.join(',')}`, name: 'Pinned place', detail: '', coordinates: at })
    naming.current?.abort()
    const controller = new AbortController()
    naming.current = controller
    placeAt(at, controller.signal).then((place) => {
      if (place) setAnchor((current) => current && current.coordinates[0] === at[0] && current.coordinates[1] === at[1] ? { ...place, id: `pin:${at.join(',')}` } : current)
    }).catch(() => {})
  }

  const selectListing = useCallback((id: string) => {
    if (!selectedId) listScroll.current = scroller.current?.scrollTop ?? 0
    setSelectedId(id)
    setPicking(false)
    if (isMobile) setSheet('half')
    requestAnimationFrame(() => scroller.current?.scrollTo({ top: 0 }))
  }, [selectedId, isMobile])

  const closeDetail = () => {
    setSelectedId(null)
    requestAnimationFrame(() => scroller.current?.scrollTo({ top: listScroll.current }))
  }

  useEffect(() => {
    if (!picking) return
    const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape') setPicking(false) }
    window.addEventListener('keydown', cancel)
    return () => window.removeEventListener('keydown', cancel)
  }, [picking])

  const toggleIn = <T,>(list: T[], item: T) => list.includes(item) ? list.filter((value) => value !== item) : [...list, item]
  const sheetHeight = { peek: 148, half: Math.round(window.innerHeight * .52), full: Math.round(window.innerHeight * .9) }[sheet]
  const filtersActive = budget != null || minRooms > 0 || kinds.length > 0 || lineFilter != null || walkLimited
  const dropWalkLimits = () => setPlaceChoices({ supermarket: { ...placeChoices.supermarket, walk: false }, gym: { ...placeChoices.gym, walk: false } })
  const ModeIcon = modeIcons[mode]

  const quickFixes: { label: string, action: () => void }[] = []
  if (anchor && minutes < 60) quickFixes.push({ label: `Allow ${REACH_OPTIONS[REACH_OPTIONS.indexOf(minutes) + 1]} min`, action: () => setMinutes(REACH_OPTIONS[REACH_OPTIONS.indexOf(minutes) + 1]) })
  if (budget != null) quickFixes.push({ label: budget + 500 >= BUDGET_MAX ? 'Any rent' : `Up to ${money(budget + 500, housing.currency)}`, action: () => setBudget(budget + 500 >= BUDGET_MAX ? null : budget + 500) })
  if (kinds.length || minRooms) quickFixes.push({ label: 'Any type or size', action: () => { setKinds([]); setMinRooms(0) } })
  if (lineFilter != null) quickFixes.push({ label: 'Any line', action: () => setLineFilter(null) })
  if (walkLimited) quickFixes.push({ label: 'Drop the 10-min walk limit', action: dropWalkLimits })

  const homeList = () => {
    if (housing.state === 'loading' && !housing.listings.length) return <div className="card-skeletons" aria-label="Loading homes">{[0, 1, 2].map((item) => <div key={item} className="card-skeleton" />)}</div>
    if (!housing.listings.length) return <div className="empty">
      <p><strong>{housing.state === 'error' ? 'Couldn’t load homes.' : `No homes found around ${city.name} yet.`}</strong></p>
      <p className="muted">{housing.state === 'error' ? housing.message : 'No stored homes here. You can still explore lines and places, or search the source directly:'}</p>
      <div className="empty-actions">
        {housing.state === 'error' && <button type="button" className="button" onClick={() => loadHousing()}><RefreshCw size={15} aria-hidden /> Try again</button>}
        {housing.sources.filter((source) => source.url).map((source) => <a key={source.name} className="button" href={source.url} target="_blank" rel="noreferrer">{source.name} <ArrowUpRight size={15} aria-hidden /></a>)}
      </div>
    </div>
    if (!visible.length) return <div className="empty">
      <p><strong>No homes match{anchor ? ` within ${minutes} min ${modeVerbs[mode]}` : ''}.</strong></p>
      {quickFixes.length > 0 && <div className="empty-actions">{quickFixes.map((fix) => <button key={fix.label} type="button" className="button" onClick={fix.action}>{fix.label}</button>)}</div>}
    </div>
    const rest = visible.length - shownCount
    return <div className="cards">
      {visible.slice(0, shownCount).map((listing) => <ListingCard key={listing.id} listing={listing} trip={tripOf(listing)} mode={mode} access={access.get(listing.id)} lineModes={lineModes}
        saved={savedIds.has(listing.id)} status={saved[listing.id]?.status} selected={listing.id === selectedId} hovered={listing.id === hoverId}
        onSelect={selectListing} onHover={setHoverId} onToggleSave={toggleSaved} />)}
      {rest > 0 && <button type="button" className="button more" onClick={() => setShownCount(shownCount + PAGE_SIZE)}>Show {Math.min(PAGE_SIZE, rest)} more <small>of {rest.toLocaleString('en')}</small></button>}
    </div>
  }

  const savedHomes = () => {
    if (!savedList.length) return <div className="empty"><p><strong>Nothing saved yet.</strong></p><p className="muted">Tap the heart on a home to keep it here, with notes and where you are with it. Saved homes stay on this device.</p></div>
    const shown = savedList.filter((entry) => savedFilter === 'all' || entry.status === savedFilter)
    return <>
      <div className="chip-row saved-filter">
        <button type="button" className={`chip ${savedFilter === 'all' ? 'on' : ''}`} onClick={() => setSavedFilter('all')}>All <small>{savedList.length}</small></button>
        {savedStatuses.map((option) => { const count = savedList.filter((entry) => entry.status === option.id).length
          return count ? <button key={option.id} type="button" className={`chip ${savedFilter === option.id ? 'on' : ''}`} onClick={() => setSavedFilter(option.id)}>{option.label} <small>{count}</small></button> : null })}
      </div>
      <div className="cards">{shown.map(({ listing, status }) => <ListingCard key={listing.id} listing={listing} trip={tripOf(listing)} mode={mode} access={access.get(listing.id)} lineModes={lineModes}
        saved status={status} selected={listing.id === selectedId} hovered={listing.id === hoverId} onSelect={selectListing} onHover={setHoverId} onToggleSave={toggleSaved} />)}</div>
    </>
  }

  const sourceSummary = housing.sources.map((source) => {
    const text = source.status === 'unavailable' ? 'unavailable'
      : source.total && source.total > source.count ? `${source.count} of ${source.total.toLocaleString('en')}` : source.count.toLocaleString('en')
    return <a key={source.name} href={source.url} target="_blank" rel="noreferrer" title={`Open ${source.name}`}>{source.name} {text}</a>
  })

  return <div className={`app ${isMobile ? `mobile sheet-${sheet}` : ''}`} style={isMobile ? { ['--sheet' as string]: `${sheetHeight}px` } : undefined}>
    <aside className="panel" aria-label="Homes">
      {isMobile && <button type="button" className="sheet-handle" aria-label={sheet === 'full' ? 'Show more map' : 'Show more list'} onClick={() => setSheet(sheet === 'peek' ? 'half' : sheet === 'half' ? 'full' : 'peek')}><span /></button>}
      <header className="panel-head">
        <span className="wordmark">houser</span>
        <PlaceSearch label="Search for a city" placeholder={`${city.name} · change city`} cities countries={coverage} onPick={chooseCity} />
      </header>

      <div className="panel-scroll" ref={scroller}>
        {selected ? <ListingDetail busShown={needBus} listing={selected} trip={tripOf(selected)} route={route} altRoute={altRoute} mode={mode} anchor={anchor} accessIndex={accessIndex} choices={placeChoices}
          saved={saved[selected.id]} onBack={closeDetail} onToggleSave={toggleSaved} onUpdateSaved={updateSaved} />
          : <>
            <section className="trip" aria-labelledby="trip-title">
              <h2 id="trip-title" className="section-title">Where do you go every day?</h2>
              {anchor && !editingAnchor
                ? <div className="anchor-row">
                  <MapPin size={18} aria-hidden />
                  <span className="anchor-text"><strong>{anchor.name}</strong>{anchor.detail && <small>{anchor.detail}</small>}</span>
                  <button type="button" className="icon-button" aria-label="Change place" onClick={() => setEditingAnchor(true)}><Pencil size={16} aria-hidden /></button>
                  <button type="button" className="icon-button" aria-label="Remove place" onClick={() => setAnchor(null)}><X size={16} aria-hidden /></button>
                </div>
                : <div className="anchor-edit">
                  <PlaceSearch label="Work, school or another daily place" placeholder="Work, school, a friend…" near={city.coordinates} autoFocus={editingAnchor}
                    onPick={(place) => { setAnchor(place); setEditingAnchor(false) }} onCancel={() => setEditingAnchor(false)} />
                  <button type="button" className={`button subtle ${picking ? 'on' : ''}`} onClick={() => { setPicking(!picking); setEditingAnchor(false) }}><Crosshair size={16} aria-hidden /> Pick on map</button>
                </div>}
              <div className="segmented" role="radiogroup" aria-label="How you travel">
                {travelModes.map((item) => { const Icon = modeIcons[item]
                  return <button key={item} type="button" role="radio" aria-checked={mode === item} className={mode === item ? 'on' : ''} onClick={() => setMode(item)}><Icon size={17} aria-hidden />{modeLabels[item]}</button> })}
              </div>
              <div className="segmented minutes" role="radiogroup" aria-label="Longest trip">
                {REACH_OPTIONS.map((option, index) => <button key={option} type="button" role="radio" aria-checked={minutes === option} className={minutes === option ? 'on' : ''} onClick={() => setMinutes(option)} disabled={!anchor}>
                  {option} min{anchor && housing.listings.length > 0 && <small>{reachCounts[index]} homes</small>}
                </button>)}
              </div>
              {anchor && <p className="hint">
                {mode === 'transit' ? <><Info size={14} aria-hidden /> Transit times are rough estimates from distance.</>
                  : <><span className="reach-swatch" aria-hidden /> Faded areas are more than {minutes} min away{tripsLoading ? ' · routing…' : ''}</>}
              </p>}
            </section>

            <div className="filters">
              <Popover label={budget == null ? 'Any rent' : `Up to ${money(budget, housing.currency)}`} active={budget != null}>
                <label className="range"><span>Monthly rent up to <strong>{budget == null ? 'any' : money(budget, housing.currency)}</strong></span>
                  <input type="range" min={BUDGET_MIN} max={BUDGET_MAX} step={BUDGET_STEP} value={budget ?? BUDGET_MAX} onChange={(event) => setBudget(Number(event.target.value) >= BUDGET_MAX ? null : Number(event.target.value))} />
                </label>
              </Popover>
              <Popover label={minRooms ? `${minRooms}+ rooms` : 'Rooms'} active={minRooms > 0}>
                <div className="chip-row">{[0, 2, 3, 4].map((count) => <button key={count} type="button" className={`chip ${minRooms === count ? 'on' : ''}`} onClick={() => setMinRooms(count)}>{count ? `${count}+` : 'Any'}</button>)}</div>
                <p className="popover-note">Swiss counts include the living room: 3½ rooms usually means two bedrooms.</p>
              </Popover>
              <Popover label={kinds.length ? kinds.map((kind) => kindLabels[kind]).join(', ') : 'Any type'} active={kinds.length > 0}>
                <div className="check-list">{listingKinds.map((kind) => <label key={kind}><input type="checkbox" checked={kinds.includes(kind)} onChange={() => setKinds(toggleIn(kinds, kind))} />{kindLabels[kind]}</label>)}</div>
              </Popover>
              {lineFilterLine && <button type="button" className="pill on" onClick={() => setLineFilter(null)} aria-label="Stop filtering by line">Near <LineBadge line={lineFilterLine} /><X size={14} aria-hidden /></button>}
              {walkLimits.map((kind) => {
                const Icon = placeIcons[kind]
                return <button key={kind} type="button" className="pill on" aria-label="Drop this walking limit" onClick={() => setPlaceChoices({ ...placeChoices, [kind]: { ...placeChoices[kind], walk: false } })}>
                  <Icon size={15} aria-hidden />10 min to a {kind}<X size={14} aria-hidden />
                </button>
              })}
              {filtersActive && <button type="button" className="link-button" onClick={() => { setBudget(null); setMinRooms(0); setKinds([]); setLineFilter(null); dropWalkLimits() }}>Clear</button>}
            </div>

            <div className="list-head">
              <div className="tabs" role="tablist">
                <button type="button" role="tab" aria-selected={tab === 'homes'} onClick={() => setTab('homes')}>Homes <small>{housing.state === 'loading' && !housing.listings.length ? '…' : visible.length}</small></button>
                <button type="button" role="tab" aria-selected={tab === 'saved'} onClick={() => setTab('saved')}>Saved <small>{savedList.length}</small></button>
              </div>
              {tab === 'homes' && housing.listings.length > 0 && <label className="sort"><span className="visually-hidden">Sort homes</span>
                <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>{sorts.map((item) => <option key={item.id} value={item.id} disabled={item.id === 'trip' && !anchor}>{item.label}</option>)}</select>
              </label>}
            </div>
            {tab === 'homes' ? homeList() : savedHomes()}
          </>}
      </div>

      <footer className="panel-foot">
        <span className="sources">
          {housing.state === 'loading' ? `Looking for homes around ${city.name}…` : <>{sourceSummary.length ? sourceSummary : 'No housing sources'}{housing.updatedAt ? <span className="muted"> · stored {timeAgo(housing.updatedAt)}</span> : null}</>}
        </span>
        <Popover label={<><Info size={15} aria-hidden /><span className="visually-hidden">About the data</span></>}>
          <div className="about">
            <p>Homes are a stored copy of the source listed here, taken at the time shown, so some may be gone. Prices, availability and exact location are the advertiser’s to confirm.</p>
            <p><ModeIcon size={14} aria-hidden /> Walk, bike and car times and the highlighted area are routed on OpenStreetMap roads with Valhalla (FOSSGIS). Transit times are distance estimates.</p>
            <p>Lines, stops, places and parks: OpenStreetMap contributors. Map: OpenFreeMap. Open data has no price levels for chains, so none are shown.</p>
          </div>
        </Popover>
      </footer>
    </aside>

    <main className="map-wrap">
      <Suspense fallback={<div className="map" />}>
        <MapView theme={dark ? 'dark' : 'light'} city={city} listings={tab === 'saved' ? savedListings : visible} savedIds={savedIds}
          selected={selected} hoverId={hoverId} anchor={anchor} reach={reach} minutes={minutes} route={route} altRoute={altRoute} transit={transit} dailyPlaces={dailyPlaces}
          parks={parks} lineModes={lineModes} places={places} lineFilter={lineFilter} picking={picking} bottomInset={isMobile ? sheetHeight : 0}
          onSelect={selectListing} onHover={setHoverId} onPick={(at) => { nameAnchor(at); setPicking(false) }} onAnchorMove={nameAnchor}
          onLineFilter={(index) => { setLineFilter(index); setTab('homes'); setSelectedId(null) }} />
      </Suspense>
      <LayerLegend lineModes={lineModes} places={places} lineCounts={lineCounts} transitState={transitState} collapsed={isMobile}
        chains={accessIndex?.chains ?? { supermarket: [], gym: [] }} chainColor={(kind, chain) => accessIndex ? chainColor(accessIndex, kind, chain) : '#888'} choices={placeChoices}
        onToggleMode={(item) => setLineModes(toggleIn(lineModes, item))} onTogglePlace={(item) => setPlaces(toggleIn(places, item))}
        onChoose={(kind, choice) => setPlaceChoices({ ...placeChoices, [kind]: choice })} />
      {picking && <div className="pick-banner" role="status"><Crosshair size={16} aria-hidden /> Click the map where you go every day <button type="button" className="link-button" onClick={() => setPicking(false)}>Cancel</button></div>}
    </main>
  </div>
}
