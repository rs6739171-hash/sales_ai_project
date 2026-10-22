import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import { ArrowRight, ArrowUp, ChartNoAxesCombined, ChevronDown, CircleCheck, MessageSquarePlus, Package, ShoppingBag, Sparkles, Square, TrendingDown, Wallet } from 'lucide-react'
import { useWorkspace } from '../Workspace'
import { sendChatMessage, sendQuickAction } from '../api/chat'
import { isCancelled, messageOf } from '../api/client'
import type { ChatResponse, ChatTurnHistory } from '../api/types'
import { demoChat, pause } from '../demo'
import { BrandMark, CopyButton } from '../components/UI'

interface Message { id: number; role: 'user' | 'assistant' | 'notice'; content: string; response?: ChatResponse; error?: boolean }
const suggestions = [
  { title: 'Find the leading category', text: 'Which category is selling the most?', action: 'top_category', icon: ShoppingBag, color: 'green' },
  { title: 'See what needs attention', text: 'Which products are trending down?', action: 'trending_down_products', icon: TrendingDown, color: 'amber' },
  { title: 'Look ahead at revenue', text: 'What revenue is forecast for the next 30 days?', action: 'predicted_revenue', icon: Wallet, color: 'blue' },
  { title: 'Discover your top product', text: 'What is the best-selling product?', action: 'top_product', icon: Package, color: 'peach' },
]

