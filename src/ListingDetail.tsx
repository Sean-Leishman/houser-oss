import { ArrowLeft, ArrowUpRight, Heart } from 'lucide-react'
import { dailyKinds, nearbyStops, nearestChains, OTHER_CHAIN, type AccessIndex, type PlaceChoices } from './access'
import { formatDistance, walkingMinutes } from './geo'
import { availability, homeRooms, kindLabels, money, modeVerbs, roomsLabel, timeAgo } from './format'
import LineBadge from './LineBadge'
import { modeIcons, placeIcons } from './ListingCard'
import { savedStatuses, type SavedHome, type SavedStatus } from './storage'
import type { Listing, Place, Route, TravelMode, Trip } from './types'

interface Props {
  busShown: boolean
  listing: Listing
  trip: Trip | null
  route: Route | null
  mode: TravelMode
  anchor: Place | null
  accessIndex: AccessIndex | null
  choices: PlaceChoices
  saved?: SavedHome
  onBack: () => void
  onToggleSave: (listing: Listing) => void
  onUpdateSaved: (id: string, change: { status?: SavedStatus, note?: string }) => void
}

export default function ListingDetail({ busShown, listing, trip, route, mode, anchor, accessIndex, choices, saved, onBack, onToggleSave, onUpdateSaved }: Props) {
  const ModeIcon = modeIcons[mode]
  const stops = accessIndex ? nearbyStops(listing.coordinates, accessIndex) : []
  const daily = !accessIndex ? [] : dailyKinds.flatMap((kind) =>
    nearestChains(listing.coordinates, accessIndex, kind, choices[kind].hidden).map((place) => ({ kind, place })))
  const minutes = route ? Math.round(route.duration / 60) : trip?.minutes
  const routed = Boolean(route) || Boolean(trip?.routed)
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
      {listing.sourceUrl && <a className="button primary" href={listing.sourceUrl} target="_blank" rel="noreferrer">View on {listing.source} <ArrowUpRight size={16} aria-hidden /></a>}
      <button type="button" className={`button ${saved ? 'saved' : ''}`} aria-pressed={Boolean(saved)} onClick={() => onToggleSave(listing)}><Heart size={16} aria-hidden /> {saved ? 'Saved' : 'Save'}</button>
    </div>

    {known.length > 0 && <dl className="facts">{known.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}

    <section className="detail-section">
      <h3>Your trip</h3>
      {anchor && minutes != null
        ? <p className="trip-line"><ModeIcon size={18} aria-hidden /><span><strong>{routed ? '' : '≈ '}{minutes} min</strong> {modeVerbs[mode]} to {anchor.name}
          {route && <small> · {route.distance.toFixed(1)} km</small>}
          {!routed && <small className="block">{mode === 'transit' ? 'Rough estimate from distance. Check the operator’s journey planner.' : 'Estimate from distance. Routed times cover the 500 homes nearest your place.'}</small>}</span></p>
        : <p className="muted">Add where you go every day to see trip times.</p>}
    </section>

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
