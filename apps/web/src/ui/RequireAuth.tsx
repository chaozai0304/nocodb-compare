import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Card, Spin } from 'antd'
import { fetchJson } from './api'

export function RequireAuth() {
  const loc = useLocation()
  const [loading, setLoading] = useState(true)
  const [authed, setAuthed] = useState(false)

  useEffect(() => {
    ;(async () => {
      try {
        await fetchJson('/api/auth/me')
        setAuthed(true)
      } catch {
        setAuthed(false)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  if (loading) {
    return (
      <div style={{ padding: 24, maxWidth: 520, margin: '64px auto' }}>
        <Card style={{ borderRadius: 8 }}>
          <Spin />
        </Card>
      </div>
    )
  }

  if (!authed) {
    return <Navigate to="/login" replace state={{ from: loc.pathname }} />
  }

  return <Outlet />
}
