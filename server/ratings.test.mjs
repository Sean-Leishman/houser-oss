import assert from 'node:assert/strict'
import test from 'node:test'
import { createRatingService } from './ratings.mjs'

test('gym ratings need a key, ask Google for the nearest gyms, and stay in memory', async () => {
  assert.equal(await createRatingService({ key: '' }).gyms([-0.069, 51.47]), null)
  const asked = []
  const fetchImpl = async (url, init) => {
    asked.push(JSON.parse(init.body))
    return Response.json({ places: [{ id: 'p1', displayName: { text: 'The Gym' }, rating: 4.4, userRatingCount: 812, location: { latitude: 51.471, longitude: -0.07 }, googleMapsUri: 'https://maps.google.com/?cid=1' }, { id: 'p2' }] })
  }
  const ratings = createRatingService({ key: 'k', fetchImpl })
  const gyms = await ratings.gyms([-0.069, 51.47])
  assert.deepEqual(gyms[0], { id: 'p1', name: 'The Gym', rating: 4.4, reviews: 812, coordinates: [-0.07, 51.471], url: 'https://maps.google.com/?cid=1' })
  assert.deepEqual([gyms[1].name, gyms[1].rating], ['Gym', null])
  assert.deepEqual(asked[0].locationRestriction.circle.center, { latitude: 51.47, longitude: -0.069 })
  await ratings.gyms([-0.069, 51.47])
  assert.equal(asked.length, 1)
})
