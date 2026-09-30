import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createRoutingService, decodePolyline6, elevationChange, sampleShape } from './routing.mjs'

const destination = [4.9117, 52.3773]
const origins = Array.from({ length: 60 }, (_, index) => [4.85 + index * .001, 52.35])

function valhalla(requests) {
  return async (url, init) => {
    const body = JSON.parse(init.body)
    requests.push({ path: new URL(url).pathname, body, headers: init.headers })
    if (new URL(url).pathname === '/sources_to_targets') {
      return Response.json({ sources_to_targets: body.sources.map((source, index) => [{ time: index === 1 ? null : 600 + index, distance: 2.5 }]) })
    }
    if (new URL(url).pathname === '/isochrone') {
      return Response.json({ type: 'FeatureCollection', features: [30, 15].map((contour) => ({ type: 'Feature', properties: { contour, metric: 'time' },
        geometry: { type: 'Polygon', coordinates: [[[4.9, 52.37], [4.92, 52.37], [4.92, 52.39], [4.9, 52.37]]] } })) })
    }
    if (new URL(url).pathname === '/height') return Response.json({ height: [10, 10.5, 24, 23, 12] })
    return Response.json({ trip: { summary: { time: 1221, length: 4.7 }, legs: [{ shape: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' }] } })
  }
}

test('matrix requests are batched, cached per destination and survive a restart', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'houser-routing-'))
  const requests = []
  try {
    const routing = createRoutingService({ cacheDir, fetchImpl: valhalla(requests), spacingMs: 0, clientId: 'houser-test' })
    const first = await routing.durations({ mode: 'bike', to: destination, from: origins })
    assert.equal(requests.length, 2)
    assert.equal(requests[0].body.sources.length, 50)
    assert.equal(requests[0].body.costing, 'bicycle')
    assert.equal(requests[0].headers['X-Client-Id'], 'houser-test')
    assert.equal(first.durations.length, 60)
    assert.equal(first.durations[0], 600)
    assert.equal(first.durations[1], null)

    const again = createRoutingService({ cacheDir, fetchImpl: valhalla(requests), spacingMs: 0 })
    const cached = await again.durations({ mode: 'bike', to: destination, from: [...origins, [4.95, 52.36]] })
    assert.equal(requests.length, 3, 'only the new origin is requested')
    assert.equal(requests[2].body.sources.length, 1)
    assert.equal(cached.durations[0], 600)
  } finally { await rm(cacheDir, { recursive: true, force: true }) }
})

test('an unreadable matrix cache starts fresh instead of failing', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'houser-routing-'))
  const requests = []
  try {
    const id = createHash('sha256').update(`walk:${destination.map((value) => value.toFixed(4)).join(',')}`).digest('hex').slice(0, 24)
    await writeFile(join(cacheDir, `matrix-v1-${id}.json`), '{not json', 'utf8')
    const routing = createRoutingService({ cacheDir, fetchImpl: valhalla(requests), spacingMs: 0 })
    const result = await routing.durations({ mode: 'walk', to: destination, from: origins.slice(0, 2) })
    assert.equal(requests.length, 1)
    assert.equal(result.durations[0], 600)
  } finally { await rm(cacheDir, { recursive: true, force: true }) }
})

test('reach areas keep polygons with their minutes, and routes decode their shape', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'houser-routing-'))
  const requests = []
  try {
    const routing = createRoutingService({ cacheDir, fetchImpl: valhalla(requests), spacingMs: 0 })
    const reach = await routing.reach({ mode: 'walk', at: destination })
    assert.deepEqual(reach.features.map((feature) => feature.properties.minutes), [30, 15])
    assert.equal(requests[0].body.costing, 'pedestrian')
    assert.deepEqual(requests[0].body.contours.map((contour) => contour.time), [15, 30, 45, 60])
    await routing.reach({ mode: 'walk', at: destination })
    assert.equal(requests.length, 1)

    const route = await routing.route({ mode: 'car', from: origins[0], to: destination })
    assert.equal(route.duration, 1221)
    assert.equal(route.geometry.type, 'LineString')
    assert.equal(requests[1].body.costing, 'auto')
  } finally { await rm(cacheDir, { recursive: true, force: true }) }
})

test('polyline6 decoding matches the reference example', () => {
  assert.deepEqual(decodePolyline6('_p~iF~ps|U_ulLnnqC_mqNvxq`@').map(([lon, lat]) => [lon * 10, lat * 10].map((value) => Number(value.toFixed(3)))),
    [[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]])
})

test('elevation ignores DEM jitter, reports no data rather than flat, and is not asked for a car', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'houser-routing-'))
  const requests = []
  try {
    const routing = createRoutingService({ cacheDir, fetchImpl: valhalla(requests), spacingMs: 0 })

    const ride = await routing.route({ mode: 'bike', from: origins[0], to: destination })
    assert.deepEqual(ride.elevation, { ascent: 14, descent: 12 }, '10 -> 10.5 is jitter and is not a climb')
    assert.equal(requests.at(-1).path, '/height')
    assert.equal(requests.at(-1).body.shape.length, 3)

    const drive = await routing.route({ mode: 'car', from: origins[1], to: destination })
    assert.equal(drive.elevation, undefined)
    assert.equal(requests.at(-1).path, '/route', 'a car route asks for no heights')
  } finally { await rm(cacheDir, { recursive: true, force: true }) }
})

test('elevation maths: jitter, gaps and missing coverage', () => {
  assert.deepEqual(elevationChange([0, 1, 0, 1, 0]), { ascent: 0, descent: 0 }, 'sub-threshold wobble is not a hill')
  assert.deepEqual(elevationChange([0, 30, 10]), { ascent: 30, descent: 20 })
  assert.deepEqual(elevationChange([0, null, 30]), { ascent: 30, descent: 0 }, 'a gap is skipped, not treated as sea level')
  assert.equal(elevationChange([null, null]), null, 'no coverage is no data, not flat')
  assert.equal(elevationChange([12]), null)
  assert.deepEqual(elevationChange([0, 1.5, 3], 1), { ascent: 3, descent: 0 }, 'the threshold is tunable')
})

test('a long shape is downsampled to a bounded number of height samples', () => {
  const line = Array.from({ length: 5000 }, (_, index) => [index / 1000, 51])
  const sampled = sampleShape(line)
  assert.equal(sampled.length, 200)
  assert.deepEqual(sampled[0], line[0])
  assert.deepEqual(sampled.at(-1), line.at(-1), 'the far end of the route is still measured')
  assert.equal(sampleShape(line.slice(0, 10)).length, 10)
})
