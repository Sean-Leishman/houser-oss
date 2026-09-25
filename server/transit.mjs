import { createLocationCache, readJson, USER_AGENT } from './cache.mjs'

const HOUR = 3_600_000
const modeMap = { subway: 'metro', monorail: 'metro', light_rail: 'tram', tram: 'tram', train: 'train', bus: 'bus', trolleybus: 'bus' }
const colors = { metro: '#7b5cb8', tram: '#1f8a85', train: '#3b64a8', bus: '#c7782f' }
const stopTags = (tags = {}) => ['stop_position', 'platform', 'station'].includes(tags.public_transport) ||
  ['bus_stop', 'tram_stop'].includes(tags.highway) || ['station', 'halt', 'stop', 'tram_stop', 'platform'].includes(tags.railway)
const round = (value) => Math.round(value * 1e5) / 1e5

export function transitArea(longitude, latitude) {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(longitude) > 180 || Math.abs(latitude) > 85) throw new Error('Invalid transit search coordinates')
  const lat = Math.round(latitude * 20) / 20
  const lon = Math.round(longitude * 20) / 20
  const dy = .1
  const dx = Math.min(1.5, dy / Math.cos(lat * Math.PI / 180))
  const bounds = [Math.max(-180, lon - dx), Math.max(-85, lat - dy), Math.min(180, lon + dx), Math.min(85, lat + dy)].map((n) => Number(n.toFixed(5)))
  return { key: `${lon}:${lat}`, bounds }
}

export const poiCategories = {
  shops: { shop: ['convenience', 'greengrocer', 'bakery', 'butcher', 'deli', 'cheese', 'seafood', 'kiosk', 'chemist', 'bicycle', 'hardware', 'doityourself'] },
  food: { amenity: ['cafe', 'restaurant', 'bar', 'pub', 'fast_food', 'ice_cream'] },
  sport: { leisure: ['sports_centre', 'swimming_pool'] },
  health: { amenity: ['pharmacy', 'doctors', 'clinic', 'hospital', 'dentist'] },
  schools: { amenity: ['school', 'kindergarten', 'university', 'college'] },
}

function poiCategory(tags = {}) {
  for (const [category, rule] of Object.entries(poiCategories)) {
    for (const [key, values] of Object.entries(rule)) if (values.includes(tags[key])) return category
  }
  return null
}

export const transitParts = ['rail', 'chains', 'bus', 'pois', 'parks']
const routeModes = { rail: 'subway|monorail|tram|light_rail|train', bus: 'bus|trolleybus' }

export function partQuery(part, bounds) {
  const [west, south, east, north] = bounds
  const bbox = `${south},${west},${north},${east}`
  const head = '[out:json][timeout:90][maxsize:268435456];'
  if (part === 'rail' || part === 'bus') {
    // Bus routes as tags only, so the legend can count them before buses load.
    const busNames = part === 'rail' ? `relation["type"="route"]["route"~"^(${routeModes.bus})$"](${bbox});out tags;` : ''
    return `${head}relation["type"="route"]["route"~"^(${routeModes[part]})$"](${bbox})->.routes;.routes out body;way(r.routes)(${bbox});out skel geom(${bbox});node(r.routes)(${bbox});out body;${busNames}`
  }
  if (part === 'chains') return `${head}nwr["shop"="supermarket"](${bbox});out tags center;nwr["leisure"="fitness_centre"](${bbox});out tags center;`
  if (part === 'parks') {
    const green = `["leisure"~"^(park|garden)$"]["access"!~"^(private|no)$"]`
    return `${head}(way${green}(${bbox});relation["type"="multipolygon"]${green}(${bbox}););out skel geom;`
  }
  const valuesByKey = {}
  for (const rule of Object.values(poiCategories)) for (const [key, values] of Object.entries(rule)) valuesByKey[key] = [...(valuesByKey[key] ?? []), ...values]
  return `${head}(${Object.entries(valuesByKey).map(([key, values]) => `nwr["${key}"~"^(${values.join('|')})$"](${bbox});`).join('')});out tags center;`
}

export function countBusLines(raw) {
  const codes = new Set()
  for (const element of raw.elements ?? []) {
    if (element.type !== 'relation' || modeMap[element.tags?.route] !== 'bus') continue
    codes.add(element.tags.ref || element.tags.name || String(element.id))
  }
  return codes.size
}

