import type { Coordinates, TravelMode } from './types'

const rad = Math.PI / 180

export function distanceKm(a: Coordinates, b: Coordinates): number {
  const h = Math.sin((b[1] - a[1]) * rad / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin((b[0] - a[0]) * rad / 2) ** 2
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)))
}

export const walkingMinutes = (km: number) => Math.max(1, Math.round(km * 1.25 / 4.8 * 60))

export function estimateMinutes(from: Coordinates, to: Coordinates, mode: TravelMode): number {
  const km = distanceKm(from, to) * 1.3
  switch (mode) {
    case 'walk': return Math.max(1, Math.round(km / 4.8 * 60))
    case 'bike': return Math.max(2, Math.round(km / 15 * 60 + 2))
    case 'quiet': return Math.max(2, Math.round(km * 1.1 / 15 * 60 + 2))
    case 'car': return Math.max(4, Math.round(km / 25 * 60 + 6))
    case 'transit': return Math.max(6, Math.round(km / 18 * 60 + 9))
  }
}

export function circle(center: Coordinates, radiusKm: number, steps = 72): Coordinates[] {
  const ring: Coordinates[] = []
  const dLat = radiusKm / 110.54
  const dLon = radiusKm / (111.32 * Math.cos(center[1] * rad))
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI
    ring.push([center[0] + dLon * Math.sin(angle), center[1] + dLat * Math.cos(angle)])
  }
  return ring
}

export class GridIndex<T> {
  private cells = new Map<string, T[]>()
  constructor(items: T[], private position: (item: T) => Coordinates, private size = .01) {
    for (const item of items) {
      const cell = this.cell(position(item))
      const bucket = this.cells.get(cell)
      if (bucket) bucket.push(item)
      else this.cells.set(cell, [item])
    }
  }

  private cell([lon, lat]: Coordinates, dx = 0, dy = 0) {
    return `${Math.floor(lon / this.size) + dx}:${Math.floor(lat / this.size) + dy}`
  }

  near(point: Coordinates, radiusKm: number): { item: T, km: number }[] {
    const reachY = Math.ceil(radiusKm / 110.54 / this.size)
    const reachX = Math.ceil(radiusKm / (111.32 * Math.cos(point[1] * rad)) / this.size)
    const found: { item: T, km: number }[] = []
    for (let dx = -reachX; dx <= reachX; dx++) for (let dy = -reachY; dy <= reachY; dy++) {
      for (const item of this.cells.get(this.cell(point, dx, dy)) ?? []) {
        const km = distanceKm(point, this.position(item))
        if (km <= radiusKm) found.push({ item, km })
      }
    }
    return found.sort((a, b) => a.km - b.km)
  }
}

export type Bounds = [west: number, south: number, east: number, north: number]

function cityBox([lon, lat]: Coordinates, half: number): Bounds {
  const dx = Math.min(1.5, half / Math.cos(lat * rad))
  return [Math.max(-180, lon - dx), Math.max(-85, lat - half), Math.min(180, lon + dx), Math.min(85, lat + half)]
}

const snapped = ([lon, lat]: Coordinates): Coordinates => [Math.round(lon * 20) / 20, Math.round(lat * 20) / 20]

export const cityView = (center: Coordinates) => cityBox(center, .06)

export const loadedArea = (center: Coordinates) => cityBox(snapped(center), .1)

export const inBounds = ([lon, lat]: Coordinates, [west, south, east, north]: Bounds) => lon >= west && lon <= east && lat >= south && lat <= north

export const formatDistance = (km: number) => km < 1 ? `${Math.max(10, Math.round(km * 100) * 10)} m` : `${km.toFixed(1)} km`
