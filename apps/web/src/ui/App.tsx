import { ConfigProvider } from 'antd'
import { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './AppShell'
import { ComparePage } from './pages/ComparePage'
import { ImportExecutePage } from './pages/ImportExecutePage'
import { getAntdThemeConfig, loadThemeMode, saveThemeMode, type ThemeMode } from './theme'
import { RequireAuth } from './RequireAuth'
import { LoginPage } from './pages/LoginPage'

export function App() {
  const [themeMode, setThemeMode] = useState<ThemeMode>('ops')

  useEffect(() => {
    setThemeMode(loadThemeMode())
  }, [])

  const setMode = (m: ThemeMode) => {
    setThemeMode(m)
    saveThemeMode(m)
  }

  return (
    <ConfigProvider theme={getAntdThemeConfig(themeMode)}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route element={<RequireAuth />}>
            <Route element={<AppShell themeMode={themeMode} setThemeMode={setMode} />}>
              <Route path="/compare" element={<ComparePage />} />
              <Route path="/import" element={<ImportExecutePage />} />
              <Route path="/" element={<Navigate to="/compare" replace />} />
              <Route path="*" element={<Navigate to="/compare" replace />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </ConfigProvider>
  )
}
