import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { cleanListing, createListingService, storeHomes } from './listings.mjs'

const zurich = { city: 'Zürich', center: [8.5417, 47.3769] }
const home = (id, extra = {}) => ({ id, coordinates: [8.53, 47.38], price: 1800, currency: 'CHF', ...extra })

test('stored homes keep what the app can use and drop what it can’t trust', () => {
  const file = { source: 'My list', fetchedAt: Date.parse('2026-09-25T10:00:00Z'), country: 'CH' }
  const clean = cleanListing(home('a', { title: 'Loft', kind: 'apartment', rooms: 3.5, image: 'javascript:alert(1)', sourceUrl: 'http://example.com/a',
    availableFrom: 'soon', furnished: 'yes', extra: 'ignored' }), file)
  assert.deepEqual([clean.title, clean.kind, clean.rooms, clean.image, clean.sourceUrl, clean.availableFrom, clean.furnished, clean.country, clean.source, clean.extra],
    ['Loft', 'apartment', 3.5, '', undefined, undefined, null, 'CH', 'My list', undefined])
  assert.equal(clean.lastSeenAt, '2026-09-25T10:00:00.000Z')
  for (const broken of [home(''), home('b', { coordinates: [200, 47] }), home('c', { price: 0 }), home('d', { currency: 'francs' }), null]) {
    assert.equal(cleanListing(broken, file), null, JSON.stringify(broken))
  }
  assert.equal(cleanListing(home('e', { currency: undefined }), { ...file, currency: 'EUR' }).currency, 'EUR')
})

test('every file in data/ is served for the city’s area, and coverage lists their countries', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'houser-homes-'))
  try {
    const agency = { id: 'agency', name: 'Agency', searchUrl: ([west, south, east, north]) => `https://agency.test/search?bbox=${west},${south},${east},${north}` }
    const homes = createListingService({ dir, connectors: [agency] })
    const empty = await homes.getListings(zurich)
    assert.equal(empty.status, 503)
    assert.match(empty.body.reason, /npm run homes:fetch/)

    await storeHomes(agency, [home('agency:1', { country: 'CH' }), home('agency:2', { country: 'CH', coordinates: [6.1432, 46.2044] })], dir)
    await writeFile(join(dir, 'my-list.json'), JSON.stringify({ source: 'My list', fetchedAt: '2026-09-20T08:00:00Z', country: 'CH',
      listings: [home('mine:1', { coordinates: [8.55, 47.37] }), home('agency:1'), { id: 'broken' }] }))
    await writeFile(join(dir, 'notes.json'), 'not json')

    const found = await homes.getListings(zurich)
    assert.equal(found.status, 200)
    assert.deepEqual(found.body.listings.map((listing) => `${listing.source}:${listing.id}`), ['Agency:agency:1', 'My list:mine:1'])
    assert.deepEqual(found.body.sources.map((source) => [source.name, source.count, Boolean(source.url)]), [['Agency', 1, true], ['My list', 1, false]])
    assert.equal(found.body.updatedAt, Date.parse('2026-09-20T08:00:00Z'))

    const coverage = await homes.coverage()
    assert.deepEqual(coverage.countries, ['CH'])
    assert.deepEqual(coverage.sources.map((source) => [source.file, source.count, source.skipped, Boolean(source.error)]),
      [['agency.json', 2, 0, false], ['my-list.json', 2, 1, false], ['notes.json', 0, 0, true]])
    assert.equal((await homes.getListings({ city: '', center: [8.5, 47.4] })).status, 400)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
