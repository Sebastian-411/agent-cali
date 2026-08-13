import { useEffect, useState } from 'react'
import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet'
import { Link } from 'react-router-dom'

import { api } from '../api/client'
import type { MapPoint, Summary } from '../api/types'
import { Card, ErrorBox } from '../components/common'

export default function DashboardPage() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [points, setPoints] = useState<MapPoint[]>([])
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    const load = () => {
      api<Summary>('/api/dashboard/summary').then(setSummary).catch(setError)
      api<{ points: MapPoint[] }>('/api/dashboard/map')
        .then((r) => setPoints(r.points))
        .catch(setError)
    }
    load()
    const timer = setInterval(load, 30_000)
    return () => clearInterval(timer)
  }, [])

  return (
    <>
      <h2>Panel</h2>
      <p className="subtitle">
        Estado general del monitoreo. Los porcentajes reflejan confirmación comunitaria, no
        verificación oficial.
      </p>

      <ErrorBox error={error} />

      <div className="cards">
        <Card label="🔴 Críticos" value={summary?.reports.critical ?? '—'} />
        <Card label="🟠 Alta prioridad" value={summary?.reports.high ?? '—'} />
        <Card label="🟡 En verificación" value={summary?.reports.inVerification ?? '—'} />
        <Card label="🟢 Respaldados" value={summary?.reports.supported ?? '—'} />
        <Card label="⚫ Descartados" value={summary?.reports.dismissed ?? '—'} />
      </div>

      <div className="cards">
        <Card label="Mensajes 24h" value={summary?.messages.last24h ?? '—'} />
        <Card label="Relevantes" value={summary?.messages.relevant ?? '—'} />
        <Card label="En cola" value={summary?.messages.pending ?? '—'} />
        <Card
          label="Grupos monitoreados"
          value={
            summary ? `${summary.groups.enabled} / ${summary.groups.total}` : '—'
          }
        />
      </div>

      <div className="panel">
        <h3>Mapa</h3>
        {points.length === 0 ? (
          <p className="muted">
            Aún no hay reportes con una zona reconocida. El mapa sólo ubica zonas que el agente
            logra asociar al gazetteer de Cali y el Valle.
          </p>
        ) : (
          <div className="map">
            <MapContainer center={[3.4516, -76.532]} zoom={10} style={{ height: '100%' }}>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              />
              {points.map((point) => (
                <Marker key={point.id} position={[point.lat, point.lng]}>
                  <Popup>
                    <strong>#{point.id}</strong> {point.title}
                    <br />
                    {point.category} · {point.priority} · {point.status}
                    <br />
                    <Link to={`/reportes/${point.id}`}>Ver reporte</Link>
                  </Popup>
                </Marker>
              ))}
            </MapContainer>
          </div>
        )}
      </div>

      <div className="panel">
        <h3>Categorías en las últimas 24 horas</h3>
        {!summary || summary.reports.byCategory.length === 0 ? (
          <p className="muted">Sin datos todavía.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Categoría</th>
                <th>Reportes</th>
              </tr>
            </thead>
            <tbody>
              {summary.reports.byCategory.map((row) => (
                <tr key={row.category}>
                  <td>{row.category}</td>
                  <td>{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
