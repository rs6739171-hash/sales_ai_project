import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, CheckCircle2, ChevronRight, Clock3, Database, FileSpreadsheet, Layers3, Play, RefreshCw, Upload, X } from 'lucide-react'
import { useWorkspace } from '../Workspace'
import { getPipelineStatus, isTerminal, triggerPipeline, uploadAndTriggerPipeline, validateFile } from '../api/pipeline'
import { isCancelled, messageOf } from '../api/client'
import type { PipelineStatusResponse } from '../api/types'
import { pause } from '../demo'
import { ErrorNotice, Spinner } from '../components/UI'

function readRun() {
  try { const value = Number(localStorage.getItem('salesiq:last-run:v1')); return Number.isSafeInteger(value) && value > 0 ? value : null } catch { return null }
}
function FileBox({ kind, file, onSelect }: { kind: 'sales' | 'calendar'; file: File | null; onSelect: (file: File | null) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  return <div className="file-box-wrapper"><label className={`file-dropzone ${file ? 'file-selected' : ''} ${dragging ? 'file-dragging' : ''}`} onDragOver={(e) => { e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files[0]) onSelect(e.dataTransfer.files[0]) }}>
    <input ref={ref} type="file" accept=".csv,text/csv" aria-label={kind === 'sales' ? 'Sales transactions CSV' : 'Marketing calendar CSV'} onChange={(e) => { if (e.target.files?.[0]) onSelect(e.target.files[0]) }}/><span className="file-icon">{file ? <FileSpreadsheet size={24}/> : <Upload size={23}/>}</span><strong>{file ? file.name : kind === 'sales' ? 'Sales transactions' : 'Marketing calendar'}</strong><span>{file ? `${(file.size / 1024).toFixed(1)} KB · Ready to upload` : 'Drop a CSV here, or click to browse'}</span><small>{file ? <><Check size={12}/>File selected</> : 'CSV files · up to 25 MB'}</small>
  </label>{file ? <button className="icon-button remove-file" aria-label={`Remove ${kind} file`} onClick={() => { onSelect(null); if (ref.current) ref.current.value = '' }}><X size={15}/></button> : null}</div>
}

