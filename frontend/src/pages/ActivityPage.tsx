import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { api } from '../api/client'
import type { ActivityEntry } from '../api/types'
import { ErrorBox, formatDate } from '../components/common'

export default function ActivityPage() {
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  const load = () => {
    api<{ activity: ActivityEntry[] }>('/api/dashboard/activity?limit=200')
      .then((r) => setEntries(r.activity))
      .catch(setError)
  }

  useEffect(() => {
    load()
    const timer = setInterval(load, 20_000)
    return () => clearInterval(timer)
  }, [])

  const runCycle = async () => {
    setBusy(true)
    setError(null)
    try {
      await api('/api/admin/run-cycle', { method: 'POST' })
      load()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h2>Actividad del agente</h2>
      <p className="subtitle">
        Bitácora de auditoría: cada acción relevante del sistema queda registrada aquí.
      </p>

      <ErrorBox error={error} />

      <div className="toolbar">
        <button className="primary" disabled={busy} onClick={runCycle}>
          {busy ? 'Procesando…' : 'Ejecutar ciclo ahora'}
        </button>
        <span className="muted">
          Fuerza clasificación, agrupamiento, publicación y cierre de encuestas.
        </span>
      </div>

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Hora</th>
              <th>Acción</th>
              <th>Entidad</th>
              <th>Actor</th>
              <th>Detalle</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td className="muted">{formatDate(entry.createdAt)}</td>
                <td>{entry.action}</td>
                <td>
                  {entry.entityType === 'report' && entry.entityId ? (
                    <Link to={`/reportes/${entry.entityId}`}>reporte #{entry.entityId}</Link>
                  ) : (
                    <span className="muted">
                      {entry.entityType ?? '—'} {entry.entityId ?? ''}
                    </span>
                  )}
                </td>
                <td>{entry.actor}</td>
                <td style={{ maxWidth: 460 }}>
                  {entry.detail ? <pre>{JSON.stringify(entry.detail)}</pre> : '—'}
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  Sin actividad registrada.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
