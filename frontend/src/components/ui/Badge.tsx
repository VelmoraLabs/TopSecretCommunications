import type { ReactNode } from 'react'
export type BadgeTone = 'purple' | 'blue' | 'green' | 'amber' | 'neutral'
export default function Badge({
  children,
  tone = 'purple',
  dot = false,
}: {
  children: ReactNode
  tone?: BadgeTone
  dot?: boolean
}) {
  return (
    <span className={`badge badge--${tone}`}>
      {dot && <span className="badge-dot" aria-hidden="true" />}
      {children}
    </span>
  )
}
