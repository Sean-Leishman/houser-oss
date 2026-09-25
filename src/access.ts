import { GridIndex } from './geo'
import { chainPalette, independentColor } from './layers'
import type { Coordinates, DailyKind, DailyPlace, Listing, TransitData, TransitLine, TransitMode, TransitStop } from './types'

export const modeOrder: TransitMode[] = ['train', 'metro', 'tram', 'bus']
const rank = (mode: TransitMode) => modeOrder.indexOf(mode)

export const dailyKinds: DailyKind[] = ['supermarket', 'gym']
export const OTHER_CHAIN = 'Independent'

export interface PlaceChoice { hidden: string[], walk: boolean }
export type PlaceChoices = Record<DailyKind, PlaceChoice>

export interface ChainPlace extends DailyPlace { chain: string }
export interface ChainMarker extends ChainPlace { color: string }
export interface ChainCount { chain: string, count: number }
export interface NearestPlace { name: string, chain: string, km: number, color: string }

export interface LineNearby { line: TransitLine, index: number, km: number, stop: string }
export interface StopNearby { stop: TransitStop, km: number, lines: { line: TransitLine, index: number }[], nightLines: number }
export interface Access {
  lines: LineNearby[]
  railKm: number | null
  nearest: Partial<Record<DailyKind, NearestPlace>>
}

export interface AccessIndex {
  stops: GridIndex<TransitStop>
  places: Record<DailyKind, GridIndex<ChainPlace>>
  placeList: Record<DailyKind, ChainPlace[]>
  chains: Record<DailyKind, ChainCount[]>
  colors: Record<DailyKind, Map<string, string>>
  transit: TransitData
}

export const chainColor = (index: AccessIndex, kind: DailyKind, chain: string) => index.colors[kind].get(chain) ?? independentColor

const chainKey = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '')

function withChains(places: DailyPlace[]): ChainPlace[] {
  const unbranded = new Map<string, number>()
  for (const place of places) if (!place.brand && place.name) unbranded.set(chainKey(place.name), (unbranded.get(chainKey(place.name)) ?? 0) + 1)
  const raw = places.map((place) => place.brand ?? (place.name && (unbranded.get(chainKey(place.name)) ?? 0) > 1 ? place.name : null))
  const spellings = new Map<string, Map<string, number>>()
  for (const name of raw) {
    if (!name) continue
    const variants = spellings.get(chainKey(name)) ?? new Map<string, number>()
    variants.set(name, (variants.get(name) ?? 0) + 1)
    spellings.set(chainKey(name), variants)
  }
  const display = new Map([...spellings].map(([key, variants]) => [key, [...variants].sort((a, b) => b[1] - a[1])[0][0]]))
  const parent = new Map<string, string>()
  for (const [key, name] of display) {
    const base = [...display].filter(([other, otherName]) => other !== key && name.toLowerCase().startsWith(`${otherName.toLowerCase()} `))
      .sort((a, b) => b[1].length - a[1].length)[0]
    if (base) parent.set(key, base[0])
  }
  const resolve = (key: string) => {
    for (let depth = 0; depth < 4 && parent.has(key); depth++) key = parent.get(key)!
    return display.get(key)!
  }
  return places.map((place, index) => ({ ...place, chain: raw[index] ? resolve(chainKey(raw[index]!)) : OTHER_CHAIN }))
}

export function indexTransit(transit: TransitData): AccessIndex {
  const grouped = withChains(transit.places)
  const places = {} as AccessIndex['places']
  const placeList = {} as AccessIndex['placeList']
  const chains = {} as AccessIndex['chains']
  const colors = {} as AccessIndex['colors']
  for (const kind of dailyKinds) {
    const list = grouped.filter((place) => place.kind === kind)
    placeList[kind] = list
    places[kind] = new GridIndex(list, (place) => place.coordinates)
    const counts = new Map<string, number>()
    for (const place of list) counts.set(place.chain, (counts.get(place.chain) ?? 0) + 1)
    chains[kind] = [...counts].map(([chain, count]) => ({ chain, count }))
      .sort((a, b) => Number(a.chain === OTHER_CHAIN) - Number(b.chain === OTHER_CHAIN) || b.count - a.count || a.chain.localeCompare(b.chain))
    const offset = kind === 'gym' ? chainPalette.length / 2 : 0
    colors[kind] = new Map(chains[kind].filter(({ chain }) => chain !== OTHER_CHAIN).map(({ chain }, position) => [chain, chainPalette[(position + offset) % chainPalette.length]]))
  }
  return { stops: new GridIndex(transit.stops, (stop) => stop.coordinates), places, placeList, chains, colors, transit }
}

