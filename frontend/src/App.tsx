import { lazy, Suspense } from 'react'
import { Link, Route, Routes } from 'react-router-dom'
import { WorkspaceProvider } from './Workspace'
import Layout from './components/Layout'
import { Spinner } from './components/UI'

const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const AnalyticsChatPage = lazy(() => import('./pages/AnalyticsChatPage'))
const PipelinePage = lazy(() => import('./pages/PipelinePage'))

export default function App() {
  return <WorkspaceProvider><Suspense fallback={<div className="page-loading"><Spinner/>Opening workspace…</div>}><Routes><Route element={<Layout/>}>
    <Route path="/" element={<DashboardPage/>}/>
    <Route path="/analytics" element={<AnalyticsChatPage/>}/>
    <Route path="/pipeline" element={<PipelinePage/>}/>
    <Route path="*" element={<div className="empty-state"><h1>This page isn’t here.</h1><Link to="/" className="button button-primary">Back to overview</Link></div>}/>
  </Route></Routes></Suspense></WorkspaceProvider>
}