export function slotWaitSeconds(status) {
  const free = /(\d+) slots? available now/.exec(status)
  if (free && Number(free[1]) > 0) return 0
  const waits = [...status.matchAll(/in (\d+) seconds?/g)].map((match) => Number(match[1]))
  return waits.length ? Math.min(...waits) : null
}

export function simplifyPath(points, toleranceMeters = 3) {
  if (points.length <= 2) return points
  const kx = 111_320 * Math.cos(points[0][1] * Math.PI / 180)
  const ky = 110_540
  const keep = new Uint8Array(points.length)
  keep[0] = keep[points.length - 1] = 1
  const stack = [[0, points.length - 1]]
  while (stack.length) {
    const [first, last] = stack.pop()
    const ax = points[first][0] * kx, ay = points[first][1] * ky
    const dx = points[last][0] * kx - ax, dy = points[last][1] * ky - ay
    const lengthSq = dx * dx + dy * dy
    let furthest = -1, furthestSq = toleranceMeters ** 2
    for (let i = first + 1; i < last; i++) {
      const px = points[i][0] * kx - ax, py = points[i][1] * ky - ay
      const t = lengthSq ? Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSq)) : 0
      const distanceSq = (t * dx - px) ** 2 + (t * dy - py) ** 2
      if (distanceSq > furthestSq) { furthest = i; furthestSq = distanceSq }
    }
    if (furthest > 0) { keep[furthest] = 1; stack.push([first, furthest], [furthest, last]) }
  }
  return points.filter((_, index) => keep[index])
}

const samePoint = (a, b) => a[0] === b[0] && a[1] === b[1]
const isClosed = (ring) => ring.length > 3 && samePoint(ring[0], ring[ring.length - 1])
const toPoints = (geometry) => Array.isArray(geometry)
  ? geometry.filter((point) => point && Number.isFinite(point.lon) && Number.isFinite(point.lat)).map((point) => [point.lon, point.lat]) : []

export function joinRings(paths) {
  const rings = []
  const open = []
  for (const path of paths) if (path.length > 1) (isClosed(path) ? rings : open).push(path)
  while (open.length) {
    let ring = open.pop()
    for (let joined = true; joined && !isClosed(ring);) {
      joined = false
      for (let i = 0; i < open.length; i++) {
        const next = open[i]
        if (samePoint(ring.at(-1), next[0])) ring = [...ring, ...next.slice(1)]
        else if (samePoint(ring.at(-1), next.at(-1))) ring = [...ring, ...next.slice(0, -1).reverse()]
        else if (samePoint(ring[0], next.at(-1))) ring = [...next, ...ring.slice(1)]
        else if (samePoint(ring[0], next[0])) ring = [...next.slice().reverse(), ...ring.slice(1)]
        else continue
        open.splice(i, 1)
        joined = true
        break
      }
    }
    if (isClosed(ring)) rings.push(ring)
  }
  return rings
}

function insideRing([x, y], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function parkRing(ring, clockwise) {
  const points = simplifyPath(ring).map(([lon, lat]) => [round(lon), round(lat)]).filter((point, index, all) => index === 0 || !samePoint(point, all[index - 1]))
  if (!isClosed(points)) return null
  let area = 0
  for (let i = 0; i < points.length - 1; i++) area += points[i][0] * points[i + 1][1] - points[i + 1][0] * points[i][1]
  return (area < 0) === clockwise ? points : points.reverse()
}

export function normalizeParks(raw) {
  if (!Array.isArray(raw.elements) || raw.remark) throw new Error(raw.remark ? 'Park source could not finish the search' : 'Park source returned invalid data')
  const parks = []
  for (const element of raw.elements) {
    if (element.type === 'way') {
      const points = toPoints(element.geometry)
      const ring = isClosed(points) ? parkRing(points, false) : null
      if (ring) parks.push([ring])
    } else if (element.type === 'relation') {
      const members = (inner) => joinRings((element.members || []).filter((member) => member.type === 'way' && (member.role === 'inner') === inner).map((member) => toPoints(member.geometry)))
      const holes = members(true)
      for (const outer of members(false)) {
        const ring = parkRing(outer, false)
        if (!ring) continue
        const inside = holes.filter((hole) => insideRing(hole[0], outer)).map((hole) => parkRing(hole, true)).filter(Boolean)
        parks.push([ring, ...inside])
      }
    }
  }
  return parks
}

function metres(a, b) {
  const kx = 111_320 * Math.cos(a[1] * Math.PI / 180)
  return Math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * 110_540)
}

