import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createLocationCache, readJson, USER_AGENT } from './cache.mjs'

const DAY = 86_400_000
const costing = { walk: 'pedestrian', bike: 'bicycle', car: 'auto' }
export const REACH_MINUTES = [15, 30, 45, 60]
const BATCH = 50
const HEIGHT_POINTS = 200
// A DEM is noisy: metre-scale jitter along a flat road reads as climbing. Only commit a
// change once it passes this, or a ride across the Thames valley claims hundreds of metres.
const MIN_CLIMB = 2

export const routingModes = Object.keys(costing)
const key = ([lon, lat]) => `${lon.toFixed(4)},${lat.toFixed(4)}`
const point = ([lon, lat]) => ({ lon: Number(lon.toFixed(4)), lat: Number(lat.toFixed(4)) })

export function validPoint(value) {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite) && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 85
}

function kilometres(a, b) {
  const rad = Math.PI / 180
  const h = Math.sin((a[1] - b[1]) * rad / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin((a[0] - b[0]) * rad / 2) ** 2
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)))
}

function createQueue({ baseUrl, label, headers = {}, spacingMs, fetchImpl, now }) {
  let tail = Promise.resolve()
  let nextAt = 0
  let pending = 0
  return function post(path, body) {
    if (pending >= 12) return Promise.reject(new Error(`${label} is busy. Please retry shortly.`))
    pending++
    const run = tail.then(async () => {
      const wait = nextAt - now()
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 60_000)))
      nextAt = now() + spacingMs
      const response = await fetchImpl(new URL(path, baseUrl), { method: 'POST', body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT, ...headers }, signal: AbortSignal.timeout(30_000) })
      if (response.status === 429) nextAt = now() + 30_000
      if (!response.ok) {
        let message = `${label} returned HTTP ${response.status}`
        try { message = (await response.json()).error || message } catch {}
        throw new Error(message)
      }
      return readJson(response, 20_000_000)
    })
    const settled = run.finally(() => { pending-- })
    tail = settled.catch(() => {})
    return settled
  }
}

export function decodePolyline6(encoded) {
  const coordinates = []
  let index = 0, lat = 0, lon = 0
  while (index < encoded.length) {
    for (const axis of [0, 1]) {
      let result = 0, shift = 0, byte
      do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5 } while (byte >= 0x20)
      const delta = result & 1 ? ~(result >> 1) : result >> 1
      if (axis === 0) lat += delta
      else lon += delta
    }
    coordinates.push([lon / 1e6, lat / 1e6])
  }
  return coordinates
}

export function sampleShape(coordinates, limit = HEIGHT_POINTS) {
  if (coordinates.length <= limit) return coordinates
  const step = (coordinates.length - 1) / (limit - 1)
  return Array.from({ length: limit }, (_, index) => coordinates[Math.round(index * step)])
}

export function elevationChange(heights, minDelta = MIN_CLIMB) {
  const known = heights.filter(Number.isFinite)
  if (known.length < 2) return null
  let ascent = 0, descent = 0, anchor = known[0]
  for (const height of known.slice(1)) {
    const delta = height - anchor
    if (Math.abs(delta) < minDelta) continue
    if (delta > 0) ascent += delta
    else descent -= delta
    anchor = height
  }
  return { ascent: Math.round(ascent), descent: Math.round(descent) }
}

