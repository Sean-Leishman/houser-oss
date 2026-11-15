import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowUpRight, Carrot, Heart, Star, Trash2 } from 'lucide-react'
import { fetchGyms, type RatedGym } from './api'
import { dailyKinds, foodNear, nearbyStops, nearestChains, OTHER_CHAIN, type AccessIndex, type PlaceChoices } from './access'
import { distanceKm, formatDistance, walkingMinutes } from './geo'
import { altModes, availability, homeRooms, kindLabels, modeLabels, money, modeVerbs, routeFacts, roomsLabel, timeAgo } from './format'
import LineBadge from './LineBadge'
import { modeIcons, placeIcons } from './ListingCard'
import { savedStatuses, type SavedHome, type SavedStatus } from './storage'
import type { JourneySlot, Listing, Place, Route, TravelMode, Trip } from './types'

interface Props {
  busShown: boolean
  listing: Listing
  trip: Trip | null
  route: Route | null
  altRoute: Route | null
  journeys: JourneySlot[] | null
  mode: TravelMode
  anchor: Place | null
  accessIndex: AccessIndex | null
  choices: PlaceChoices
  saved?: SavedHome
  onBack: () => void
  onRemove?: () => void
  onToggleSave: (listing: Listing) => void
  onUpdateSaved: (id: string, change: { status?: SavedStatus, note?: string }) => void
}

const foodLabels: Record<string, [string, string]> = {
  greengrocer: ['greengrocer', 'greengrocers'], butcher: ['butcher', 'butchers'], bakery: ['bakery', 'bakeries'], pastry: ['patisserie', 'patisseries'],
  deli: ['deli', 'delis'], cheese: ['cheese shop', 'cheese shops'], seafood: ['fishmonger', 'fishmongers'], marketplace: ['market', 'markets'],
}

