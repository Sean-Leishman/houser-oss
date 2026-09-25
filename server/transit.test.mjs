import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { countBusLines, createTransitService, normalizeParks, normalizeTransit, partQuery, simplifyPath, slotWaitSeconds, transitArea } from './transit.mjs'

const raw = { elements: [
  { type: 'relation', id: 1, tags: { type: 'route', route: 'tram', ref: 'M1', network: 'City', name: 'City tram' },
    members: [{ type: 'way', ref: 10 }, { type: 'node', ref: 100, role: 'stop' }, { type: 'node', ref: 101, role: 'platform' }] },
  { type: 'relation', id: 2, tags: { type: 'route', route: 'tram', ref: 'M1', network: 'City' }, members: [{ type: 'way', ref: 10 }] },
  { type: 'relation', id: 3, tags: { type: 'route', route: 'bus', ref: 'N5', network: 'City' }, members: [{ type: 'way', ref: 10 }, { type: 'node', ref: 102, role: 'stop' }] },
  { type: 'way', id: 10, geometry: [{ lat: 52.5, lon: 13.4 }, { lat: 52.51, lon: 13.41 }, null, { lat: 52.52, lon: 13.42 }, { lat: 52.53, lon: 13.43 }] },
  { type: 'node', id: 100, lat: 52.5, lon: 13.4, tags: { public_transport: 'stop_position', name: 'Market' } },
  { type: 'node', id: 101, lat: 52.5005, lon: 13.4005, tags: { public_transport: 'platform', name: 'Market' } },
  { type: 'node', id: 102, lat: 52.5003, lon: 13.4002, tags: { highway: 'bus_stop', name: 'Berlin, Market' } },
  { type: 'node', id: 200, lat: 52.51, lon: 13.41, tags: { shop: 'supermarket', name: 'Corner Grocer' } },
  { type: 'way', id: 201, center: { lat: 52.52, lon: 13.42 }, tags: { shop: 'supermarket', brand: 'Big Shop' } },
  { type: 'node', id: 202, lat: 52.515, lon: 13.415, tags: { leisure: 'fitness_centre', name: 'Big Gym Mitte', brand: 'Big Gym' } },
  { type: 'node', id: 203, lat: 52.516, lon: 13.416, tags: { amenity: 'cafe', name: 'Corner Café' } },
  { type: 'way', id: 204, center: { lat: 52.517, lon: 13.417 }, tags: { amenity: 'school', name: 'North School' } },
] }

test('route variants share a line and clipped geometry never joins across missing points', () => {
  const data = normalizeTransit(raw, [13, 52, 14, 53])
  assert.equal(data.features.length, 2)
  assert.equal(data.features[0].geometry.coordinates.length, 2)
  assert.equal(data.features[0].properties.code, 'M1')
  assert.equal(data.features[0].properties.mode, 'tram')
  assert.throws(() => transitArea(NaN, 52))
  assert.throws(() => transitArea(13, 100))
  assert.notEqual(transitArea(13.4, 52.5).key, transitArea(139.69, 35.69).key)
  const { bounds } = transitArea(4.8952, 52.3702)
  assert.deepEqual([bounds[1], bounds[3]], [52.25, 52.45])
  assert.ok(bounds[0] < 4.9 - .08 / Math.cos(52.35 * Math.PI / 180) - .02)
})

test('stop positions, platforms and town-prefixed names merge into one stop with all its lines', () => {
  const data = normalizeTransit(raw, [13, 52, 14, 53])
  assert.equal(data.stops.length, 1)
  assert.equal(data.stops[0].name, 'Market')
  assert.deepEqual(data.stops[0].lines, [0, 1])
  assert.equal(data.features[1].properties.night, true)
  assert.equal(data.features[0].properties.night, false)
  assert.deepEqual(data.places.map(({ kind, name, brand }) => [kind, name, brand]),
    [['supermarket', 'Corner Grocer', null], ['supermarket', 'Big Shop', 'Big Shop'], ['gym', 'Big Gym Mitte', 'Big Gym']])
  assert.deepEqual(data.pois.map(({ category, name }) => [category, name]), [['food', 'Corner Café'], ['schools', 'North School']])
})

test('simplification drops vertices within tolerance and keeps real corners', () => {
  const straight = [[13.4, 52.5], [13.40001, 52.500001], [13.40002, 52.5], [13.40003, 52.500001], [13.4004, 52.5]]
  assert.deepEqual(simplifyPath(straight), [[13.4, 52.5], [13.4004, 52.5]])
  const corner = [[13.4, 52.5], [13.401, 52.5], [13.401, 52.501]]
  assert.equal(simplifyPath(corner).length, 3)
})