export function createRoutingService({ baseUrl = process.env.VALHALLA_URL || 'https://valhalla1.openstreetmap.de',
  clientId = process.env.VALHALLA_CLIENT_ID || 'houser', fetchImpl = fetch, cacheDir = join(process.cwd(), '.cache'),
  now = Date.now, spacingMs = 1100 } = {}) {
  const reachCache = createLocationCache({ namespace: 'reach-v1', ttlMs: 7 * DAY, staleMs: 30 * DAY, cacheDir, now })
  const routeCache = createLocationCache({ namespace: 'route-v1', ttlMs: 7 * DAY, staleMs: 30 * DAY, cacheDir, now })
  const tables = new Map()
  const post = createQueue({ baseUrl, label: 'Routing', headers: { 'X-Client-Id': clientId }, spacingMs, fetchImpl, now })

  async function streetTimes(mode, to, batch) {
    const data = await post('/sources_to_targets', { sources: batch.map((item) => point(item.split(',').map(Number))),
      targets: [point(to)], costing: costing[mode], units: 'kilometers' })
    if (!Array.isArray(data.sources_to_targets)) throw new Error('Routing returned an invalid matrix')
    return batch.map((_, index) => {
      const cell = data.sources_to_targets[index]?.[0]
      return { s: Number.isFinite(cell?.time) ? cell.time : null, km: Number.isFinite(cell?.distance) ? cell.distance : null }
    })
  }

  function table(mode, to) {
    const id = `${mode}:${key(to)}`
    if (!tables.has(id)) {
      const file = join(cacheDir, `matrix-v1-${createHash('sha256').update(id).digest('hex').slice(0, 24)}.json`)
      if (tables.size >= 200) tables.delete(tables.keys().next().value)
      tables.set(id, readFile(file, 'utf8').then((text) => JSON.parse(text).entries || {}).catch(() => ({}))
        .then((entries) => ({ file, entries, lock: Promise.resolve() })))
    }
    return tables.get(id)
  }

  async function durations({ mode, to, from }) {
    const saved = await table(mode, to)
    const run = saved.lock.then(async () => {
      const missing = [...new Set(from.map(key))].filter((item) => {
        const entry = saved.entries[item]
        return !entry || now() - entry.at > 30 * DAY
      }).filter((item) => kilometres(item.split(',').map(Number), to) <= 100)
      let error = null
      let added = 0
      for (let start = 0; start < missing.length; start += BATCH) {
        const batch = missing.slice(start, start + BATCH)
        try {
          const times = await streetTimes(mode, to, batch)
          batch.forEach((item, index) => { saved.entries[item] = { ...times[index], at: now() } })
          added += batch.length
        } catch (caught) { error = caught; break }
      }
      if (added) {
        try {
          await mkdir(cacheDir, { recursive: true })
          const temporary = `${saved.file}.${process.pid}.tmp`
          await writeFile(temporary, JSON.stringify({ mode, to, entries: saved.entries }), 'utf8')
          await rename(temporary, saved.file)
        } catch {}
      }
      return { durations: from.map((item) => saved.entries[key(item)]?.s ?? null), distances: from.map((item) => saved.entries[key(item)]?.km ?? null),
        source: 'Valhalla · OpenStreetMap', ...(error ? { partial: true, warning: error.message } : {}) }
    })
    saved.lock = run.catch(() => {})
    return run
  }

  async function reach({ mode, at }) {
    const result = await reachCache(`${mode}:${key(at)}`, async () => {
      const data = await post('/isochrone', { locations: [point(at)], costing: costing[mode], contours: REACH_MINUTES.map((time) => ({ time })),
        polygons: true, denoise: .3, generalize: 50 })
      if (!Array.isArray(data.features)) throw new Error('Routing returned an invalid reach area')
      return { type: 'FeatureCollection', features: data.features.filter((feature) => /Polygon$/.test(feature.geometry?.type))
        .map((feature) => ({ type: 'Feature', properties: { minutes: feature.properties?.contour }, geometry: feature.geometry })) }
    })
    return { ...result.data, updatedAt: result.updatedAt, stale: result.stale }
  }

  async function climb(coordinates) {
    // Only walking and cycling care about hills, and this doubles the calls to a shared
    // routing server -- so it is not asked for a car. A height service without coverage
    // answers nulls, which elevationChange reports as no data rather than as flat.
    const data = await post('/height', { shape: sampleShape(coordinates).map((coordinate) => point(coordinate)) })
    return Array.isArray(data.height) ? elevationChange(data.height) : null
  }

  async function route({ mode, from, to }) {
    const result = await routeCache(`${mode}:${key(from)}:${key(to)}`, async () => {
      const data = await post('/route', { locations: [point(from), point(to)], costing: costing[mode], directions_type: 'none', units: 'kilometers' })
      const leg = data.trip?.legs?.[0]
      if (!leg?.shape || !Number.isFinite(data.trip.summary?.time)) throw new Error('Routing returned no route')
      const coordinates = decodePolyline6(leg.shape)
      let elevation = null
      if (mode !== 'car') {
        try { elevation = await climb(coordinates) } catch { elevation = null }
      }
      return { duration: data.trip.summary.time, distance: data.trip.summary.length,
        geometry: { type: 'LineString', coordinates }, ...(elevation ? { elevation } : {}) }
    })
    return { ...result.data, updatedAt: result.updatedAt }
  }

  return { durations, reach, route }
}