export default function ListingDetail({ busShown, listing, trip, route, altRoute, journeys, mode, anchor, accessIndex, choices, saved, onBack, onRemove, onToggleSave, onUpdateSaved }: Props) {
  const ModeIcon = modeIcons[mode]
  const stops = accessIndex ? nearbyStops(listing.coordinates, accessIndex) : []
  const daily = !accessIndex ? [] : dailyKinds.flatMap((kind) =>
    nearestChains(listing.coordinates, accessIndex, kind, choices[kind].hidden).map((place) => ({ kind, place })))
  const food = accessIndex ? foodNear(listing.coordinates, accessIndex) : []
  const [gyms, setGyms] = useState<RatedGym[] | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    setGyms(null)
    // Only answers when the server has a GOOGLE_MAPS_KEY; otherwise the section stays hidden.
    fetchGyms(listing.coordinates, controller.signal).then((data) => setGyms(data.gyms)).catch(() => {})
    return () => controller.abort()
  }, [listing.id])
  // In transit mode the TfL 08:30 journey is the real door-to-door time.
  const planned = mode === 'transit' ? journeys?.find((slot) => slot.id === 'morning')?.journey : null
  const minutes = planned ? planned.door : route ? Math.round(route.duration / 60) : trip?.minutes
  const routed = Boolean(planned) || Boolean(route) || Boolean(trip?.routed)
  const facts: [string, string][] = [
    ['Type', listing.kind ? kindLabels[listing.kind] : ''],
    ['Rooms', homeRooms(listing) ? roomsLabel(homeRooms(listing)!) : ''],
    ['Size', listing.areaM2 ? `${listing.areaM2} m²` : ''],
    ['Bedrooms', listing.bedrooms && listing.kind !== 'room' && listing.kind !== 'studio' ? `${listing.bedrooms}${listing.bedroomsEstimated ? ' (from room count)' : ''}` : ''],
    ['Furnished', listing.furnished == null ? '' : listing.furnished ? 'Yes' : 'No'],
    ['Available', availability(listing.availableFrom) ?? ''],
  ]
  const known = facts.filter(([, value]) => value)

  return <div className="detail">
    <button type="button" className="back-button" onClick={onBack}><ArrowLeft size={16} aria-hidden /> All homes</button>
    {listing.image && <img className="detail-photo" src={listing.image} alt="" />}
    <div className="detail-head">
      <div className="detail-price">{listing.priceConverted ? '≈ ' : ''}{money(listing.price, listing.currency)}<small> per month</small></div>
      {listing.priceConverted && listing.originalPrice != null && listing.originalCurrency && <div className="muted">Listed as {money(listing.originalPrice, listing.originalCurrency)}</div>}
      <h2>{listing.title}</h2>
      <p className="muted">{listing.address}</p>
    </div>

    <div className="detail-actions">
      {listing.sourceUrl && <a className="button primary" href={listing.sourceUrl} target="_blank" rel="noreferrer">{listing.id.startsWith('mine:') ? 'Open listing' : `View on ${listing.source}`} <ArrowUpRight size={16} aria-hidden /></a>}
      <button type="button" className={`button ${saved ? 'saved' : ''}`} aria-pressed={Boolean(saved)} onClick={() => onToggleSave(listing)}><Heart size={16} aria-hidden /> {saved ? 'Saved' : 'Save'}</button>
      {onRemove && <button type="button" className="button subtle" onClick={() => { if (window.confirm('Remove this home you added?')) onRemove() }}><Trash2 size={16} aria-hidden /> Remove</button>}
    </div>

    {known.length > 0 && <dl className="facts">{known.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}

    <section className="detail-section">
      <h3>Your trip</h3>
      {anchor && minutes != null
        ? <p className="trip-line"><ModeIcon size={18} aria-hidden /><span><strong>{routed ? '' : '≈ '}{minutes} min</strong> {modeVerbs[mode]} to {anchor.name}
          {planned && <small> · weekday 08:30 from TfL</small>}
          {route && <small>{routeFacts(route)}</small>}
          {altRoute && <small className="block">{modeLabels[altModes[mode]!]} route: {Math.round(altRoute.duration / 60)} min{routeFacts(altRoute)} (dashed on the map)</small>}
          {!routed && <small className="block">{mode === 'transit' ? 'Rough estimate from distance. Check the operator’s journey planner.' : 'Estimate from distance. Routed times cover the 500 homes nearest your place.'}</small>}</span></p>
        : <p className="muted">Add where you go every day to see trip times.</p>}
    </section>

    {anchor && journeys?.some((slot) => slot.journey) && <section className="detail-section">
      <h3>By public transport</h3>
      <ul className="stop-list">{journeys.map(({ id, label, direction, journey }) => <li key={id}>
        <span>{label} · {direction === 'there' ? `to ${anchor.name}` : 'home'}
          {journey && <small className="block">{journey.wait} min wait · {journey.walk} walk · {journey.ride} ride{journey.lines.length > 0 && ` · ${journey.lines.join(', ')}`}</small>}</span>
        <span>{journey ? <><strong>{journey.door} min</strong><small className="block">arrive {journey.arrive}</small></> : <small>No journey</small>}</span>
      </li>)}</ul>
      <small className="muted">Door to door from TfL, National Rail included, for the coming week.</small>
    </section>}

    {stops.length > 0 && <section className="detail-section">
      <h3>Transit nearby</h3>
      <ul className="stop-list">{stops.map(({ stop, km, lines, nightLines }) => <li key={`${stop.name}:${stop.coordinates.join()}`}>
        <div><strong>{stop.name || 'Stop'}</strong><small>{formatDistance(km)} · {walkingMinutes(km)} min walk{nightLines ? ` · ${nightLines} night line${nightLines > 1 ? 's' : ''}` : ''}</small></div>
        <div className="stop-lines">{lines.slice(0, 8).map((entry) => <LineBadge key={entry.index} line={entry.line} />)}{lines.length > 8 && <small>+{lines.length - 8}</small>}</div>
      </li>)}</ul>
      {!busShown && <p className="muted small">Bus stops show when Bus is on in the map layers.</p>}
    </section>}

    {daily.length > 0 && <section className="detail-section">
      <h3>Daily places</h3>
      <ul className="place-list">{daily.map(({ kind, place }) => {
        const Icon = placeIcons[kind]
        const independent = place.chain === OTHER_CHAIN
        return <li key={`${kind}:${place.chain}`}>
          <Icon size={17} aria-hidden />
          <span><strong>{!independent && <i className="chain-dot" style={{ background: place.color }} />}{independent ? place.name : place.chain}</strong>{!independent && place.name !== place.chain && <small>{place.name}</small>}</span>
          <span className="muted">{formatDistance(place.km)} · {walkingMinutes(place.km)} min walk</span>
        </li>
      })}</ul>
      <p className="muted small">Straight-line distances. The map marks what’s within a 10-minute walk.</p>
    </section>}

    {accessIndex && <section className="detail-section">
      <h3>Local food</h3>
      {food.length
        ? <p className="trip-line"><Carrot size={18} aria-hidden /><span>{food.map(([kind, count]) => `${count} ${foodLabels[kind]?.[count > 1 ? 1 : 0] ?? kind}`).join(' · ')}</span></p>
        : <p className="muted">No greengrocers, butchers, bakers, fishmongers, delis or markets on the map within a 10-minute walk.</p>}
      <p className="muted small">Within 800 m, from OpenStreetMap, so only what has been mapped.</p>
    </section>}

    {gyms && gyms.length > 0 && <section className="detail-section">
      <h3>Gyms on Google</h3>
      <ul className="place-list">{gyms.map((gym) => { const km = distanceKm(listing.coordinates, gym.coordinates)
        return <li key={gym.id}>
          <Star size={17} aria-hidden />
          <span><strong>{gym.url ? <a href={gym.url} target="_blank" rel="noreferrer">{gym.name}</a> : gym.name}</strong>
            <small>{gym.rating != null ? `${gym.rating.toFixed(1)} ★ · ${gym.reviews.toLocaleString('en')} reviews` : 'No rating yet'}</small></span>
          <span className="muted">{formatDistance(km)} · {walkingMinutes(km)} min walk</span>
        </li> })}</ul>
      <p className="muted small">The five nearest gyms on Google Maps, with their star rating.</p>
    </section>}

    {saved && <section className="detail-section">
      <h3>Your progress</h3>
      <div className="chip-row" role="radiogroup" aria-label="Progress">{savedStatuses.map((option) => <button key={option.id} type="button" role="radio" aria-checked={saved.status === option.id}
        className={`chip ${saved.status === option.id ? 'on' : ''}`} onClick={() => onUpdateSaved(listing.id, { status: option.id })}>{option.label}</button>)}</div>
      <textarea className="note" placeholder="Notes: questions for the landlord, viewing times…" value={saved.note} onChange={(event) => onUpdateSaved(listing.id, { note: event.target.value })} />
    </section>}

    <p className="detail-source muted small">
      Listed on {listing.source}{listing.lastSeenAt ? `, stored ${timeAgo(listing.lastSeenAt)}` : ''}. {listing.coordinateAccuracy === 'approximate' ? 'Map position is approximate. ' : ''}Confirm details with the advertiser.
    </p>
  </div>
}
