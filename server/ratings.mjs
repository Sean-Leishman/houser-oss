import { readJson } from './cache.mjs'

const DAY = 86_400_000

// Google Places (New) Nearby Search, only when GOOGLE_MAPS_KEY is set. Answers are kept in memory for a day,
// not on disk: Google's terms limit storing Places content.
export function createRatingService({ key = process.env.GOOGLE_MAPS_KEY, fetchImpl = fetch, now = Date.now } = {}) {
  const memory = new Map()

  async function gyms([lon, lat]) {
    if (!key) return null
    const id = `${lon.toFixed(4)},${lat.toFixed(4)}`
    const hit = memory.get(id)
    if (hit && now() - hit.at < DAY) return hit.gyms
    const response = await fetchImpl('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST', signal: AbortSignal.timeout(20_000),
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.rating,places.userRatingCount,places.location,places.googleMapsUri' },
      body: JSON.stringify({ includedTypes: ['gym'], maxResultCount: 5, rankPreference: 'DISTANCE',
        locationRestriction: { circle: { center: { latitude: lat, longitude: lon }, radius: 1500 } } }),
    })
    if (!response.ok) throw new Error(`Google Places returned HTTP ${response.status}`)
    const found = ((await readJson(response)).places ?? []).map((place) => ({
      id: place.id, name: place.displayName?.text ?? 'Gym', rating: place.rating ?? null, reviews: place.userRatingCount ?? 0,
      coordinates: [place.location?.longitude, place.location?.latitude], url: place.googleMapsUri ?? null,
    }))
    if (memory.size > 500) memory.delete(memory.keys().next().value)
    memory.set(id, { at: now(), gyms: found })
    return found
  }

  return { gyms, enabled: Boolean(key) }
}
