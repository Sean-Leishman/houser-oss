import { useState, type FormEvent } from 'react'
import { ArrowLeft, MapPin, X } from 'lucide-react'
import { addHome } from './api'
import { kindLabels } from './format'
import { distanceKm } from './geo'
import PlaceSearch from './PlaceSearch'
import type { Listing, ListingKind, Place } from './types'

interface Props {
  city: Place
  currency: string
  onBack: () => void
  onAdded: (listing: Listing) => void
}

const kinds = Object.keys(kindLabels) as ListingKind[]

export default function AddHome({ city, currency: cityCurrency, onBack, onAdded }: Props) {
  const [place, setPlace] = useState<Place | null>(null)
  const [price, setPrice] = useState('')
  const [currency, setCurrency] = useState(cityCurrency)
  const [kind, setKind] = useState<ListingKind | ''>('')
  const [rooms, setRooms] = useState('')
  const [link, setLink] = useState('')
  const [title, setTitle] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // Homes are served for the area around the city centre, so a far pick would vanish on save.
  const far = place != null && distanceKm(place.coordinates, city.coordinates) > 10

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!place || far || !(Number(price) > 0)) return
    setBusy(true)
    setError('')
    try {
      onAdded(await addHome({
        coordinates: place.coordinates, price: Number(price), currency: currency.trim().toUpperCase(), country: place.countryCode,
        title: title.trim() || [kind ? kindLabels[kind] : 'Home', place.name].join(' on '), address: [place.name, place.detail].filter(Boolean).join(', '),
        kind: kind || undefined, rooms: rooms ? Number(rooms) : undefined, sourceUrl: link.trim() || undefined, coordinateAccuracy: 'approximate',
      }))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save the home')
      setBusy(false)
    }
  }

  return <form className="detail add-home" onSubmit={submit}>
    <button type="button" className="back-button" onClick={onBack}><ArrowLeft size={16} aria-hidden /> All homes</button>
    <h2>Add a home</h2>
    <p className="muted">Saved to data/my-homes.json on this computer, then shown with trip times like any other home.</p>

    <div className="field"><span>Address or street</span>
      {place
        ? <div className="anchor-row"><MapPin size={18} aria-hidden /><span className="anchor-text"><strong>{place.name}</strong>{place.detail && <small>{place.detail}</small>}</span>
          <button type="button" className="icon-button" aria-label="Change address" onClick={() => setPlace(null)}><X size={16} aria-hidden /></button></div>
        : <PlaceSearch label="Address of the home" placeholder="Street, postcode or building…" near={city.coordinates} autoFocus onPick={setPlace} />}
      {far && <small className="field-error">That is more than 10 km from {city.name}. Change the city first to add a home there.</small>}
    </div>
    <div className="field-row">
      <label className="field"><span>Rent per month</span><input type="number" min="1" step="any" inputMode="decimal" required value={price} onChange={(event) => setPrice(event.target.value)} /></label>
      <label className="field narrow"><span>Currency</span><input required pattern="[A-Za-z]{3}" maxLength={3} value={currency} onChange={(event) => setCurrency(event.target.value)} /></label>
    </div>
    <div className="field-row">
      <label className="field"><span>Type</span><select value={kind} onChange={(event) => setKind(event.target.value as ListingKind | '')}>
        <option value="">Not sure</option>{kinds.map((item) => <option key={item} value={item}>{kindLabels[item]}</option>)}</select></label>
      <label className="field narrow"><span>Rooms</span><input type="number" min="0" step="0.5" value={rooms} onChange={(event) => setRooms(event.target.value)} /></label>
    </div>
    <label className="field"><span>Link to the listing <small className="muted">optional</small></span><input type="url" pattern="https://.*" placeholder="https://…" value={link} onChange={(event) => setLink(event.target.value)} /></label>
    <label className="field"><span>Name <small className="muted">optional</small></span><input maxLength={200} placeholder={place ? `${kind ? kindLabels[kind] : 'Home'} on ${place.name}` : ''} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
    {error && <p className="field-error" role="alert">{error}</p>}
    <div className="detail-actions"><button type="submit" className="button primary" disabled={!place || far || busy}>{busy ? 'Saving…' : 'Add home'}</button></div>
  </form>
}
