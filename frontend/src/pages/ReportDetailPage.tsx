import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { api } from '../api/client'
import type { ReportDetail } from '../api/types'
import { Badge, ErrorBox, VoteBar, formatDate } from '../components/common'

const CERTAINTY_LABEL: Record<string, string> = {
  RUMOR: 'rumor',
  SEGUNDA_MANO: 'segunda mano',
  TESTIMONIO_DIRECTO: 'testimonio directo',
  EVIDENCIA: 'con evidencia',
}

export default function ReportDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<ReportDetail | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  const load = useCallback(() => {
    api<ReportDetail>(`/api/reports/${id}`).then(setData).catch(setError)
  }, [id])

  useEffect(load, [load])

  const act = async (path: string, body?: unknown) => {
    setBusy(true)
    setError(null)
    try {
      await api(`/api/reports/${id}/${path}`, {
        method: 'POST',
        body: body ? JSON.stringify(body) : undefined,
      })
      load()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  if (!data) {
    return (
      <>
        <ErrorBox error={error} />
        <p className="muted">Cargando…</p>
      </>
    )
  }

  const { report, messages, votes, evidence } = data

  return (
    <>
      <p className="muted">
        <Link to="/reportes">← Reportes</Link>
      </p>
      <h2>
        Reporte #{report.id} <Badge kind="p" value={report.priority} />{' '}
        <Badge kind="s" value={report.status} />
      </h2>
      <p className="subtitle">
        {report.category}
        {report.zone ? ` · 📍 ${report.zone}` : ''}
        {report.occurredApprox ? ` · 🕒 ${report.occurredApprox}` : ''} · detectado{' '}
        {formatDate(report.createdAt)}
      </p>

      <ErrorBox error={error} />

      {report.scamFlag && (
        <div className="notice">
          ⚠️ Se detectó una solicitud de dinero o donación cuya legitimidad no ha sido verificada.
          El sistema no acusa a nadie: sólo señala que la solicitud no está confirmada.
        </div>
      )}

      <div className="panel">
        <h3>Afirmación sometida a verificación</h3>
        <p className="claim">{report.claim}</p>
        <p className="muted" style={{ marginBottom: 0 }}>
          Pregunta de la encuesta: “{report.pollQuestion}”
        </p>
      </div>

      <div className="panel">
        <h3>Confirmación comunitaria</h3>
        <VoteBar tally={report.tally} />
        <p className="muted" style={{ fontSize: 12 }}>
          Nivel de confirmación entre quienes dijeron tener información:{' '}
          {Math.round(report.tally.confidence * 100)}% ({report.tally.informed} respuestas
          informadas). Esto no equivale a verdad.
          {votes.bySource.TEXT ? ` · ${votes.bySource.TEXT} voto(s) por texto` : ''}
          {votes.bySource.POLL ? ` · ${votes.bySource.POLL} por encuesta` : ''}
        </p>
        <p className="muted" style={{ fontSize: 12 }}>
          Encuesta enviada {formatDate(report.pollSentAt)} · cierra {formatDate(report.pollClosesAt)}
        </p>
      </div>

      <div className="panel">
        <h3>Acciones del administrador</h3>
        <div className="row">
          <button disabled={busy || report.status === 'VOTING'} onClick={() => act('publish')}>
            Forzar encuesta
          </button>
          <button disabled={busy || report.status !== 'VOTING'} onClick={() => act('close-poll')}>
            Cerrar encuesta ahora
          </button>
          <button disabled={busy} onClick={() => act('cancel-poll')}>
            Cancelar
          </button>
          <button
            className="primary"
            disabled={busy}
            onClick={() => act('status', { status: 'VERIFIED', note })}
          >
            Marcar VERIFIED
          </button>
          <button disabled={busy} onClick={() => act('status', { status: 'DISMISSED', note })}>
            Marcar DISMISSED
          </button>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <input
            style={{ flex: 1, minWidth: 260 }}
            placeholder="Nota administrativa (queda en el historial)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        {report.adminNote && (
          <p className="muted" style={{ marginBottom: 0 }}>
            Nota actual: {report.adminNote}
          </p>
        )}
      </div>

      <div className="panel">
        <h3>
          Trazabilidad · {messages.length} mensajes · {report.independentSources} fuentes
          independientes · {report.duplicateCount} duplicados
        </h3>
        <table>
          <thead>
            <tr>
              <th>Hora</th>
              <th>Grupo</th>
              <th>Fuente</th>
              <th>Certeza</th>
              <th>Mensaje</th>
            </tr>
          </thead>
          <tbody>
            {messages.map((message) => (
              <tr key={message.id} className={message.isDuplicate ? 'dup' : undefined}>
                <td className="muted">{formatDate(message.sentAt)}</td>
                <td>{message.groupName ?? '—'}</td>
                <td className="muted">{message.source}</td>
                <td>
                  {CERTAINTY_LABEL[message.certainty ?? ''] ?? message.certainty ?? '—'}
                  {message.isDuplicate && (
                    <div className="muted" style={{ fontSize: 11 }}>
                      duplicado
                    </div>
                  )}
                </td>
                <td style={{ maxWidth: 460 }}>{message.content}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          “Fuente” es un identificador seudónimo. El sistema no almacena ni muestra números de
          teléfono.
        </p>
      </div>

      {evidence.length > 0 && (
        <div className="panel">
          <h3>Evidencia aportada</h3>
          <table>
            <thead>
              <tr>
                <th>Hora</th>
                <th>Tipo</th>
                <th>Fuente</th>
                <th>Contenido</th>
              </tr>
            </thead>
            <tbody>
              {evidence.map((item) => (
                <tr key={item.id}>
                  <td className="muted">{formatDate(item.createdAt)}</td>
                  <td>{item.kind}</td>
                  <td className="muted">{item.source}</td>
                  <td>{item.content ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
