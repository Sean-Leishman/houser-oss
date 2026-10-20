import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createJourneyService, nextDate, summarise } from './journeys.mjs'

const leg = (mode, duration, name) => ({ mode: { name: mode }, duration, ...(name ? { routeOptions: [{ name }] } : {}) })

test('a journey splits into wait, walk and ride, door to door from the time asked', () => {
  const slow = { arrivalDateTime: '2026-10-22T04:40:00', legs: [leg('walking', 5), leg('bus', 20, 'N38')] }
  const fast = { arrivalDateTime: '2026-10-22T04:34:00', legs: [leg('walking', 2), leg('bus', 3, '214'), leg('walking', 4), leg('bus', 8, 'N38'), leg('walking', 1)] }
  assert.deepEqual(summarise([slow, fast], '20261022', '0400'),
    { arrive: '04:34', door: 34, walk: 7, ride: 11, wait: 16, lines: ['214', 'N38'] }, 'the earliest arrival wins; transfer waits count as waiting')
  assert.equal(summarise([], '20261022', '0400'), null)
})

test('slots fall on the next matching London day, never today', () => {
  const wednesday = Date.parse('2026-10-21T12:00:00Z')
  assert.equal(nextDate(3, wednesday), '20261028')
  assert.equal(nextDate(4, wednesday), '20261022')
  assert.equal(nextDate(6, Date.parse('2026-10-23T23:30:00Z')), '20261031', 'half past midnight on Saturday in London is already Saturday')
})

test('morning goes to the place, night slots come home, and answers are cached', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'houser-journeys-'))
  const asked = []
  const fetchImpl = async (url) => {
    asked.push(new URL(url))
    return Response.json({ journeys: [{ arrivalDateTime: '2026-10-28T09:00:00', legs: [leg('walking', 4), leg('national-rail', 12, 'Southern')] }] })
  }
  try {
    const service = createJourneyService({ cacheDir, fetchImpl, now: () => Date.parse('2026-10-21T12:00:00Z') })
    const home = [-0.069, 51.474], place = [-0.1132, 51.5031]
    const { slots } = await service.journeys({ home, place })
    assert.deepEqual(slots.map((slot) => slot.date), ['20261028', '20261028', '20261022', '20261024'])
    assert.match(asked[0].pathname, /51\.47400,-0\.06900\/to\/51\.50310,-0\.11320$/)
    assert.match(asked[1].pathname, /51\.50310,-0\.11320\/to\/51\.47400,-0\.06900$/)
    assert.equal(asked[0].searchParams.get('time'), '0830')
    assert.deepEqual(slots[0].journey.lines, ['Southern'])
    await service.journeys({ home, place })
    assert.equal(asked.length, 4)
  } finally { await rm(cacheDir, { recursive: true, force: true }) }
})