function groupStops(nodes, nodeLines) {
  const byName = new Map()
  const stops = []
  for (const [id, lines] of nodeLines) {
    const node = nodes.get(id)
    if (!node || !Number.isFinite(node.lon) || !Number.isFinite(node.lat) || !stopTags(node.tags)) continue
    const name = String(node.tags.name || node.tags['name:en'] || '').trim()
    const key = name.replace(/^[^,]+,\s*/, '').toLowerCase()
    const point = [node.lon, node.lat]
    const candidates = byName.get(key) || []
    let stop = candidates.find((item) => metres(item.center, point) < (name ? 300 : 40))
    if (!stop) {
      stop = { name, center: point, sum: [0, 0], count: 0, lines: new Set() }
      candidates.push(stop)
      byName.set(key, candidates)
      stops.push(stop)
    }
    if (name && (!stop.name || name.length < stop.name.length)) stop.name = name
    stop.sum[0] += point[0]
    stop.sum[1] += point[1]
    stop.count++
    stop.center = [stop.sum[0] / stop.count, stop.sum[1] / stop.count]
    for (const line of lines) stop.lines.add(line)
  }
  return stops.map((stop) => ({ name: stop.name, coordinates: stop.center.map(round), lines: [...stop.lines].sort((a, b) => a - b) }))
}

export function normalizeTransit(raw, bounds) {
  if (!Array.isArray(raw.elements) || raw.remark) throw new Error(raw.remark ? 'Transit source could not finish the search' : 'Transit source returned invalid data')
  const lines = new Map()
  const ways = new Map()
  const nodes = new Map()
  const places = []
  const pois = []
  for (const element of raw.elements) {
    const lon = element.lon ?? element.center?.lon, lat = element.lat ?? element.center?.lat
    const kind = element.tags?.shop === 'supermarket' ? 'supermarket' : element.tags?.leisure === 'fitness_centre' ? 'gym' : null
    const category = kind ? null : poiCategory(element.tags)
    if (kind) {
      const brand = typeof element.tags.brand === 'string' && element.tags.brand.trim() ? element.tags.brand.trim() : null
      if (Number.isFinite(lon) && Number.isFinite(lat)) places.push({ kind, name: String(element.tags.name || brand || '').trim(), brand, coordinates: [round(lon), round(lat)] })
    } else if (category) {
      if (Number.isFinite(lon) && Number.isFinite(lat)) pois.push({ category, name: String(element.tags.name || '').trim(), coordinates: [round(lon), round(lat)] })
    } else if (element.type === 'way') ways.set(element.id, element.geometry)
    else if (element.type === 'node') nodes.set(element.id, element)
  }
  const relationNodes = []
  for (const relation of raw.elements) {
    const tags = relation.tags || {}
    const mode = modeMap[tags.route]
    if (relation.type !== 'relation' || !mode) continue
    const operator = tags.operator || tags.network || 'Operator not listed'
    const code = tags.ref || tags.name || String(relation.id)
    const lineId = `osm:${mode}:${tags.network || operator}:${tags.ref || relation.id}`
    if (!lines.has(lineId)) lines.set(lineId, {
      properties: { lineId, code, name: tags.name || [tags.from, tags.to].filter(Boolean).join(' → ') || `${mode} ${code}`, mode, operator,
        night: tags.by_night === 'only' || (mode !== 'train' && /^N\d+[a-z]?$/i.test(code)),
        color: /^#[0-9a-f]{6}$/i.test(tags.colour || '') ? tags.colour : colors[mode],
        sourceUrl: `https://www.openstreetmap.org/relation/${relation.id}` }, paths: [], ways: new Set(),
    })
    const line = lines.get(lineId)
    for (const member of relation.members || []) {
      if (member.type === 'node') { relationNodes.push([member.ref, lineId]); continue }
      const geometry = member.geometry || ways.get(member.ref)
      if (member.type !== 'way' || !Array.isArray(geometry) || /platform|stop/.test(member.role || '') || line.ways.has(member.ref)) continue
      line.ways.add(member.ref)
      // Overpass sends clipped vertices as null: start a new path there.
      let path = []
      const finish = () => {
        const simplified = simplifyPath(path).map(([lon, lat]) => [round(lon), round(lat)])
          .filter((point, index, all) => index === 0 || point[0] !== all[index - 1][0] || point[1] !== all[index - 1][1])
        if (simplified.length > 1) line.paths.push(simplified)
        path = []
      }
      for (const point of geometry) {
        if (!point || !Number.isFinite(point.lon) || !Number.isFinite(point.lat)) { finish(); continue }
        path.push([point.lon, point.lat])
      }
      finish()
    }
  }
  const kept = [...lines.values()].filter((line) => line.paths.length)
  const index = new Map(kept.map((line, position) => [line.properties.lineId, position]))
  const nodeLines = new Map()
  for (const [nodeId, lineId] of relationNodes) {
    if (!index.has(lineId)) continue
    if (!nodeLines.has(nodeId)) nodeLines.set(nodeId, new Set())
    nodeLines.get(nodeId).add(index.get(lineId))
  }
  const features = kept.map((line) => ({ type: 'Feature', properties: line.properties, geometry: { type: 'MultiLineString', coordinates: line.paths } }))
  return { type: 'FeatureCollection', features, stops: groupStops(nodes, nodeLines), places, pois, bounds, source: 'OpenStreetMap',
    sourceUrl: 'https://www.openstreetmap.org/copyright', dataTimestamp: raw.osm3s?.timestamp_osm_base || null }
}

