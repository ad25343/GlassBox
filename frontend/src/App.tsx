import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from '@/components/layout/Layout'
import DashboardPage from '@/pages/DashboardPage'
import TracesPage from '@/pages/TracesPage'
import ModelsPage from '@/pages/ModelsPage'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="traces" element={<TracesPage />} />
        <Route path="models" element={<ModelsPage />} />
      </Route>
    </Routes>
  )
}
