import type { Coordinates, Coverage, DailyPlace, HousingResponse, JourneySlot, LineSet, ParkPolygon, Place, Poi, ReachArea, Route, TravelMode } from './types'

async function getJson<T>(url: URL | string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const data = await response.json().catch(() => ({}))
  if (!response.ok && !('mode' in data)) throw new Error(data.error || data.reason || `Request failed (${response.status})`)
  return data as T
}

const api = (path: string) => new URL(path, window.location.origin)

export const fetchCoverage = (signal: AbortSignal) => getJson<Coverage>(api('/api/sources'), { signal })

export function fetchListings(place: Place, signal: AbortSignal) {
  const url = api('/api/listings')
  url.searchParams.set('city', place.city || place.name)
  url.searchParams.set('country', place.countryCode || '')
  url.searchParams.set('lon', String(place.coordinates[0]))
  url.searchParams.set('lat', String(place.coordinates[1]))
  return getJson<HousingResponse>(url, { signal })
}

async function fetchPart<T>(part: 'rail' | 'bus' | 'chains' | 'pois' | 'parks', at: Coordinates, signal: AbortSignal) {
  const url = api('/api/transit')
  url.searchParams.set('part', part)
  url.searchParams.set('lon', String(at[0]))
  url.searchParams.set('lat', String(at[1]))
  return getJson<T>(url, { signal })
}

export async function fetchLines(part: 'rail' | 'bus', at: Coordinates, signal: AbortSignal): Promise<LineSet> {
  const data = await fetchPart<Partial<LineSet>>(part, at, signal)
  if (!Array.isArray(data.features)) throw new Error('Transit data is unavailable')
  return { features: data.features, stops: data.stops ?? [], busLines: data.busLines }
}

export const fetchChains = async (at: Coordinates, signal: AbortSignal) => (await fetchPart<{ places?: DailyPlace[] }>('chains', at, signal)).places ?? []
export const fetchPois = async (at: Coordinates, signal: AbortSignal) => (await fetchPart<{ pois?: Poi[] }>('pois', at, signal)).pois ?? []
export const fetchParks = async (at: Coordinates, signal: AbortSignal) => (await fetchPart<{ parks?: ParkPolygon[] }>('parks', at, signal)).parks ?? []

export function fetchTrips(mode: Exclude<TravelMode, 'transit'>, to: Coordinates, from: Coordinates[], signal: AbortSignal) {
  return getJson<{ durations: (number | null)[], distances: (number | null)[], warning?: string }>(api('/api/commute'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode, to, from }), signal,
  })
}

export function fetchReach(mode: Exclude<TravelMode, 'transit'>, at: Coordinates, signal: AbortSignal) {
  const url = api('/api/reach')
  url.searchParams.set('mode', mode)
  url.searchParams.set('lon', String(at[0]))
  url.searchParams.set('lat', String(at[1]))
  return getJson<ReachArea>(url, { signal })
}

export function fetchRoute(mode: Exclude<TravelMode, 'transit'>, from: Coordinates, to: Coordinates, signal: AbortSignal) {
  const url = api('/api/route')
  url.searchParams.set('mode', mode)
  url.searchParams.set('from', from.join(','))
  url.searchParams.set('to', to.join(','))
  return getJson<Route>(url, { signal })
}

export function fetchJourneys(from: Coordinates, to: Coordinates, signal: AbortSignal) {
  const url = api('/api/journeys')
  url.searchParams.set('from', from.join(','))
  url.searchParams.set('to', to.join(','))
  return getJson<{ slots: JourneySlot[] }>(url, { signal })
}

interface PhotonFeature {
  geometry: { coordinates: Coordinates }
  properties: {
    osm_id: number, osm_type: string, osm_key: string, osm_value: string, type: string, name?: string, housenumber?: string, street?: string,
    district?: string, city?: string, state?: string, country?: string, countrycode?: string
  }
}

function toPlace({ geometry, properties: p }: PhotonFeature): Place {
  const street = [p.street, p.housenumber].filter(Boolean).join(' ')
  const name = p.name || street || p.city || 'Pinned place'
  const city = p.type === 'city' ? name : p.city
  return {
    id: `${p.osm_type}${p.osm_id}`,
    name,
    detail: [p.name && street !== name ? street : '', p.type === 'city' ? p.state : p.city, p.country].filter(Boolean).join(', '),
    coordinates: geometry.coordinates,
    city,
    countryCode: p.countrycode?.toUpperCase(),
  }
}

const countryBoxes: Record<string, [west: number, south: number, east: number, north: number]> = { CH: [5.95, 45.81, 10.5, 47.81] }

export async function searchPlaces(query: string, options: { cities?: boolean, near?: Coordinates, countries?: string[] }, signal: AbortSignal): Promise<Place[]> {
  const only = options.countries?.length ? options.countries : null
  const box = only?.length === 1 ? countryBoxes[only[0]] : undefined
  const url = new URL('https://photon.komoot.io/api/')
  url.searchParams.set('q', query)
  url.searchParams.set('limit', only && !box ? '15' : '6')
  url.searchParams.set('lang', 'en')
  if (options.cities) url.searchParams.set('layer', 'city')
  if (box) url.searchParams.set('bbox', box.join(','))
  if (options.near) {
    url.searchParams.set('lon', options.near[0].toFixed(3))
    url.searchParams.set('lat', options.near[1].toFixed(3))
  }
  const data = await getJson<{ features: PhotonFeature[] }>(url, { signal })
  const settlement = (feature: PhotonFeature) => Number(feature.properties.osm_key === 'place')
  const inCountry = data.features.filter((feature) => !only || only.includes(feature.properties.countrycode?.toUpperCase() ?? ''))
  const features = options.cities ? [...inCountry].sort((a, b) => settlement(b) - settlement(a)) : inCountry
  return features.slice(0, 6).map(toPlace)
}

export async function placeAt(at: Coordinates, signal: AbortSignal): Promise<Place | null> {
  const url = new URL('https://photon.komoot.io/reverse')
  url.searchParams.set('lon', at[0].toFixed(5))
  url.searchParams.set('lat', at[1].toFixed(5))
  url.searchParams.set('lang', 'en')
  const data = await getJson<{ features: PhotonFeature[] }>(url, { signal })
  return data.features[0] ? { ...toPlace(data.features[0]), coordinates: at } : null
}