function uniqueLines(indexes: number[], transit: TransitData) {
  const seen = new Set<string>()
  return indexes.map((index) => ({ line: transit.features[index]?.properties, index }))
    .filter((entry): entry is { line: TransitLine, index: number } => {
      if (!entry.line) return false
      const key = `${entry.line.mode}:${entry.line.code}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => rank(a.line.mode) - rank(b.line.mode) || a.line.code.localeCompare(b.line.code, undefined, { numeric: true }))
}

export function nearbyStops(point: Coordinates, index: AccessIndex, radiusKm = .8, limit = 5): StopNearby[] {
  return index.stops.near(point, radiusKm).map(({ item, km }) => {
    const lines = uniqueLines(item.lines, index.transit)
    const day = lines.filter((entry) => !entry.line.night)
    return { stop: item, km, lines: day, nightLines: lines.length - day.length }
  }).filter((entry) => entry.lines.length).slice(0, limit)
}

export function nearestChains(point: Coordinates, index: AccessIndex, kind: DailyKind, hidden: string[], limit = 3): NearestPlace[] {
  const found = new Map<string, NearestPlace>()
  for (const { item, km } of index.places[kind].near(point, 3)) {
    if (hidden.includes(item.chain) || found.has(item.chain)) continue
    found.set(item.chain, { name: item.name || item.chain, chain: item.chain, km, color: chainColor(index, kind, item.chain) })
    if (found.size >= limit) break
  }
  return [...found.values()]
}

export function shownPlaces(index: AccessIndex, choices: PlaceChoices): ChainMarker[] {
  return dailyKinds.flatMap((kind) => index.placeList[kind].filter((place) => !choices[kind].hidden.includes(place.chain))
    .map((place) => ({ ...place, color: chainColor(index, kind, place.chain) })))
}

export function accessFor(point: Coordinates, index: AccessIndex, choices: PlaceChoices): Access {
  const best = new Map<string, LineNearby>()
  for (const { item: stop, km } of index.stops.near(point, 1)) {
    for (const lineIndex of stop.lines) {
      const line = index.transit.features[lineIndex]?.properties
      if (!line || line.night) continue
      const key = `${line.mode}:${line.code}`
      if (!best.has(key)) best.set(key, { line, index: lineIndex, km, stop: stop.name })
    }
  }
  const lines = [...best.values()].sort((a, b) => rank(a.line.mode) - rank(b.line.mode) || a.km - b.km)
  const rail = lines.filter((entry) => entry.line.mode !== 'bus').map((entry) => entry.km)
  const nearest: Access['nearest'] = {}
  for (const kind of dailyKinds) {
    const hidden = choices[kind].hidden
    const hit = index.places[kind].near(point, 2).find(({ item }) => !hidden.includes(item.chain))
    if (hit) nearest[kind] = { name: hit.item.name || hit.item.chain, chain: hit.item.chain, km: hit.km, color: chainColor(index, kind, hit.item.chain) }
  }
  return { lines, railKm: rail.length ? Math.min(...rail) : null, nearest }
}

export function accessForListings(listings: Listing[], index: AccessIndex | null, choices: PlaceChoices): Map<string, Access> {
  const result = new Map<string, Access>()
  if (!index) return result
  for (const listing of listings) result.set(listing.id, accessFor(listing.coordinates, index, choices))
  return result
}

export function cardLines(access: Access | undefined, limit = 3, modes: TransitMode[] = modeOrder): LineNearby[] {
  if (!access) return []
  const shown = access.lines.filter((entry) => modes.includes(entry.line.mode))
  const firstOfMode = modeOrder.map((mode) => shown.find((entry) => entry.line.mode === mode)).filter((entry): entry is LineNearby => Boolean(entry))
  const rest = shown.filter((entry) => !firstOfMode.includes(entry)).sort((a, b) => a.km - b.km)
  return [...firstOfMode, ...rest].slice(0, limit)
}

export function nearLine(point: Coordinates, lineIndex: number, index: AccessIndex, radiusKm = .6) {
  return index.stops.near(point, radiusKm).some(({ item }) => item.lines.includes(lineIndex))
}
