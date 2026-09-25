import { useCallback, useEffect, useState } from 'react'
import type { Listing } from './types'

function read<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key)
    return value == null ? fallback : JSON.parse(value) as T
  } catch { return fallback }
}

function write(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch {}
}

export function useStoredState<T>(key: string, initial: T, valid: (value: unknown) => boolean = () => true) {
  const [value, setValue] = useState<T>(() => {
    const stored = read<unknown>(key, initial)
    return valid(stored) ? stored as T : initial
  })
  useEffect(() => write(key, value), [key, value])
  return [value, setValue] as const
}

export type SavedStatus = 'saved' | 'contacted' | 'viewing' | 'offer' | 'passed'
export const savedStatuses: { id: SavedStatus, label: string }[] = [
  { id: 'saved', label: 'Saved' },
  { id: 'contacted', label: 'Contacted' },
  { id: 'viewing', label: 'Viewing' },
  { id: 'offer', label: 'Offer' },
  { id: 'passed', label: 'Passed' },
]

export interface SavedHome {
  listing: Listing
  status: SavedStatus
  note: string
  savedAt: number
}

const SAVED_KEY = 'houser.saved.v2'
const LEGACY_KEY = 'houser.tracker-status.v1'
const legacyStatus: Record<string, SavedStatus> = { saved: 'saved', applied: 'contacted', viewing: 'viewing', offered: 'offer', rejected: 'passed', gone: 'passed' }

export function useSavedHomes() {
  const [saved, setSaved] = useStoredState<Record<string, SavedHome>>(SAVED_KEY, {}, (value) => Boolean(value) && typeof value === 'object')

  const toggle = useCallback((listing: Listing) => setSaved((current) => {
    const next = { ...current }
    if (next[listing.id]) delete next[listing.id]
    else next[listing.id] = { listing, status: 'saved', note: '', savedAt: Date.now() }
    return next
  }), [setSaved])

  const update = useCallback((id: string, change: Partial<Pick<SavedHome, 'status' | 'note'>>) => setSaved((current) =>
    current[id] ? { ...current, [id]: { ...current[id], ...change } } : current), [setSaved])

  const adoptLegacy = useCallback((listings: Listing[]) => {
    const legacy = read<Record<string, string>>(LEGACY_KEY, {})
    const found = listings.filter((listing) => legacyStatus[legacy[listing.id]])
    if (!found.length) return
    setSaved((current) => {
      const next = { ...current }
      for (const listing of found) if (!next[listing.id]) next[listing.id] = { listing, status: legacyStatus[legacy[listing.id]], note: '', savedAt: Date.now() }
      return next
    })
    for (const listing of found) delete legacy[listing.id]
    write(LEGACY_KEY, legacy)
  }, [setSaved])

  return { saved, toggle, update, adoptLegacy }
}
