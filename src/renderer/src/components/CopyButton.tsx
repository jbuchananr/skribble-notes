import { useEffect, useRef, useState } from 'react'
import { Copy, Check } from './Icons'

/** Copies text to the clipboard and shows a check for a moment. Stops the click so it can sit inside a clickable card. */
export function CopyButton({ text, title = 'Copy', className = 'icon-btn', label }: { text: () => string; title?: string; className?: string; label?: string }) {
  const [done, setDone] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <button
      className={`${className} copy-btn ${done ? 'copied' : ''}`}
      title={done ? 'Copied' : title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={async (e) => {
        e.stopPropagation()
        await navigator.clipboard.writeText(text())
        setDone(true)
        clearTimeout(timer.current)
        timer.current = setTimeout(() => setDone(false), 1400)
      }}
    >
      {done ? <Check /> : <Copy />}{label && <span>{done ? 'Copied' : label}</span>}
    </button>
  )
}
