import { AlertCircle, ArrowRight, Check, LoaderCircle, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'

export function BrandMark({ small = false }: { small?: boolean }) {
  return <span className={`brand-symbol ${small ? 'brand-symbol-small' : ''}`} aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="M6 25v-6m7 6V12m7 13v-9m7 9V6" stroke="currentColor" strokeWidth="3.1" strokeLinecap="round"/><path d="m5 12 7-5 7 3 8-7" stroke="#b7dfb7" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
}
export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <LoaderCircle size={17} className="spin" aria-label={label} />
}
export function ErrorNotice({ message, retry }: { message: string; retry?: () => void }) {
  return <div className="error-notice" role="alert"><AlertCircle size={18}/><span>{message}</span>{retry ? <button onClick={retry}>Try again <ArrowRight size={14}/></button> : null}</div>
}
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon"><BrandMark small/></span><h3>{title}</h3>{children ? <p>{children}</p> : null}</div>
}
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { const el = dialog.current; el?.showModal(); return () => el?.close() }, [])
  return <dialog ref={dialog} aria-label={title} className="settings-dialog" onCancel={onClose} onClick={(e) => { if (e.target === dialog.current) onClose() }}>
    <div className="dialog-heading"><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={20}/></button></div>{children}
  </dialog>
}
export function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  return <button className="copy-button" onClick={() => { if (!navigator.clipboard) { setState('failed'); return }; void navigator.clipboard.writeText(text).then(() => setState('copied')).catch(() => setState('failed')) }}>
    {state === 'copied' ? <Check size={13}/> : null}{state === 'copied' ? 'Copied' : state === 'failed' ? 'Select text to copy' : 'Copy answer'}
  </button>
}
