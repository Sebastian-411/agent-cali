import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { api } from '../api/client'
import type { Report } from '../api/types'
import { Badge, ErrorBox, formatDate } from '../components/common'

const STATUS_FILTERS = [
  { label: 'Todos', value: '' },
  { label: 'En verificación', value: 'PENDING_VERIFICATION,VOTING' },
  { label: 'Respaldados', value: 'SUPPORTED,VERIFIED' },
  { label: 'Desmentidos', value: 'DISPUTED' },
  { label: 'Sin confirmar', value: 'UNCONFIRMED' },
  { label: 'Descartados', value: 'DISMISSED' },
]

export default function ReportsPage() {
  const [reports, setReports] = useState<Report[]>([])
  const [status, setStatus] = useState('')
  const [priority, setPriority] = useState('')
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    const params = new URLSearchParams()
    if (status) params.set('status', status)
    if (priority) params.set('priority', priority)
    params.set('limit', '100')

    api<{ reports: Report[] }>(`/api/reports?${params}`)
      .then((r) => setReports(r.reports))
      .catch(setError)
  }, [status, priority])

  return (
    <>
      <h2>Reportes</h2>
      <p className="subtitle">
        Cada reporte consolida varios mensajes sobre un mismo hecho. Ninguno es una afirmación
        verificada del sistema.
      </p>

      <ErrorBox error={error} />

      <div className="toolbar">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUS_FILTERS.map((f) => (
            <option key={f.label} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="">Toda prioridad</option>
          <option value="CRITICAL">CRITICAL</option>
          <option value="HIGH">HIGH</option>
          <option value="MEDIUM">MEDIUM</option>
          <option value="LOW">LOW</option>
        </select>
        <span className="muted">{reports.length} reportes</span>
      </div>

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Afirmación</th>
              <th>Categoría</th>
              <th>Prioridad</th>
              <th>Estado</th>
              <th>Fuentes</th>
              <th>Sí / No / No sé</th>
              <th>Detectado</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((report) => (
              <tr key={report.id}>
                <td>
                  <Link to={`/reportes/${report.id}`}>#{report.id}</Link>
                </td>
                <td style={{ maxWidth: 380 }}>
                  <Link to={`/reportes/${report.id}`}>{report.title}</Link>
                  {report.scamFlag && (
                    <div className="muted" style={{ fontSize: 12 }}>
                      ⚠️ solicitud de dinero no verificada
                    </div>
                  )}
                  {report.zone && (
                    <div className="muted" style={{ fontSize: 12 }}>
                      📍 {report.zone}
                    </div>
                  )}
                </td>
                <td>{report.category}</td>
                <td>
                  <Badge kind="p" value={report.priority} />
                </td>
                <td>
                  <Badge kind="s" value={report.status} />
                </td>
                <td>
                  {report.independentSources} de {report.messageCount} msg
                  <div className="muted" style={{ fontSize: 12 }}>
                    {report.distinctGroups} grupo(s)
                  </div>
                </td>
                <td>
                  {report.votesYes} / {report.votesNo} / {report.votesUnknown}
                </td>
                <td className="muted">{formatDate(report.createdAt)}</td>
              </tr>
            ))}
            {reports.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  Sin reportes para este filtro.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
