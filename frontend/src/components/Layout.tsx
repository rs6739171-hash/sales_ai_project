import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { ArrowUpRight, BookOpen, ChevronDown, Database, FlaskConical, LayoutDashboard, Menu, RefreshCw, Settings2, Sparkles, Workflow, X } from 'lucide-react'
import { useWorkspace } from '../Workspace'
import { BrandMark, Modal } from './UI'

export default function Layout() {
  const { demo, setDemo, currency, setCurrency, connected, loading, refresh } = useWorkspace()
  const [menu, setMenu] = useState(false)
  const [settings, setSettings] = useState(false)
  const location = useLocation()
  useEffect(() => { window.scrollTo(0, 0) }, [location.pathname])
  const title = location.pathname === '/analytics' ? 'AI analyst' : location.pathname === '/pipeline' ? 'Data pipeline' : 'Overview'
  const query = demo ? '?demo=1' : ''
  const links = [{ path: '/', title: 'Overview', icon: LayoutDashboard }, { path: '/analytics', title: 'AI analyst', icon: Sparkles }, { path: '/pipeline', title: 'Data pipeline', icon: Workflow }]
  return <div className="app-shell">
    <a href="#main-content" className="skip-link">Skip to content</a>
    {menu ? <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMenu(false)}/> : null}
    <aside className={`sidebar ${menu ? 'sidebar-open' : ''}`}>
      <NavLink to={`/${query}`} className="brand" onClick={() => setMenu(false)}><BrandMark/><span>Sales<span className="brand-iq">IQ</span><small>RETAIL INTELLIGENCE</small></span></NavLink>
      <button className="workspace-switch" onClick={() => setSettings(true)}><span className="workspace-avatar">S</span><span>Sales workspace<small>Personal workspace</small></span><ChevronDown size={15}/></button>
      <div className="nav-label">WORKSPACE</div>
      <nav aria-label="Main navigation">{links.map(({ path, title: label, icon: Icon }) => <NavLink key={path} to={`${path}${query}`} end={path === '/'} onClick={() => setMenu(false)} className={({ isActive }) => `nav-item ${isActive ? 'nav-item-active' : ''}`}><Icon size={19}/>{label}{path === '/analytics' ? <span className="nav-ai">AI</span> : null}</NavLink>)}</nav>
      <div className="nav-label tools-label">RESOURCES</div>
      <a className="nav-item" href={import.meta.env.VITE_DOCS_URL || (import.meta.env.DEV ? 'http://127.0.0.1:8000/docs' : `${import.meta.env.VITE_API_BASE_URL || '/api'}/docs`)} target="_blank" rel="noreferrer"><BookOpen size={19}/>API documentation<ArrowUpRight size={14} className="nav-trailing"/></a>
      <button className="nav-item" onClick={() => setSettings(true)}><Settings2 size={19}/>Display settings</button>
      <div className="sidebar-bottom"><div className="analyst-promo"><span className="promo-spark"><Sparkles size={19}/></span><h3>A little insight.<br/>A better next move.</h3><p>Ask your sales data a question. Get a clearer direction.</p><NavLink to={`/analytics${query}`}>Meet your AI analyst <ArrowUpRight size={16}/></NavLink></div>
        <div className="workspace-footer"><span className="workspace-avatar footer-avatar"><Database size={16}/></span><span>Retail workspace<small>{demo ? 'Sample data preview' : 'Local environment'}</small></span><button className="icon-button" onClick={() => setSettings(true)} aria-label="Workspace settings"><Settings2 size={17}/></button></div>
      </div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMenu(true)}><Menu size={21}/></button><span>Workspace</span><span className="crumb-slash">/</span><strong>{title}</strong></div><div className="topbar-actions"><span className={`connection-status ${demo ? 'connection-demo' : ''}`}><i className={connected ? 'dot connected' : demo ? 'dot sample' : loading ? 'dot connecting' : 'dot disconnected'}/>{demo ? 'Sample data' : loading ? 'Connecting' : connected ? 'Data connected' : 'API unavailable'}</span><button className="icon-button refresh-button" onClick={refresh} disabled={loading} aria-label="Refresh dashboard data"><RefreshCw size={17} className={loading ? 'spin' : ''}/></button><span className="topbar-divider"/><button className="profile-button" aria-label="Open display settings" onClick={() => setSettings(true)}>SW</button></div></header>
      {demo ? <div className="demo-banner"><span><FlaskConical size={15}/><strong>Sample data preview</strong><span className="demo-description">Explore the interface. These figures are illustrative.</span></span><button onClick={() => setDemo(false)}>Connect live data <ArrowUpRight size={14}/></button></div> : null}
      <main id="main-content" className="main-content"><Outlet/></main>
      <footer className="app-footer"><span>SalesIQ <span className="footer-dot">·</span> Made for more informed decisions.</span><span><i className="tiny-dot"/>Your forecasts. Your direction.</span></footer>
    </div>
    {settings ? <Modal title="Display settings" onClose={() => setSettings(false)}><p className="muted">Make this workspace feel right for you.</p><label className="setting-field">Display currency<select value={currency} onChange={(e) => setCurrency(e.target.value)}><option value="INR">INR · Indian rupee</option><option value="USD">USD · US dollar</option><option value="EUR">EUR · Euro</option><option value="GBP">GBP · British pound</option></select><small>This changes the currency label, not the underlying values.</small></label><label className="toggle-row"><span><strong>Preview sample data</strong><small>Explore the design without a live connection.</small></span><input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)}/></label><button className="button button-primary modal-done" onClick={() => setSettings(false)}>Done <X size={15}/></button></Modal> : null}
  </div>
}
