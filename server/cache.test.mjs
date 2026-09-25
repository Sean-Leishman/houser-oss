import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createLocationCache } from './cache.mjs'

test('an out-of-date result is answered at once and refreshed in the background', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'houser-cache-'))
  let time = 1_000, loads = 0
  try {
    const cache = createLocationCache({ namespace: 'test', ttlMs: 100, staleMs: 10_000, cacheDir, now: () => time, revalidate: true })
    const loader = async () => ({ version: ++loads })
    assert.equal((await cache('area', loader)).data.version, 1)
    time += 500
    const stale = await cache('area', loader)
    assert.equal(stale.data.version, 1)
    assert.equal(stale.stale, true)
    await new Promise((resolve) => setTimeout(resolve, 20))
    const fresh = await cache('area', loader)
    assert.equal(fresh.data.version, 2)
    assert.equal(fresh.stale, false)
    assert.equal(loads, 2)
  } finally { await rm(cacheDir, { recursive: true, force: true }) }
})
