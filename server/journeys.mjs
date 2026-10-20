import { join } from 'node:path'
import { createLocationCache, readJson, USER_AGENT } from './cache.mjs'

const DAY = 86_400_000
const key = ([lon, lat]) => `${lat.toFixed(5)},${lon.toFixed(5)}`

// Times are London local, which is what the TfL Journey Planner takes. "Home" slots run from the
// daily place back to the home: late at night the ride barely changes but the wait does
// (King's Cross -> Dalston: a 22 min ride at 08:30 and at 04:00, with a 33 min wait at 04:00).
export const SLOTS = [
  { id: 'morning', label: 'Weekday 08:30', direction: 'there', weekday: 3, time: '0830' },
  { id: 'evening', label: 'Weekday 22:00', direction: 'home', weekday: 3, time: '2200' },
  { id: 'late', label: 'Weekday night 01:30', direction: 'home', weekday: 4, time: '0130' },
  { id: 'weekend', label: 'Friday night 01:30', direction: 'home', weekday: 6, time: '0130' },
]

// The next date (YYYYMMDD) after today in London that falls on the weekday (0 = Sunday).
export function nextDate(weekday, now = Date.now()) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(now)
  const date = new Date(`${today}T00:00:00Z`)
  do date.setUTCDate(date.getUTCDate() + 1)
  while (date.getUTCDay() !== weekday)
  return date.toISOString().slice(0, 10).replaceAll('-', '')
}

// TfL datetimes are London local without an offset; read both sides the same way.
const minutesOf = (text) => Date.parse(`${text}Z`) / 60_000

export function summarise(journeys, date, time) {
  const asked = minutesOf(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}T${time.slice(0, 2)}:${time.slice(2)}:00`)
  const best = (journeys || []).filter((journey) => journey.arrivalDateTime && Array.isArray(journey.legs))
    .sort((a, b) => minutesOf(a.arrivalDateTime) - minutesOf(b.arrivalDateTime))[0]
  if (!best) return null
  let walk = 0, ride = 0
  const lines = []
  for (const leg of best.legs) {
    const minutes = Number(leg.duration) || 0
    if (leg.mode?.name === 'walking') { walk += minutes; continue }
    ride += minutes
    const name = leg.routeOptions?.[0]?.name || leg.mode?.name
    if (name && !lines.includes(name)) lines.push(name)
  }
  const door = Math.round(minutesOf(best.arrivalDateTime) - asked)
  return { arrive: best.arrivalDateTime.slice(11, 16), door, walk, ride, wait: Math.max(0, door - walk - ride), lines }
}

export function createJourneyService({ baseUrl = process.env.TFL_URL || 'https://api.tfl.gov.uk', appKey = process.env.TFL_APP_KEY,
  fetchImpl = fetch, cacheDir = join(process.cwd(), '.cache'), now = Date.now } = {}) {
  const cache = createLocationCache({ namespace: 'journey-v1', ttlMs: 7 * DAY, staleMs: 7 * DAY, cacheDir, now })

  async function plan(from, to, date, time) {
    const url = new URL(`/Journey/JourneyResults/${key(from)}/to/${key(to)}`, baseUrl)
    url.search = new URLSearchParams({ date, time, timeIs: 'Departing', ...(appKey ? { app_key: appKey } : {}) }).toString()
    const response = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(30_000) })
    // TfL answers a place it cannot match with 300 (pick one of these) or 404; both mean no journey.
    if (response.status === 300 || response.status === 404) return null
    if (!response.ok) throw new Error(`TfL returned HTTP ${response.status}`)
    return summarise((await readJson(response)).journeys, date, time)
  }

  // ponytail: one slot at a time, so a card costs four calls in a row; anonymous TfL use is
  // throttled (about 50 a minute), set TFL_APP_KEY for 500.
  async function journeys({ home, place }) {
    const slots = []
    for (const slot of SLOTS) {
      const date = nextDate(slot.weekday, now())
      const [from, to] = slot.direction === 'there' ? [home, place] : [place, home]
      try {
        const { data } = await cache(`${slot.id}:${date}:${key(from)}:${key(to)}`, async () => ({ journey: await plan(from, to, date, slot.time) }))
        slots.push({ ...slot, date, journey: data.journey })
      } catch (error) {
        slots.push({ ...slot, date, journey: null, error: error.message })
      }
    }
    return { slots, source: 'TfL Journey Planner' }
  }

  return { journeys }
}