export default function PipelinePage() {
  const { demo } = useWorkspace()
  const [sales, setSales] = useState<File | null>(null)
  const [calendar, setCalendar] = useState<File | null>(null)
  const [runId, setRunId] = useState<number | null>(() => demo ? null : readRun())
  const [status, setStatus] = useState<PipelineStatusResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pollError, setPollError] = useState<string | null>(null)
  const [pollRevision, setPollRevision] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const action = useRef<AbortController | null>(null)
  const started = useRef(0)
  useEffect(() => {
    action.current?.abort(); action.current = null
    setBusy(false); setRunId(demo ? null : readRun()); setStatus(null); setError(null); setNotice(null)
    return () => { action.current?.abort() }
  }, [demo])
  useEffect(() => {
    if (!runId) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    setPollError(null)
    async function poll() {
      try {
        const seconds = (Date.now() - started.current) / 1000
        const next = demo ? await pause(controller.signal, 200).then(() => ({ run_id: runId!, life_cycle_state: seconds < 2 ? 'PENDING' : seconds < 8 ? 'RUNNING' : 'TERMINATED', result_state: seconds < 8 ? null : 'SUCCESS', state_message: seconds < 8 ? 'Sample pipeline is processing.' : 'Sample run completed. No live job was started.' })) : await getPipelineStatus(runId!, controller.signal)
        if (controller.signal.aborted) return
        setStatus(next)
        if (!isTerminal(next)) timer = setTimeout(() => void poll(), 4000)
      } catch (err) { if (!isCancelled(err)) setPollError(messageOf(err)) }
    }
    void poll()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [runId, demo, pollRevision])
  const active = Boolean(runId && (!status || !isTerminal(status)))
  const success = status?.result_state === 'SUCCESS'
  const failed = Boolean(status && isTerminal(status) && !success)
  const choose = (kind: 'sales' | 'calendar', file: File | null) => {
    const invalid = file ? validateFile(file, kind) : null
    setError(invalid)
    if (!invalid) { if (kind === 'sales') setSales(file); else setCalendar(file) }
  }
  async function launch(upload: boolean) {
    if (action.current || active || (upload && !sales && !calendar)) return
    const controller = new AbortController()
    action.current = controller; setBusy(true); setError(null); setNotice(null)
    try {
      const response = demo ? await pause(controller.signal).then(() => ({ run_id: Math.floor(Date.now() / 1000) })) : upload ? await uploadAndTriggerPipeline(sales, calendar, controller.signal) : await triggerPipeline(controller.signal)
      if (controller.signal.aborted) return
      started.current = Date.now(); setStatus(null); setRunId(response.run_id)
      if (!demo) { try { localStorage.setItem('salesiq:last-run:v1', String(response.run_id)) } catch { /* Optional continuity. */ } }
      setNotice(demo ? 'Sample run started. No files were uploaded to a live service.' : `${upload ? 'Files uploaded. ' : ''}Pipeline run #${response.run_id} started.`)
    } catch (err) { if (!isCancelled(err)) setError(messageOf(err)) }
    finally { if (action.current === controller) { action.current = null; setBusy(false) } }
  }
  return <div className="pipeline-page page-enter"><div className="page-heading"><div><div className="eyebrow"><i/>GOOD DECISIONS START HERE</div><h1>Fresh data. Better direction<span>.</span></h1><p>Bring your latest sales into the picture and keep your forecasts up to date.</p></div><span className="pipeline-platform"><Database size={16}/>Databricks pipeline</span></div>
    <div className="pipeline-stages"><div className="stage"><span className="stage-number bronze"><FileSpreadsheet size={22}/></span><span><small>01 · BRONZE</small><strong>Bring in your data</strong><p>Raw sales & calendar files</p></span></div><ChevronRight className="stage-arrow" size={20}/><div className="stage"><span className="stage-number silver"><Layers3 size={22}/></span><span><small>02 · SILVER</small><strong>Make it consistent</strong><p>Clean & validated records</p></span></div><ChevronRight className="stage-arrow" size={20}/><div className="stage"><span className="stage-number gold"><TrendingIcon/></span><span><small>03 · GOLD</small><strong>See what’s ahead</strong><p>Features & updated forecasts</p></span></div></div>
    <div className="pipeline-layout"><section className="panel upload-panel"><div className="panel-heading"><div><h2>Add your latest data</h2><p>Upload one or both CSV files to start the next pipeline run.</p></div><span className="subtle-badge">CSV</span></div><div className="upload-boxes"><FileBox kind="sales" file={sales} onSelect={(file) => choose('sales', file)}/><FileBox kind="calendar" file={calendar} onSelect={(file) => choose('calendar', file)}/></div><div className="filename-guide"><FileSpreadsheet size={16}/><div><strong>A familiar name keeps things flowing.</strong><p>Sales filenames start with <code>sales_transactions</code>. Calendar filenames start with <code>calendar_marketing_external</code>.</p></div></div>{error ? <ErrorNotice message={error}/> : null}{notice ? <div className="success-notice" role="status"><CheckCircle2 size={17}/>{notice}</div> : null}<div className="upload-actions"><span>{sales || calendar ? `${Number(Boolean(sales)) + Number(Boolean(calendar))} file${sales && calendar ? 's' : ''} selected` : 'Choose at least one file to begin.'}</span><button className="button button-primary" disabled={busy || active || (!sales && !calendar)} onClick={() => void launch(true)}>{busy ? <Spinner/> : <Upload size={16}/>}Upload & run pipeline<ArrowRight size={15}/></button></div><div className="existing-data"><div><h3>Already have data in place?</h3><p>Run the pipeline using files already in your incoming volume.</p></div><button className="button button-white" onClick={() => void launch(false)} disabled={busy || active}><Play size={14}/>Run existing data</button></div></section>
    <section className="panel run-panel"><div className="panel-heading"><div><h2>Latest pipeline run</h2><p>Follow your data’s next step.</p></div><span className={`run-icon ${success ? 'run-success' : ''}`}>{success ? <CheckCircle2 size={21}/> : <Clock3 size={21}/>}</span></div><div className={`run-status-card ${success ? 'run-completed' : failed ? 'run-failed' : ''}`}><span className="run-status-label">RUN STATUS</span><strong>{!runId ? 'Ready when you are' : pollError ? 'Status check paused' : success ? 'Completed successfully' : failed ? 'Run needs attention' : status?.life_cycle_state === 'RUNNING' ? 'Processing your data' : 'Waiting to begin'}</strong><p>{!runId ? 'Start a pipeline run to see its progress here.' : `Run #${runId}`}</p>{runId ? <div className={`run-progress ${success ? 'progress-complete' : failed ? 'progress-failed' : ''}`}><span/></div> : <div className="ready-dots"><i/><i/><i/></div>}</div>{status ? <dl className="run-details"><div><dt>Lifecycle</dt><dd>{status.life_cycle_state.replaceAll('_', ' ')}</dd></div><div><dt>Result</dt><dd>{status.result_state || 'In progress'}</dd></div><div><dt>Run ID</dt><dd>#{status.run_id}</dd></div></dl> : null}{status?.state_message ? <p className="run-message">{status.state_message}</p> : null}{pollError ? <ErrorNotice message={pollError} retry={() => setPollRevision((n) => n + 1)}/> : null}{runId ? <button className="text-button check-status" onClick={() => setPollRevision((n) => n + 1)}><RefreshCw size={14}/>Check status again</button> : null}<div className="run-tip"><span className="tiny-dot"/><p>{demo ? 'You’re in preview mode. All run states shown here are simulated.' : 'Progress updates automatically while this page is open. Refreshing the page keeps your last run ID.'}</p></div></section></div>
  </div>
}
function TrendingIcon() { return <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20h16M6 16v-4m6 4V8m6 8V4"/><path d="m4 7 6-3 6 1 4-3"/></svg> }
