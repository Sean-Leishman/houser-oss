import type { Listing, ListingKind, TravelMode } from './types'

const currencyFormats = new Map<string, Intl.NumberFormat>()
export function money(value: number, currency = 'EUR') {
  if (!currencyFormats.has(currency)) currencyFormats.set(currency, new Intl.NumberFormat('en-IE', { style: 'currency', currency, maximumFractionDigits: 0 }))
  return currencyFormats.get(currency)!.format(value)
}

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
export function timeAgo(timestamp: number | string | null | undefined, now = Date.now()) {
  if (timestamp == null) return ''
  const minutes = Math.round((now - new Date(timestamp).getTime()) / 60_000)
  if (!Number.isFinite(minutes)) return ''
  if (minutes < 1) return 'just now'
  if (minutes < 60) return relative.format(-minutes, 'minute')
  if (minutes < 60 * 24) return relative.format(-Math.round(minutes / 60), 'hour')
  return relative.format(-Math.round(minutes / 1440), 'day')
}

export const kindLabels: Record<ListingKind, string> = { room: 'Room', studio: 'Studio', apartment: 'Apartment', house: 'House' }
export const modeLabels: Record<TravelMode, string> = { walk: 'Walk', bike: 'Bike', transit: 'Transit', car: 'Car' }
export const modeVerbs: Record<TravelMode, string> = { walk: 'on foot', bike: 'by bike', transit: 'by transit', car: 'by car' }

export const roomsLabel = (rooms: number) => `${Math.floor(rooms) || ''}${rooms % 1 ? '½' : ''} room${rooms > 1 ? 's' : ''}`

export const homeRooms = (listing: Listing) => listing.kind !== 'room' && listing.kind !== 'studio' && listing.rooms ? listing.rooms : null

export function listingFacts(listing: Listing) {
  const rooms = homeRooms(listing)
  return [
    listing.kind ? kindLabels[listing.kind] : null,
    rooms ? roomsLabel(rooms) : null,
    listing.areaM2 ? `${listing.areaM2} m²` : null,
    !rooms && listing.kind !== 'room' && listing.kind !== 'studio' && listing.bedrooms ? `${listing.bedrooms} bed` : null,
    listing.furnished ? 'furnished' : listing.furnished === false ? 'unfurnished' : null,
  ].filter(Boolean).join(' · ')
}

export function availability(date: string | undefined, now = new Date()) {
  if (!date) return null
  const when = new Date(`${date}T00:00:00`)
  if (Number.isNaN(when.getTime())) return null
  if (when <= now) return 'Available now'
  return `From ${when.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(when.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) })}`
}

export function initials(name: string) {
  const words = name.split(/[\s\-–&+./]+/).filter(Boolean)
  if (words.length > 1) return words.slice(0, 2).map((word) => word[0]).join('').toUpperCase()
  const word = words[0] ?? '?'
  if (word === word.toUpperCase()) return word[0]
  return (word.match(/\p{Lu}/gu)?.join('') || word[0]).slice(0, 2).toUpperCase()
}

export function textOn(hex: string) {
  const value = /^#([0-9a-f]{6})$/i.exec(hex)?.[1]
  if (!value) return '#fff'
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255).map((c) => c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)
  return .2126 * r + .7152 * g + .0722 * b > .42 ? '#161512' : '#fff'
}
