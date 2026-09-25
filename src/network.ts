import { distanceKm } from './geo'
import type { DailyPlace, LineSet, Poi, TransitData, TransitStop } from './types'

// "Amsterdam, Muntplein" and "Muntplein" are one stop.
const stopKey = (name: string) => name.replace(/^[^,]+,\s*/, '').toLowerCase()

export function mergeNetwork(rail: LineSet, bus: LineSet | null, places: DailyPlace[] | null, pois: Poi[] | null): TransitData {
  const features = bus ? [...rail.features, ...bus.features] : rail.features
  const stops: TransitStop[] = rail.stops.map((stop) => ({ ...stop, lines: [...stop.lines] }))
  if (bus) {
    const offset = rail.features.length
    const byName = new Map<string, TransitStop[]>()
    for (const stop of stops) byName.set(stopKey(stop.name), [...(byName.get(stopKey(stop.name)) ?? []), stop])
    for (const stop of bus.stops) {
      const lines = stop.lines.map((line) => line + offset)
      const match = stop.name ? byName.get(stopKey(stop.name))?.find((item) => distanceKm(item.coordinates, stop.coordinates) < .3) : undefined
      if (match) match.lines = [...new Set([...match.lines, ...lines])].sort((a, b) => a - b)
      else stops.push({ ...stop, lines })
    }
  }
  return { type: 'FeatureCollection', features, stops, places: places ?? [], pois: pois ?? [] }
}
