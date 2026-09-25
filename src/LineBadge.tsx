import { textOn } from './format'
import type { TransitLine } from './types'

const modeNames = { train: 'Train', metro: 'Metro', tram: 'Tram', bus: 'Bus' }

export default function LineBadge({ line }: { line: TransitLine }) {
  const label = line.code.length <= 5 ? line.code : modeNames[line.mode]
  return <span className={`line-badge mode-${line.mode}`} style={{ background: line.color, color: textOn(line.color) }} title={`${modeNames[line.mode]} ${line.code} · ${line.name}`}>{label}</span>
}
