import type { TransitMode } from './types'

export type PlaceCategory = 'shops' | 'food' | 'sport' | 'health' | 'schools' | 'parks'

export const placeCategories: { id: PlaceCategory, label: string, color: string }[] = [
  { id: 'shops', label: 'Shops', color: '#3d8a4c' },
  { id: 'food', label: 'Cafés & food', color: '#c0643a' },
  { id: 'sport', label: 'Sports & pools', color: '#d08a1e' },
  { id: 'health', label: 'Health', color: '#c2405a' },
  { id: 'schools', label: 'Schools', color: '#4b6fb3' },
  { id: 'parks', label: 'Parks', color: '#5c9a4f' },
]

export const transitModes: { id: TransitMode, label: string, color: string }[] = [
  { id: 'train', label: 'Rail', color: '#3b64a8' },
  { id: 'metro', label: 'Metro', color: '#7b5cb8' },
  { id: 'tram', label: 'Tram', color: '#1f8a85' },
  { id: 'bus', label: 'Bus', color: '#c7782f' },
]

export const chainPalette = ['#2e6fd6', '#e0a100', '#7b4fb0', '#1b998b', '#d45bb0', '#6a994e', '#0f7fa8', '#b5651d',
  '#3d5a80', '#8f2d56', '#5a6e1f', '#c2185b', '#00897b', '#9c6b00', '#4f5bd5', '#7a4a2e']
export const independentColor = '#8a857a'

export const REACH_OPTIONS = [15, 30, 45, 60] as const
export type ReachMinutes = typeof REACH_OPTIONS[number]
