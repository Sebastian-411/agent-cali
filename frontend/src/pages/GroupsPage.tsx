import { useCallback, useEffect, useState } from 'react'

import { api } from '../api/client'
import type { AvailableGroup, Group } from '../api/types'
import { ErrorBox } from '../components/common'

export default function GroupsPage() {
  const [groups, setGroups] = useState<Group[]>([])
  const [available, setAvailable] = useState<AvailableGroup[]>([])
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    api<{ groups: Group[] }>('/api/groups')
      .then((r) => setGroups(r.groups))
      .catch(setError)
    api<{ groups: AvailableGroup[] }>('/api/groups/available')
      .then((r) => setAvailable(r.groups))
      .catch(() => setAvailable([]))
  }, [])

  useEffect(load, [load])

  const patch = async (id: number, body: Record<string, unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await api(`/api/groups/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
      load()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  const add = async (group: AvailableGroup, role: 'SOURCE' | 'NOTIFICATION') => {
    setBusy(true)
    setError(null)
    try {
      await api('/api/groups', {
        method: 'POST',
        body: JSON.stringify({
          remoteJid: group.remoteJid,
          groupName: group.groupName,
          enabled: true,
          role,
        }),
      })
      load()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  const notMonitored = available.filter(
    (g) => !groups.some((known) => known.remoteJid === g.remoteJid),
  )

  return (
    <>
      <h2>Grupos</h2>
      <p className="subtitle">
        El sistema sólo lee los grupos habilitados aquí. Deshabilitar un grupo detiene la lectura
        de inmediato, sin desconectar WhatsApp.
      </p>

      <ErrorBox error={error} />

      <div className="panel">
        <h3>Grupos registrados</h3>
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Función</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <tr key={group.id}>
                <td>
                  {group.groupName}
                  <div className="muted" style={{ fontSize: 11 }}>
                    {group.remoteJid}
                  </div>
                </td>
                <td>
                  <select
                    value={group.role}
                    disabled={busy}
                    onChange={(e) => patch(group.id, { role: e.target.value })}
                  >
                    <option value="SOURCE">Monitoreado</option>
                    <option value="NOTIFICATION">Grupo central</option>
                  </select>
                </td>
                <td>{group.enabled ? '🟢 activo' : '⚫ ignorado'}</td>
                <td>
                  <button disabled={busy} onClick={() => patch(group.id, { enabled: !group.enabled })}>
                    {group.enabled ? 'Deshabilitar' : 'Habilitar'}
                  </button>
                </td>
              </tr>
            ))}
            {groups.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  Sin grupos registrados. Corre <code>npm run sync:groups</code> en el backend.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {notMonitored.length > 0 && (
        <div className="panel">
          <h3>Grupos disponibles en la instancia</h3>
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Miembros</th>
                <th>Agregar como</th>
              </tr>
            </thead>
            <tbody>
              {notMonitored.map((group) => (
                <tr key={group.remoteJid}>
                  <td>{group.groupName}</td>
                  <td className="muted">{group.size ?? '—'}</td>
                  <td className="row">
                    <button disabled={busy} onClick={() => add(group, 'SOURCE')}>
                      Monitoreado
                    </button>
                    <button disabled={busy} onClick={() => add(group, 'NOTIFICATION')}>
                      Grupo central
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