export function createTransitService({ fetchImpl = fetch, cacheDir, now = Date.now, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  endpoint = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter', concurrency = 2 } = {}) {
  const caches = Object.fromEntries(transitParts.map((part) =>
    [part, createLocationCache({ namespace: `${part}-v2`, ttlMs: 7 * 24 * HOUR, staleMs: 30 * 24 * HOUR, cacheDir, now, revalidate: true })]))
  const queue = []
  let active = 0
  let blockedUntil = 0
  function drain() {
    while (active < concurrency && queue.length) {
      const { task, resolve, reject } = queue.shift()
      active++
      task().then(resolve, reject).finally(() => { active--; drain() })
    }
  }
  function schedule(task) {
    if (queue.length >= 24) return Promise.reject(new Error('Transit search is busy. Please retry shortly.'))
    return new Promise((resolve, reject) => { queue.push({ task, resolve, reject }); drain() })
  }

  async function slotDelayMs() {
    try {
      const response = await fetchImpl(endpoint.replace(/interpreter\/?$/, 'status'), { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(10_000) })
      const seconds = response.ok ? slotWaitSeconds(await response.text()) : null
      return Math.min(60, (seconds ?? 10) + 1) * 1000
    } catch { return 10_000 }
  }

  function collect(part, bounds) {
    return schedule(async () => {
      if (now() < blockedUntil) throw new Error('Transit source is busy. Please retry in a minute.')
      for (let attempt = 0; ; attempt++) {
        const response = await fetchImpl(endpoint, {
          method: 'POST', body: new URLSearchParams({ data: partQuery(part, bounds) }),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(100_000),
        })
        if (response.status === 429 && attempt < 2) { await wait(await slotDelayMs()); continue }
        if (response.status === 429 || response.status === 406) blockedUntil = now() + 30_000
        const raw = await readJson(response, 250_000_000)
        if (part === 'parks') return { parks: normalizeParks(raw) }
        const data = normalizeTransit(raw, bounds)
        return part === 'rail' ? { ...data, busLines: countBusLines(raw) } : data
      }
    })
  }

  const shape = { rail: ['features', 'stops', 'busLines'], bus: ['features', 'stops'], chains: ['places'], pois: ['pois'], parks: ['parks'] }
  return async (part, longitude, latitude) => {
    if (!transitParts.includes(part)) throw new Error('Unknown transit part')
    const { key, bounds } = transitArea(longitude, latitude)
    const result = await caches[part](key, () => collect(part, bounds))
    return { ...Object.fromEntries(shape[part].map((field) => [field, result.data[field]])), part, area: key, bounds,
      updatedAt: result.updatedAt, stale: result.stale, cached: result.cached }
  }
}
