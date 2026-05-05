import { Routes, Route } from 'react-router-dom'
import Layout from '@/components/layout/Layout'
import HomePage from '@/pages/HomePage'
import RuntimePage from '@/pages/RuntimePage'
import TestSuitePage from '@/pages/TestSuitePage'
import DriftPage from '@/pages/DriftPage'
import ComparePage from '@/pages/ComparePage'
import MonitorPage from '@/pages/MonitorPage'
import SpecPage from '@/pages/SpecPage'
import ChatLogsPage from '@/pages/ChatLogsPage'
import CostPage from '@/pages/CostPage'
import CorpusPage from '@/pages/CorpusPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route element={<Layout />}>
        <Route path="spec"       element={<SpecPage />} />
        <Route path="runtime"    element={<RuntimePage />} />
        <Route path="test-suite" element={<TestSuitePage />} />
        <Route path="drift"      element={<DriftPage />} />
        <Route path="compare"    element={<ComparePage />} />
        <Route path="monitor"    element={<MonitorPage />} />
        <Route path="chatlogs"   element={<ChatLogsPage />} />
        <Route path="cost"       element={<CostPage />} />
        <Route path="corpus"     element={<CorpusPage />} />
      </Route>
    </Routes>
  )
}
