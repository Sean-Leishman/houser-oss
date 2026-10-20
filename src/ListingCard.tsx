import { memo } from 'react'
import { Bike, CarFront, Dumbbell, Footprints, Heart, House, Leaf, ShoppingBasket, TramFront } from 'lucide-react'
import { cardLines, dailyKinds, OTHER_CHAIN, type Access } from './access'
import { formatDistance } from './geo'
import { availability, listingFacts, money } from './format'
import LineBadge from './LineBadge'
import type { Listing, TransitMode, TravelMode, Trip } from './types'
import type { SavedStatus } from './storage'

export const modeIcons = { walk: Footprints, bike: Bike, quiet: Leaf, transit: TramFront, car: CarFront }
export const placeIcons = { supermarket: ShoppingBasket, gym: Dumbbell }

interface Props {
  listing: Listing
  trip: Trip | null
  mode: TravelMode
  access?: Access
  lineModes: TransitMode[]
  saved: boolean
  status?: SavedStatus
  selected: boolean
  hovered: boolean
  onSelect: (id: string) => void
  onHover: (id: string | null) => void
  onToggleSave: (listing: Listing) => void
}

function ListingCard({ listing, trip, mode, access, lineModes, saved, status, selected, hovered, onSelect, onHover, onToggleSave }: Props) {
  const ModeIcon = modeIcons[mode]
  const facts = listingFacts(listing)
  const when = availability(listing.availableFrom)
  return <article className={`card ${selected ? 'selected' : ''} ${hovered ? 'hovered' : ''}`} onMouseEnter={() => onHover(listing.id)} onMouseLeave={() => onHover(null)}>
    <button type="button" className="card-main" onClick={() => onSelect(listing.id)} aria-label={`${listing.title}, ${money(listing.price, listing.currency)} a month`}>
      <span className="card-photo">{listing.image ? <img src={listing.image} alt="" loading="lazy" /> : <House size={22} aria-hidden />}</span>
      <span className="card-body">
        <span className="card-price">{listing.priceConverted ? '≈ ' : ''}{money(listing.price, listing.currency)}<small>/mo</small>{status && status !== 'saved' && <em className={`status-tag status-${status}`}>{status}</em>}</span>
        {facts && <span className="card-facts">{facts}</span>}
        <span className="card-address">{listing.address || listing.title}{when ? ` · ${when}` : ''}</span>
        <span className="card-data">
          {trip && <span className="card-trip" title={trip.routed ? 'Routed trip time' : 'Estimated from distance'}><ModeIcon size={14} aria-hidden />{trip.routed ? '' : '≈'}{trip.minutes} min</span>}
          {cardLines(access, 2, lineModes).map((entry) => <span key={entry.index} className="line-near"><LineBadge line={entry.line} />{formatDistance(entry.km)}</span>)}
          {dailyKinds.map((kind) => {
            const place = access?.nearest[kind]
            if (!place) return null
            const Icon = placeIcons[kind]
            return <span key={kind} className="place-near" title={place.name}><Icon size={14} aria-hidden />
              {place.chain !== OTHER_CHAIN && <><i className="chain-dot" style={{ background: place.color }} /><span className="chain">{place.chain}</span></>}{formatDistance(place.km)}</span>
          })}
        </span>
      </span>
    </button>
    <button type="button" className={`save-button ${saved ? 'on' : ''}`} aria-pressed={saved} aria-label={saved ? 'Remove from saved' : 'Save home'} onClick={() => onToggleSave(listing)}>
      <Heart size={18} aria-hidden />
    </button>
  </article>
}

export default memo(ListingCard)
