import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { api } from '../api/client'
import { ErrorBox } from '../components/common'

interface InstanceState {
  instance: string
  state: { instance?: { state?: string }; state?: string } | null
  webhook: { url?: string; enabled?: boolean; events?: string[] } | null
}

function readState(payload: InstanceState['state']): string {
  return payload?.instance?.state ?? payload?.state ?? 'desconocido'
}

const STATE_LABEL: Record<string, string> = {
  open: '🟢 conectado',
  connecting: '🟡 esperando vinculación',
  close: '⚫ desconectado',
}

export default function ConnectionPage() {
  const [info, setInfo] = useState<InstanceState | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [pairingCode, setPairingCode] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const connected = readState(info?.state ?? null) === 'open'

  const load = useCallback(() => {
    api<InstanceState>('/api/admin/instance').then(setInfo).catch(setError)
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(load, 10_000)
    return () => clearInterval(timer)
  }, [load])

  // El QR expira cada pocos segundos: mientras no esté vinculado, lo refrescamos.
  useEffect(() => {
    if (connected) {
      setQr(null)
      return
    }
    const fetchQr = () => {
      api<{ qr: string | null; code: string | null }>('/api/admin/instance/qr')
        .then((r) => {
          setQr(r.qr)
          setPairingCode(r.code)
        })
        .catch(() => {})
    }
    fetchQr()
    const timer = setInterval(fetchQr, 20_000)
    return () => clearInterval(timer)
  }, [connected])

  const act = async (path: string, ok: string) => {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const result = await api<Record<string, unknown>>(path, { method: 'POST' })
      setMessage(`${ok} ${JSON.stringify(result)}`)
      load()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h2>Conexión</h2>
      <p className="subtitle">
        Vincula el WhatsApp del proyecto, apunta el webhook a este backend y trae los grupos.
        Es el orden en que hay que hacerlo la primera vez.
      </p>

      <ErrorBox error={error} />
      {message && <div className="notice">{message}</div>}

      <div className="panel">
        <h3>1 · WhatsApp</h3>
        <p>
          Instancia <code>{info?.instance ?? '—'}</code> ·{' '}
          {STATE_LABEL[readState(info?.state ?? null)] ?? readState(info?.state ?? null)}
        </p>

        {connected ? (
          <p className="muted">
            Ya está vinculado. Recuerda que este número debe estar dentro de los grupos que vas a
            monitorear y del grupo central.
          </p>
        ) : (
          <>
            <p className="muted">
              Abre WhatsApp en el teléfono del proyecto → Dispositivos vinculados → Vincular un
              dispositivo. El código se renueva solo cada 20 segundos.
            </p>
            {qr ? (
              <img
                src={qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`}
                alt="Código QR para vincular WhatsApp"
                style={{ width: 260, height: 260, background: '#fff', padding: 8, borderRadius: 8 }}
              />
            ) : (
              <p className="muted">Generando código…</p>
            )}
            {pairingCode && (
              <p>
                ¿No puedes escanear? Código de vinculación: <strong>{pairingCode}</strong>
              </p>
            )}
          </>
        )}
      </div>

      <div className="panel">
        <h3>2 · Webhook</h3>
        {info?.webhook?.url ? (
          <p>
            Apuntado a <code>{info.webhook.url}</code>{' '}
            {info.webhook.enabled ? '🟢' : '⚫ deshabilitado'}
            <br />
            <span className="muted">Eventos: {(info.webhook.events ?? []).join(', ') || '—'}</span>
          </p>
        ) : (
          <p className="muted">Sin webhook configurado: el backend no recibirá mensajes.</p>
        )}
        <button
          disabled={busy}
          onClick={() => act('/api/admin/instance/webhook', 'Webhook configurado:')}
        >
          Apuntar el webhook a este backend
        </button>
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          Usa <code>PUBLIC_URL</code> del backend. Ojo: Evolution admite un solo webhook por
          instancia, así que esta instancia debe ser exclusiva del proyecto.
        </p>
      </div>

      <div className="panel">
        <h3>3 · Grupos</h3>
        <p className="muted">
          Trae los grupos que ve este WhatsApp y los registra <strong>deshabilitados</strong>.
          Ninguno se lee hasta que lo habilites en <Link to="/grupos">Grupos</Link>.
        </p>
        <button disabled={busy} onClick={() => act('/api/groups/sync', 'Grupos sincronizados:')}>
          Traer grupos de la instancia
        </button>
      </div>
    </>
  )
}
