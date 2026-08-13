import { useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'

import { clearApiKey, getApiKey, setApiKey } from './api/client'
import ActivityPage from './pages/ActivityPage'
import ConnectionPage from './pages/ConnectionPage'
import DashboardPage from './pages/DashboardPage'
import GroupsPage from './pages/GroupsPage'
import ReportDetailPage from './pages/ReportDetailPage'
import ReportsPage from './pages/ReportsPage'

function Gate({ onReady }: { onReady: () => void }) {
  const [value, setValue] = useState('')
  return (
    <div className="gate">
      <h2>Panel de verificación</h2>
      <p className="muted">Ingresa la clave de administrador para continuar.</p>
      <input
        type="password"
        value={value}
        placeholder="ADMIN_API_KEY"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && value) {
            setApiKey(value)
            onReady()
          }
        }}
      />
      <button
        className="primary"
        disabled={!value}
        onClick={() => {
          setApiKey(value)
          onReady()
        }}
      >
        Entrar
      </button>
    </div>
  )
}

export default function App() {
  const [authed, setAuthed] = useState(Boolean(getApiKey()))

  if (!authed) return <Gate onReady={() => setAuthed(true)} />

  return (
    <div className="layout">
      <nav className="sidebar">
        <h1>
          Monitoreo comunitario
          <small>Verificación colectiva</small>
        </h1>
        <NavLink to="/" end className="nav-link">
          Panel
        </NavLink>
        <NavLink to="/reportes" className="nav-link">
          Reportes
        </NavLink>
        <NavLink to="/grupos" className="nav-link">
          Grupos
        </NavLink>
        <NavLink to="/conexion" className="nav-link">
          Conexión
        </NavLink>
        <NavLink to="/actividad" className="nav-link">
          Actividad del agente
        </NavLink>
        <div className="sidebar-footer">
          <button
            onClick={() => {
              clearApiKey()
              setAuthed(false)
            }}
          >
            Salir
          </button>
        </div>
      </nav>

      <main className="content">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/reportes" element={<ReportsPage />} />
          <Route path="/reportes/:id" element={<ReportDetailPage />} />
          <Route path="/grupos" element={<GroupsPage />} />
          <Route path="/conexion" element={<ConnectionPage />} />
          <Route path="/actividad" element={<ActivityPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}
