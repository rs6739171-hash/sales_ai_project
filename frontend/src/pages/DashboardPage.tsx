import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Area, CartesianGrid, ComposedChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, Download, Package, Search, ShoppingBag, Sparkles, TrendingUp, Wallet } from 'lucide-react'
import { useWorkspace } from '../Workspace'
import { explainForecast, getForecastRows, getForecastWithHistory } from '../api/forecast'
import { isCancelled, messageOf } from '../api/client'
import type { ForecastExplanation, ForecastHistoryResponse, ForecastRecord } from '../api/types'
import { demoExplanation, demoRows, demoTrend, pause } from '../demo'
import { compact, dateLabel, exportForecastCSV, money, number } from '../format'
import { EmptyState, ErrorNotice, Spinner } from '../components/UI'

export default function DashboardPage() {
  const w = useWorkspace()
  const navigate = useNavigate()
  const [historyDays, setHistoryDays] = useState(60)
  const [trend, setTrend] = useState<ForecastHistoryResponse | null>(null)
  const [trendLoading, setTrendLoading] = useState(false)
  const [trendError, setTrendError] = useState<string | null>(null)
  const [rows, setRows] = useState<ForecastRecord[]>([])
  const [rowsLoading, setRowsLoading] = useState(false)
  const [rowsError, setRowsError] = useState<string | null>(null)
  const [explanation, setExplanation] = useState<ForecastExplanation | null>(null)
  const [explainLoading, setExplainLoading] = useState(false)
  const [explainError, setExplainError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const analysisRequest = useRef<AbortController | null>(null)
  const chartPanel = useRef<HTMLElement>(null)
  const product = w.products.find((p) => p.product_id === w.productId)
  const store = w.stores.find((s) => s.store_id === w.storeId)
  const ready = !w.loading && Boolean(product && store)

  useEffect(() => {
    const controller = new AbortController()
    setTrend(null); setTrendError(null)
    if (!ready) { setTrendLoading(false); return () => controller.abort() }
    setTrendLoading(true)
    const promise = w.demo ? pause(controller.signal, 320).then(() => demoTrend(w.productId, w.storeId, historyDays))
      : getForecastWithHistory(w.productId, w.storeId, historyDays, controller.signal)
    void promise.then((data) => { if (!controller.signal.aborted) setTrend(data) }).catch((error: unknown) => {
      if (!isCancelled(error)) setTrendError(messageOf(error))
    }).finally(() => { if (!controller.signal.aborted) setTrendLoading(false) })
    return () => controller.abort()
  }, [w.demo, w.productId, w.storeId, w.revision, historyDays, ready])

  useEffect(() => {
    const controller = new AbortController()
    setRows([]); setRowsError(null); setPage(0)
    if (w.loading || !store) { setRowsLoading(false); return () => controller.abort() }
    setRowsLoading(true)
    const promise = w.demo ? pause(controller.signal, 350).then(() => ({ results: demoRows(w.storeId) })) : getForecastRows(w.storeId, controller.signal)
    void promise.then((data) => { if (!controller.signal.aborted) setRows(data.results) }).catch((error: unknown) => {
      if (!isCancelled(error)) setRowsError(messageOf(error))
    }).finally(() => { if (!controller.signal.aborted) setRowsLoading(false) })
    return () => controller.abort()
  }, [w.demo, w.storeId, w.revision, w.loading, store])

  useEffect(() => {
    analysisRequest.current?.abort(); analysisRequest.current = null
    setExplainLoading(false); setExplainError(null)
    setExplanation(w.demo && ready ? demoExplanation(w.productId, w.storeId) : null)
    return () => { analysisRequest.current?.abort() }
  }, [w.demo, w.productId, w.storeId, ready])

  async function explain(question?: string) {
    if (!ready || analysisRequest.current) return
    const controller = new AbortController()
    analysisRequest.current = controller
    setExplainLoading(true); setExplainError(null)
    try {
      const data = w.demo ? await pause(controller.signal).then(() => demoExplanation(w.productId, w.storeId))
        : await explainForecast(w.productId, w.storeId, question, controller.signal)
      if (!controller.signal.aborted) setExplanation(data)
    } catch (error) { if (!isCancelled(error)) setExplainError(messageOf(error)) }
    finally { if (analysisRequest.current === controller) { analysisRequest.current = null; setExplainLoading(false) } }
  }

  const outlook = useMemo(() => {
    const groups = new Map<string, { id: string; category: string; total: number; dates: Set<string>; version: string }>()
    rows.forEach((r) => {
      const group = groups.get(r.product_id) || { id: r.product_id, category: r.category, total: 0, dates: new Set<string>(), version: r.model_version }
      group.total += r.predicted_units; group.dates.add(r.forecast_date); groups.set(r.product_id, group)
    })
    const names = new Map(w.products.map((p) => [p.product_id, p.product_name]))
    return [...groups.values()].map((g) => ({ ...g, name: names.get(g.id) || g.id, days: g.dates.size })).sort((a, b) => b.total - a.total)
  }, [rows, w.products])
  const filtered = outlook.filter((row) => `${row.id} ${row.name} ${row.category}`.toLowerCase().includes(query.toLowerCase()))
  const pageCount = Math.max(1, Math.ceil(filtered.length / 5))
  const safePage = Math.min(page, pageCount - 1)
  const predicted = trend?.points.filter((p) => p.predicted_units !== null) || []
  const total = predicted.reduce((sum, p) => sum + (p.predicted_units || 0), 0)
  const start = predicted[0]?.date
  const end = predicted.at(-1)?.date
  const k = w.kpis

  return <div className="dashboard-page page-enter">
    <div className="page-heading"><div><div className="eyebrow"><i/>THE BIG PICTURE</div><h1>Your sales, a little clearer<span>.</span></h1><p>Understand today’s performance. Plan confidently for what’s next.</p></div><button className="button button-white export-button" disabled={!rows.length || rowsLoading} onClick={() => exportForecastCSV(rows)} title="Export daily forecasts for the selected store"><Download size={16}/>Export forecast</button></div>
    {w.error ? <div className="connection-notice"><ErrorNotice message={w.error} retry={w.refresh}/><button className="text-button" onClick={() => w.setDemo(true)}>Or explore the sample workspace <ArrowRight size={14}/></button></div> : null}
    <div className="section-kicker"><span>BUSINESS SNAPSHOT <span className="kicker-separator">/</span> All stores</span><span><CalendarDays size={13}/>30-day outlook</span></div>
    <section className={`kpi-grid ${w.loading ? 'is-loading' : ''}`} aria-label="Business snapshot" aria-busy={w.loading}>
      <article className="kpi-card"><div className="kpi-card-top"><span>Forecast revenue</span><span className="metric-icon green"><Wallet size={18}/></span></div><strong className="metric-value">{money(k?.predicted_revenue.total_predicted_revenue, w.currency, true)}</strong><div className="metric-bottom"><span className="metric-chip"><TrendingUp size={12}/>Projected</span><span>next 30 days</span></div><svg className="metric-spark" viewBox="0 0 108 30" aria-hidden="true"><path d="m1 26 13-4 12 2 12-10 12 4 12-8 12 2 12-9 12 1 9-3"/></svg></article>
      <article className="kpi-card"><div className="kpi-card-top"><span>Leading category</span><span className="metric-icon blue"><ShoppingBag size={18}/></span></div><strong className="metric-value metric-name">{k?.top_category.category || '—'}</strong><div className="metric-bottom"><span className="metric-detail">{compact(k?.top_category.total_units)} units sold</span><span>last {k?.top_category.days || 90} days</span></div></article>
      <article className="kpi-card"><div className="kpi-card-top"><span>Top-selling product</span><span className="metric-icon peach"><Package size={18}/></span></div><strong className="metric-value metric-name" title={k?.top_product.product_name || undefined}>{k?.top_product.product_name || '—'}</strong><div className="metric-bottom"><span className="metric-detail">{compact(k?.top_product.total_units)} units sold</span><span>last {k?.top_product.days || 90} days</span></div></article>
      <article className="kpi-card"><div className="kpi-card-top"><span>Needs a closer look</span><span className="metric-icon amber"><AlertTriangle size={18}/></span></div><strong className="metric-value">{number(k?.at_risk_count)}<small>at risk</small></strong><div className="metric-bottom"><span className="attention-dot"/><span>Product–store combinations</span></div></article>
    </section>

    <div className="forecast-layout">
      <section className="panel forecast-panel" ref={chartPanel} aria-labelledby="forecast-title"><div className="panel-heading"><div><h2 id="forecast-title">Demand forecast <span className="subtle-badge">Units</span></h2><p>A view of what sold, and what’s ahead.</p></div><span className="small-icon"><TrendingUp size={19}/></span></div>
        <div className="forecast-controls"><label className="select-field"><span>Product</span><select aria-label="Select product" value={w.productId} onChange={(e) => w.setProductId(e.target.value)} disabled={w.loading || !w.products.length}>{!w.products.length ? <option value="">No products available</option> : w.products.map((p) => <option key={p.product_id} value={p.product_id}>{p.product_name}</option>)}</select></label><label className="select-field"><span>Store</span><select aria-label="Select store" value={w.storeId} onChange={(e) => w.setStoreId(e.target.value)} disabled={w.loading || !w.stores.length}>{!w.stores.length ? <option value="">No stores available</option> : w.stores.map((s) => <option key={s.store_id} value={s.store_id}>{s.store_name}</option>)}</select></label></div>
        <div className="chart-toolbar"><div className="chart-legend"><span><i className="legend-line actual"/>Actual sales</span><span><i className="legend-line prediction"/>Forecast</span></div><div className="range-tabs" aria-label="History window">{[30, 60, 90].map((n) => <button key={n} aria-pressed={historyDays === n} className={historyDays === n ? 'active' : ''} onClick={() => setHistoryDays(n)}>{n}D</button>)}</div></div>
        {trendError ? <div className="chart-message"><ErrorNotice message={trendError} retry={w.refresh}/></div> : trendLoading || w.loading ? <div className="chart-message"><Spinner/><span>Loading your forecast…</span></div> : trend?.points.length ? <div className="forecast-chart" role="img" aria-label={`Actual and forecast daily units for ${product?.product_name} at ${store?.store_name}. Forecast total ${number(total)} units.`}><ResponsiveContainer width="100%" height={270} minWidth={0} initialDimension={{ width: 700, height: 270 }}><ComposedChart data={trend.points} margin={{ top: 18, right: 8, left: -10, bottom: 5 }}><defs><linearGradient id="actual-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#c4ced0" stopOpacity={0.21}/><stop offset="100%" stopColor="#c4ced0" stopOpacity={0}/></linearGradient><linearGradient id="prediction-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#448d71" stopOpacity={0.13}/><stop offset="100%" stopColor="#448d71" stopOpacity={0.01}/></linearGradient></defs><CartesianGrid stroke="#edf0f0" strokeDasharray="3 4" vertical={false}/><XAxis dataKey="date" tickFormatter={(value: string) => dateLabel(value)} axisLine={false} tickLine={false} minTickGap={40} tick={{ fill: '#87938e', fontSize: 11 }} dy={10}/><YAxis axisLine={false} tickLine={false} tick={{ fill: '#87938e', fontSize: 11 }} tickFormatter={(value: number) => compact(value)} width={48}/><Tooltip content={({ active, payload }) => active && payload?.length ? <div className="chart-tooltip"><strong>{dateLabel(String(payload[0].payload.date), true)}</strong>{payload.filter((p) => p.value !== null).map((p) => <span key={String(p.dataKey)}>{p.dataKey === 'actual_units' ? 'Actual sales' : 'Forecast'}<b>{number(Number(p.value), 1)} units</b></span>)}</div> : null}/>{start && end ? <ReferenceArea x1={start} x2={end} fill="#edf6f0" fillOpacity={0.55} strokeOpacity={0}/> : null}<Area type="monotone" dataKey="actual_units" name="Actual sales" stroke="#a9b8b1" strokeWidth={2} fill="url(#actual-fill)" isAnimationActive={false}/><Area type="monotone" dataKey="predicted_units" name="Forecast" stroke="#277956" strokeWidth={2.5} strokeDasharray="5 5" fill="url(#prediction-fill)" isAnimationActive={false}/></ComposedChart></ResponsiveContainer></div> : <div className="chart-message"><EmptyState title="Your forecast starts here">Choose a product and store with available forecast data.</EmptyState></div>}
        <div className="forecast-summary"><div><span>Forecast total</span><strong>{predicted.length ? number(total) : '—'}<small>units</small></strong></div><div><span>Daily average</span><strong>{predicted.length ? number(total / predicted.length, 1) : '—'}<small>units / day</small></strong></div><div><span>Forecast window</span><strong className="date-summary">{start && end ? `${dateLabel(start)} – ${dateLabel(end)}` : '—'}</strong></div></div>
      </section>

      <section className="panel insight-panel" aria-labelledby="insight-title"><div className="insight-eyebrow"><span className="insight-symbol"><Sparkles size={17}/></span>FORECAST EXPLAINER<span className="ai-badge">AI</span></div><h2 id="insight-title">The story behind<br/>your numbers.</h2><p className="insight-intro">A clearer forecast. A more confident next step.</p><div className="insight-scope"><span className="tiny-dot"/>{product?.product_name || 'Select a product'}<span className="scope-divider">·</span>{store?.store_name || 'Select a store'}</div>
        {explainError ? <ErrorNotice message={explainError}/> : null}
        {explanation ? <div className="insight-content"><p className="insight-narrative">{explanation.explanation}</p><h3>WHAT’S DRIVING IT</h3><ul className="driver-list">{explanation.key_drivers.slice(0, 3).map((driver, i) => <li key={i}><i/>{driver}</li>)}</ul><div className="recommendation"><span><ArrowUpRight size={16}/>A considered next step</span><p>{explanation.recommendation}</p></div>{explanation.risks_or_opportunities.length ? <details className="risk-details"><summary>Risks & opportunities</summary><ul>{explanation.risks_or_opportunities.map((risk, i) => <li key={i}>{risk}</li>)}</ul></details> : null}</div> : <div className="insight-placeholder"><div className="insight-visual" aria-hidden="true"><span/><span/><span/><span/><span/><Sparkles size={24}/></div><p>Your forecast has a story.<br/>Let’s make sense of it.</p></div>}
        <div className="insight-bottom"><button className="button button-primary explain-button" disabled={!ready || explainLoading || !trend?.points.length} onClick={() => void explain()}>{explainLoading ? <Spinner/> : <Sparkles size={16}/>} {explainLoading ? 'Making sense of your data…' : explanation ? 'Refresh explanation' : 'Explain this forecast'}{!explainLoading ? <ArrowRight size={16}/> : null}</button>{explainLoading ? <button className="text-button cancel-explain" onClick={() => { analysisRequest.current?.abort(); analysisRequest.current = null; setExplainLoading(false) }}>Cancel request</button> : <button className="text-button insight-followup" disabled={!ready} onClick={() => navigate(`/analytics${w.demo ? '?demo=1' : ''}`, { state: { prompt: `What should I prioritize for ${product?.product_name} (${w.productId}) at ${store?.store_name}?` } })}>Ask a follow-up <ArrowUpRight size={14}/></button>}<span className="insight-note">{w.demo ? 'Illustrative insight from sample data' : 'Explains existing forecasts. Never changes predictions.'}</span></div>
      </section>
    </div>

    <section className="panel product-panel" aria-labelledby="outlook-title"><div className="panel-heading product-heading"><div><h2 id="outlook-title">Product outlook <span className="count-badge">{outlook.length}</span></h2><p>Upcoming demand at {store?.store_name || 'your selected store'}.</p></div><label className="table-search"><Search size={15}/><input aria-label="Search product outlook" value={query} onChange={(e) => { setQuery(e.target.value); setPage(0) }} placeholder="Find a product…"/></label></div>
      {rowsError ? <ErrorNotice message={rowsError} retry={w.refresh}/> : rowsLoading || w.loading ? <div className="table-loading"><Spinner/>Loading product outlook…</div> : !filtered.length ? <EmptyState title={query ? 'No products match your search' : 'No forecast rows available'}>{query ? 'Try a product name, ID or category.' : 'Choose another store or run the data pipeline.'}</EmptyState> : <><div className="table-scroll"><table className="product-table"><thead><tr><th>Product</th><th>Category</th><th className="numeric">Forecast units</th><th className="numeric">Daily average</th><th>Horizon</th><th>Model</th><th><span className="sr-only">View forecast</span></th></tr></thead><tbody>{filtered.slice(safePage * 5, safePage * 5 + 5).map((row, i) => <tr key={row.id} className={w.productId === row.id ? 'selected-product' : ''}><td><button className="product-name-button" onClick={() => { w.setProductId(row.id); chartPanel.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }) }}><span className={`product-avatar product-avatar-${i % 4}`}><Package size={17}/></span><span><strong>{row.name}</strong><small>{row.id}</small></span></button></td><td><span className="category-tag">{row.category}</span></td><td className="numeric units-cell">{number(row.total)}</td><td className="numeric">{number(row.total / row.days, 1)}<span className="unit-suffix"> / day</span></td><td>{row.days} days</td><td><span className="model-tag">v{row.version}</span></td><td><button className="icon-button row-open" onClick={() => { w.setProductId(row.id); chartPanel.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }) }} aria-label={`View forecast for ${row.name}`}><ArrowUpRight size={16}/></button></td></tr>)}</tbody></table></div><div className="table-footer"><span>Showing {safePage * 5 + 1}–{Math.min(safePage * 5 + 5, filtered.length)} of {filtered.length} products</span><div><button className="pagination-button" disabled={safePage === 0} onClick={() => setPage(safePage - 1)} aria-label="Previous products"><ChevronLeft size={16}/></button><span>{safePage + 1} <span className="muted">/ {pageCount}</span></span><button className="pagination-button" disabled={safePage + 1 >= pageCount} onClick={() => setPage(safePage + 1)} aria-label="Next products"><ChevronRight size={16}/></button></div></div></>}
    </section>
    <div className="dashboard-bottom"><span><span className="tiny-dot"/>{w.demo ? 'Sample workspace' : 'Forecasts from your Databricks gold layer'}{w.refreshedAt ? ` · Refreshed ${w.refreshedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}</span><button className="text-button" onClick={() => navigate(`/analytics${w.demo ? '?demo=1' : ''}`)}>Explore more with your analyst <ArrowRight size={14}/></button></div>
    {explanation?.forecast_summary.vs_recent_history_pct_change != null ? <span className="sr-only">{explanation.forecast_summary.vs_recent_history_pct_change >= 0 ? <TrendingUp/> : <ArrowDownRight/>}Forecast change versus recent history: {number(explanation.forecast_summary.vs_recent_history_pct_change, 1)} percent.</span> : null}
  </div>
}