export default function AnalyticsChatPage() {
  const w = useWorkspace()
  const location = useLocation()
  const initialPrompt = typeof location.state?.prompt === 'string' ? location.state.prompt : ''
  const [draft, setDraft] = useState(initialPrompt)
  const [messages, setMessages] = useState<Message[]>([])
  const [storeId, setStoreId] = useState(w.storeId)
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const request = useRef<AbortController | null>(null)
  const counter = useRef(0)
  const conversation = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const store = w.stores.find((s) => s.store_id === storeId)

  useEffect(() => {
    return () => { request.current?.abort(); request.current = null }
  }, [])
  useEffect(() => {
    request.current?.abort(); request.current = null; setBusy(false); setMessages([])
  }, [w.demo])
  useEffect(() => {
    const el = conversation.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, busy])
  useEffect(() => {
    if (!busy) { setElapsed(0); return }
    const timer = setInterval(() => setElapsed((n) => n + 1), 1000)
    return () => clearInterval(timer)
  }, [busy])

  function reset() {
    request.current?.abort(); request.current = null
    setBusy(false); setMessages([]); setDraft(''); input.current?.focus()
  }
  async function send(text: string, action?: string) {
    const content = text.trim()
    if (!content || request.current) return
    const controller = new AbortController()
    request.current = controller
    const history: ChatTurnHistory[] = messages.filter((m) => m.role !== 'notice' && !m.error).slice(-12).map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
    setMessages((all) => [...all, { id: ++counter.current, role: 'user', content }])
    setDraft(''); setBusy(true)
    try {
      const params: Record<string, unknown> = storeId ? { store_id: storeId } : {}
      const result = w.demo ? await pause(controller.signal, 850).then(() => demoChat(content, action))
        : action ? await sendQuickAction(action, params, controller.signal)
          : await sendChatMessage(content, history, storeId || undefined, store?.store_name, controller.signal)
      if (!controller.signal.aborted) setMessages((all) => [...all, { id: ++counter.current, role: 'assistant', content: result.answer, response: result }])
    } catch (error) {
      if (!isCancelled(error)) setMessages((all) => [...all, { id: ++counter.current, role: 'assistant', content: messageOf(error), error: true }])
    } finally {
      if (request.current === controller) { request.current = null; setBusy(false); input.current?.focus() }
    }
  }
  function cancel() {
    request.current?.abort(); request.current = null; setBusy(false)
    setMessages((all) => [...all, { id: ++counter.current, role: 'notice', content: 'Request cancelled. You can ask another question.' }])
  }

  return <div className="analyst-page page-enter">
    <div className="page-heading"><div><div className="eyebrow"><i/>A LITTLE MORE PERSPECTIVE</div><h1>Meet your sales analyst<span>.</span></h1><p>Ask a question. Find the signal in your sales data.</p></div><button className="button button-white" onClick={reset} disabled={!messages.length && !draft}><MessageSquarePlus size={16}/>New conversation</button></div>
    <section className="panel analyst-panel"><div className="analyst-topline"><div className="analyst-identity"><span className="analyst-avatar"><Sparkles size={21}/></span><span><strong>SalesIQ analyst</strong><small><span className="tiny-dot"/>{w.demo ? 'Sample responses' : 'Grounded in your sales data'}</small></span></div><label className="chat-store-label"><span>Store context</span><select aria-label="Chat store context" value={storeId} onChange={(e) => { reset(); setStoreId(e.target.value) }} disabled={busy}><option value="">All stores</option>{w.stores.map((s) => <option key={s.store_id} value={s.store_id}>{s.store_name}</option>)}</select></label></div>
      <div className="conversation" ref={conversation} aria-live="polite" aria-relevant="additions">
        {!messages.length ? <div className="analyst-welcome"><span className="welcome-symbol"><ChartNoAxesCombined size={31}/><span className="welcome-star"><Sparkles size={13}/></span></span><span className="welcome-eyebrow">FROM NUMBERS TO NEXT STEPS</span><h2>What would you like<br/>to understand today?</h2><p>Explore performance, spot changes in demand,<br className="desktop-break"/>and see what your next month could look like.</p><div className="suggestion-grid">{suggestions.map(({ title, text, action, icon: Icon, color }) => <button key={action} className="suggestion-card" onClick={() => void send(text, action)}><span className={`metric-icon ${color}`}><Icon size={18}/></span><strong>{title}</strong><span>{text}</span><ArrowRight size={15} className="suggestion-arrow"/></button>)}</div><span className="welcome-note"><CircleCheck size={13}/>Quick questions use your analytics directly.</span></div> : <div className="message-list">{messages.map((m) => m.role === 'notice' ? <p className="conversation-notice" key={m.id}>{m.content}</p> : <div className={`message-row message-${m.role}`} key={m.id}>{m.role === 'assistant' ? <span className="message-avatar"><BrandMark small/></span> : <span className="message-user-avatar">You</span>}<div className={`message-bubble ${m.error ? 'message-error' : ''}`}><div className="message-author">{m.role === 'user' ? 'You' : 'SalesIQ analyst'}</div>{m.role === 'assistant' && !m.error ? <div className="markdown"><ReactMarkdown components={{ a: ({ children, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer">{children}</a>, img: ({ alt }) => <span>{alt || 'Image omitted'}</span> }}>{m.content}</ReactMarkdown></div> : <p>{m.content}</p>}{m.response ? <><div className="message-meta"><span><CircleCheck size={12}/>{w.demo ? 'Sample analytics' : m.response.functions_used.length ? `${m.response.functions_used.length} analytics tool${m.response.functions_used.length === 1 ? '' : 's'} used` : 'Assistant response'}</span><CopyButton text={m.content}/></div>{Object.keys(m.response.data).length ? <details className="answer-data"><summary>Explore supporting data <ChevronDown size={13}/></summary><div className="tool-tags">{m.response.functions_used.map((name) => <span key={name}>{name.replaceAll('_', ' ')}</span>)}</div><pre>{JSON.stringify(m.response.data, null, 2)}</pre></details> : null}</> : null}</div></div>)}{busy ? <div className="message-row message-assistant"><span className="message-avatar"><BrandMark small/></span><div className="message-bubble thinking-bubble"><div className="message-author">SalesIQ analyst</div><div className="thinking-line"><span className="thinking-dots"><i/><i/><i/></span>Checking your sales data{elapsed > 2 ? ` · ${elapsed}s` : ''}</div><p className="thinking-hint">A considered answer can take a moment.</p></div></div> : null}</div>}
      </div>
      <div className="chat-composer-area"><form className="chat-composer" onSubmit={(e) => { e.preventDefault(); void send(draft) }}><textarea ref={input} aria-label="Ask your sales analyst" placeholder="Ask anything about your sales…" rows={2} maxLength={2000} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(draft) } }}/><div className="composer-bottom"><span><Sparkles size={13}/>{store ? store.store_name : 'All stores'}<span className="composer-dot">·</span>Sales intelligence</span>{busy ? <button type="button" className="send-button cancel-button" onClick={cancel} aria-label="Cancel answer generation"><Square size={14}/></button> : <button type="submit" className="send-button" disabled={!draft.trim()} aria-label="Send question"><ArrowUp size={19}/></button>}</div></form><p className="composer-caption">Answers help explain your data. Review important decisions against the source.<span>Enter to send <span>↵</span></span></p></div>
    </section>
  </div>
}
