import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

export default function Popover({ label, active, children }: { label: ReactNode, active?: boolean, children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [shift, setShift] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close) }
  }, [open])
  useLayoutEffect(() => {
    if (!open || !panel.current) { setShift(0); return }
    const edge = Math.min(window.innerWidth, panel.current.closest('.panel')?.getBoundingClientRect().right ?? Infinity) - 8
    setShift(Math.min(0, edge - panel.current.getBoundingClientRect().right))
  }, [open])
  return <div className="popover" ref={root}>
    <button type="button" className={`pill ${active ? 'on' : ''}`} aria-expanded={open} onClick={() => setOpen(!open)}>{label}<ChevronDown size={14} aria-hidden /></button>
    {open && <div className="popover-panel" ref={panel} style={shift ? { transform: `translateX(${shift}px)` } : undefined}>{children}</div>}
  </div>
}
