import type { ReactNode } from 'react'

import type { Tally } from '../api/types'

export function Badge({ kind, value }: { kind: 'p' | 's'; value: string }) {
  return <span className={`badge ${kind}-${value}`}>{value}</span>
}

export function Card({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="card">
      <div className="value">{value}</div>
      <div className="label">{label}</div>
    </div>
  )
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null
  return <div className="error">{error instanceof Error ? error.message : String(error)}</div>
}

export function VoteBar({ tally }: { tally: Tally }) {
  if (tally.total === 0) return <p className="muted">Sin respuestas todavía.</p>
  return (
    <div>
      <div className="bar">
        <span className="yes" style={{ width: `${tally.yesPct}%` }} />
        <span className="no" style={{ width: `${tally.noPct}%` }} />
        <span className="unknown" style={{ width: `${tally.unknownPct}%` }} />
      </div>
      <div className="row muted" style={{ fontSize: 12, gap: 14 }}>
        <span>✅ Sí {tally.yesPct}%</span>
        <span>❌ No {tally.noPct}%</span>
        <span>🤷 No sé {tally.unknownPct}%</span>
        <span>{tally.total} respuestas</span>
      </div>
    </div>
  )
}

export function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('es-CO', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