test('parks join their ways into closed rings, with each hole in the park around it', () => {
  const at = (lon, lat) => ({ lon, lat })
  const parks = normalizeParks({ elements: [
    { type: 'way', id: 1, geometry: [at(13.4, 52.5), at(13.401, 52.5), at(13.401, 52.501), at(13.4, 52.501), at(13.4, 52.5)] },
    { type: 'way', id: 2, geometry: [at(13.5, 52.5), at(13.501, 52.5)] },
    { type: 'relation', id: 3, members: [
      { type: 'way', role: 'outer', geometry: [at(13.41, 52.5), at(13.42, 52.5), at(13.42, 52.51)] },
      { type: 'way', role: 'outer', geometry: [at(13.41, 52.5), at(13.41, 52.51), at(13.42, 52.51)] },
      { type: 'way', role: 'inner', geometry: [at(13.414, 52.504), at(13.416, 52.504), at(13.416, 52.506), at(13.414, 52.506), at(13.414, 52.504)] },
    ] },
  ] })
  assert.deepEqual(parks.map((park) => park.length), [1, 2])
  assert.equal(parks[1][0].length, 5)
  const area = (ring) => ring.slice(1).reduce((sum, point, i) => sum + ring[i][0] * point[1] - point[0] * ring[i][1], 0)
  assert.ok(area(parks[0][0]) > 0 && area(parks[1][0]) > 0 && area(parks[1][1]) < 0)
  assert.match(partQuery('parks', [13, 52, 14, 53]), /\["access"!~"\^\(private\|no\)\$"\]/)
})

const partOf = (init) => {
  const query = new URLSearchParams(init.body).get('data')
  return query.includes('subway') ? 'rail' : query.includes('bus|trolleybus') ? 'bus' : query.includes('supermarket') ? 'chains' : query.includes('park|garden') ? 'parks' : 'pois'
}

test('an area loads in parts, each only when asked for and then from the cache', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'houser-transit-'))
  const parts = []
  const fetchImpl = async (url, init) => { parts.push(partOf(init)); return Response.json(raw) }
  try {
    const get = createTransitService({ cacheDir, fetchImpl })
    const [rail] = await Promise.all([get('rail', 13.4, 52.5), get('rail', 13.4, 52.5)])
    assert.equal(rail.features.length, 2)
    assert.equal(rail.places, undefined)
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.deepEqual(parts, ['rail'])
    const chains = await get('chains', 13.4, 52.5)
    assert.equal(chains.places.length, 3)
    assert.equal(chains.features, undefined)
    assert.equal((await createTransitService({ cacheDir, fetchImpl })('rail', 13.4, 52.5)).cached, true)
    assert.equal(parts.filter((part) => part === 'rail').length, 1)
    const parks = await get('parks', 13.4, 52.5)
    assert.deepEqual([parks.parks, parks.features, parts.at(-1)], [[], undefined, 'parks'])
    assert.match(partQuery('pois', [13, 52, 14, 53]), /amenity/)
    assert.match(partQuery('rail', [13, 52, 14, 53]), /bus\|trolleybus\)\$"\]\(52,13,53,14\);out tags;$/)
    assert.equal(rail.busLines, 1)
    assert.equal(countBusLines({ elements: [{ type: 'relation', id: 9, tags: { route: 'bus', ref: '5' } }, { type: 'relation', id: 10, tags: { route: 'bus', ref: '5' } },
      { type: 'relation', id: 11, tags: { route: 'trolleybus', ref: '6' } }, { type: 'relation', id: 12, tags: { route: 'tram', ref: '7' } }] }), 2)
  } finally { await rm(cacheDir, { recursive: true, force: true }) }
})

test('a busy Overpass is waited for, using its status page, before the query is retried', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'houser-transit-'))
  const waits = []
  let queries = 0
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/status')) return new Response('Rate limit: 2\n0 slots available now.\nSlot available after: 2026-09-25T10:00:07Z, in 7 seconds.\n')
    queries++
    return queries === 1 ? new Response('', { status: 429 }) : Response.json(raw)
  }
  try {
    const rail = await createTransitService({ cacheDir, fetchImpl, wait: async (ms) => { waits.push(ms) } })('bus', 13.4, 52.5)
    assert.equal(queries, 2)
    assert.deepEqual(waits, [8000])
    assert.equal(rail.features.length, 2)
    assert.equal(slotWaitSeconds('Rate limit: 4\n3 slots available now.\n'), 0)
    assert.equal(slotWaitSeconds('unexpected'), null)
  } finally { await rm(cacheDir, { recursive: true, force: true }) }
})
