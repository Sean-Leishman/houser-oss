import { useState } from 'react'
import { ChevronDown, Layers, X } from 'lucide-react'
import { dailyKinds, OTHER_CHAIN, type ChainCount, type PlaceChoice, type PlaceChoices } from './access'
import { initials, textOn } from './format'
import { independentColor, placeCategories, transitModes, type PlaceCategory } from './layers'
import { placeIcons } from './ListingCard'
import type { DailyKind, TransitMode } from './types'

const chainTitles: Record<DailyKind, string> = { supermarket: 'Supermarkets', gym: 'Gyms' }

interface Props {
  lineModes: TransitMode[]
  places: PlaceCategory[]
  lineCounts: Record<TransitMode, number | null>
  transitState: 'loading' | 'ready' | 'error'
  chains: Record<DailyKind, ChainCount[]>
  chainColor: (kind: DailyKind, chain: string) => string
  choices: PlaceChoices
  collapsed: boolean
  onToggleMode: (mode: TransitMode) => void
  onTogglePlace: (place: PlaceCategory) => void
  onChoose: (kind: DailyKind, choice: PlaceChoice) => void
}

export default function LayerLegend({ lineModes, places, lineCounts, transitState, chains, chainColor, choices, collapsed, onToggleMode, onTogglePlace, onChoose }: Props) {
  const [open, setOpen] = useState(!collapsed)
  const [openChains, setOpenChains] = useState<DailyKind | null>(null)
  if (!open) return <button type="button" className="legend-toggle" onClick={() => setOpen(true)}><Layers size={16} aria-hidden /> Layers</button>

  const toggleChain = (kind: DailyKind, chain: string) => {
    const hidden = choices[kind].hidden
    onChoose(kind, { ...choices[kind], hidden: hidden.includes(chain) ? hidden.filter((item) => item !== chain) : [...hidden, chain] })
  }

  return <div className="legend" role="group" aria-label="Map layers">
    <div className="legend-head"><strong>On the map</strong><button type="button" className="icon-button" aria-label="Hide layers" onClick={() => setOpen(false)}><X size={16} aria-hidden /></button></div>
    <div className="legend-scroll">
      <div className="legend-group">
        <span className="legend-caption">Lines{transitState === 'loading' ? ' · loading…' : transitState === 'error' ? ' · unavailable' : ''}</span>
        {transitModes.map((mode) => <button key={mode.id} type="button" className={`legend-item ${lineModes.includes(mode.id) ? 'on' : ''}`} aria-pressed={lineModes.includes(mode.id)} onClick={() => onToggleMode(mode.id)}>
          <span className="swatch line" style={{ background: mode.color }} />{mode.label}{transitState === 'ready' && lineCounts[mode.id] != null && <small>{lineCounts[mode.id]}</small>}
        </button>)}
      </div>
      <div className="legend-group">
        <span className="legend-caption">Places</span>
        {placeCategories.map((category) => <button key={category.id} type="button" className={`legend-item ${places.includes(category.id) ? 'on' : ''}`} aria-pressed={places.includes(category.id)} onClick={() => onTogglePlace(category.id)}>
          <span className={`swatch ${category.id === 'parks' ? 'area' : 'dot'}`} style={{ background: category.color }} />{category.label}
        </button>)}
      </div>
      <div className="legend-group">
        <span className="legend-caption">Chains</span>
        {dailyKinds.map((kind) => {
          const Icon = placeIcons[kind]
          const hidden = choices[kind].hidden
          const list = chains[kind]
          const shown = list.filter(({ chain }) => !hidden.includes(chain)).length
          const expanded = openChains === kind
          return <div key={kind}>
            <button type="button" className={`legend-item chain-row ${shown ? 'on' : ''}`} aria-expanded={expanded} onClick={() => setOpenChains(expanded ? null : kind)}>
              <Icon size={15} aria-hidden />{chainTitles[kind]}<small>{!list.length ? '' : shown === list.length ? 'all' : `${shown} of ${list.length}`}</small><ChevronDown size={14} className="chevron" aria-hidden />
            </button>
            {expanded && <div className="chain-dropdown">
              {list.length
                ? <>
                  <div className="chain-bulk">
                    <button type="button" className="link-button" disabled={!hidden.length} onClick={() => onChoose(kind, { ...choices[kind], hidden: [] })}>Show all</button>
                    <button type="button" className="link-button" disabled={shown === 0} onClick={() => onChoose(kind, { ...choices[kind], hidden: list.map(({ chain }) => chain) })}>Hide all</button>
                  </div>
                  <div className="chain-options">{list.map(({ chain, count }) => {
                    const color = chain === OTHER_CHAIN ? independentColor : chainColor(kind, chain)
                    return <label key={chain}>
                      <input type="checkbox" checked={!hidden.includes(chain)} onChange={() => toggleChain(kind, chain)} />
                      <span className={`chain-badge ${kind}`} style={{ background: color, color: textOn(color) }}>{chain === OTHER_CHAIN ? '' : initials(chain)}</span>
                      <span className="chain-name">{chain}</span><small>{count}</small>
                    </label>
                  })}</div>
                </>
                : <p className="legend-note">{transitState === 'loading' ? 'Loading places…' : 'None mapped here.'}</p>}
              <label className="walk-toggle">
                <input type="checkbox" checked={choices[kind].walk} disabled={shown === 0} onChange={() => onChoose(kind, { ...choices[kind], walk: !choices[kind].walk })} />
                Only homes within a 10-min walk of one
              </label>
            </div>}
          </div>
        })}
      </div>
    </div>
  </div>
}
