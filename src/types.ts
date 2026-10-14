import type { Feature, FeatureCollection, LineString, MultiLineString, MultiPolygon, Polygon } from 'geojson'

export type Coordinates = [longitude: number, latitude: number]
export type TravelMode = 'walk' | 'bike' | 'transit' | 'car'
export type TransitMode = 'train' | 'metro' | 'tram' | 'bus'
export type ListingKind = 'room' | 'studio' | 'apartment' | 'house'

export interface Place {
  id: string
  name: string
  detail: string
  coordinates: Coordinates
  city?: string
  countryCode?: string
}

export interface Listing {
  id: string
  title: string
  address: string
  coordinates: Coordinates
  coordinateAccuracy?: 'approximate' | 'exact'
  country?: string
  price: number
  currency: string
  originalPrice?: number
  originalCurrency?: string
  priceConverted?: boolean
  pricePeriod: 'month'
  kind?: ListingKind | null
  bedrooms: number | null
  bedroomsEstimated?: boolean
  rooms?: number | null
  areaM2: number | null
  furnished: boolean | null
  image: string
  source: string
  sourceUrl?: string
  availableFrom?: string
  lastSeenAt?: string | null
}

export interface HousingSource {
  name: string
  url: string
  status: 'checked' | 'stale' | 'unavailable'
  count: number
  total?: number | null
  updatedAt: number | null
}

export interface Coverage {
  sources: { name: string, file: string, count: number, skipped: number, fetchedAt: number | null, countries: string[], error?: string }[]
  countries: string[]
}

export interface HousingResponse {
  mode: 'live' | 'unsupported' | 'unavailable'
  currency?: string
  listings?: Listing[]
  sources?: HousingSource[]
  updatedAt?: number
  stale?: boolean
  partial?: boolean
  reason?: string
}

export interface TransitLine {
  lineId: string
  code: string
  name: string
  mode: TransitMode
  operator: string
  color: string
  night?: boolean
  sourceUrl?: string
}

export interface TransitStop {
  name: string
  coordinates: Coordinates
  lines: number[]
}

export type DailyKind = 'supermarket' | 'gym'
export type PoiCategory = 'shops' | 'food' | 'sport' | 'health' | 'schools'

export interface Poi {
  category: PoiCategory
  name: string
  coordinates: Coordinates
}

export interface DailyPlace {
  kind: DailyKind
  name: string
  brand: string | null
  coordinates: Coordinates
}

export interface LineSet {
  features: Feature<LineString | MultiLineString, TransitLine>[]
  stops: TransitStop[]
  busLines?: number
}

export type ParkPolygon = Coordinates[][]

export type TransitData = FeatureCollection<LineString | MultiLineString, TransitLine> & {
  stops: TransitStop[]
  places: DailyPlace[]
  pois: Poi[]
}

export type ReachArea = FeatureCollection<Polygon | MultiPolygon, { minutes: number }>

export interface Route {
  duration: number
  distance: number
  geometry: LineString
  elevation?: { ascent: number; descent: number }
}

export interface Trip {
  minutes: number
  km?: number | null
  routed: boolean
}
