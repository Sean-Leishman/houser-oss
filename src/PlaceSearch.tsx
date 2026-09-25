import { useEffect, useId, useRef, useState } from 'react'
import { LoaderCircle, Search } from 'lucide-react'
import { searchPlaces } from './api'
import type { Coordinates, Place } from './types'

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' })
const listFormat = new Intl.ListFormat('en', { type: 'conjunction' })

interface Props {
  label: string
  placeholder: string
  cities?: boolean
  near?: Coordinates
  countries?: string[]
  autoFocus?: boolean
  onPick: (place: Place) => void
  onCancel?: () => void
}

export default function PlaceSearch({ label, placeholder, cities, near, countries, autoFocus, onPick, onCancel }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Place[]>([])
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [active, setActive] = useState(0)
  const [open, setOpen] = useState(false)
  const listId = useId()
  const nearKey = near?.map((value) => value.toFixed(2)).join(',')
  const nearRef = useRef(near)
  nearRef.current = near

  useEffect(() => {
    const text = query.trim()
    if (text.length < 2) { setResults([]); setState('idle'); return }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setState('loading')
      searchPlaces(text, { cities, near: nearRef.current, countries }, controller.signal)
        .then((places) => { setResults(places); setActive(0); setState('done') })
        .catch(() => { if (!controller.signal.aborted) setState('error') })
    }, 250)
    return () => { clearTimeout(timer); controller.abort() }
  }, [query, cities, nearKey, countries?.join()])

  const pick = (place: Place) => {
    onPick(place)
    setQuery('')
    setResults([])
    setOpen(false)
  }

  const showList = open && query.trim().length >= 2

  return <div className="place-search">
    <label className="search-field">
      <span className="visually-hidden">{label}</span>
      {state === 'loading' ? <LoaderCircle className="spin" size={16} aria-hidden /> : <Search size={16} aria-hidden />}
      <input
        value={query}
        placeholder={placeholder}
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(event) => { setQuery(event.target.value); setOpen(true) }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => Math.min(results.length - 1, index + 1)) }
          else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(0, index - 1)) }
          else if (event.key === 'Enter' && results[active]) { event.preventDefault(); pick(results[active]) }
          else if (event.key === 'Escape') { setOpen(false); onCancel?.() }
        }}
      />
    </label>
    {showList && <ul className="search-results" id={listId} role="listbox">
      {results.map((place, index) => <li key={place.id} role="option" aria-selected={index === active}>
        <button type="button" className={index === active ? 'active' : ''} onMouseDown={(event) => event.preventDefault()} onClick={() => pick(place)}>
          <strong>{place.name}</strong>{place.detail && <span>{place.detail}</span>}
        </button>
      </li>)}
      {state === 'done' && !results.length && <li className="search-note">{countries?.length ? `No places found. Homes are stored for ${listFormat.format(countries.map((code) => regionNames.of(code) ?? code))} only.` : 'No places found'}</li>}
      {state === 'error' && <li className="search-note">Search is unavailable right now</li>}
    </ul>}
  </div>
}
