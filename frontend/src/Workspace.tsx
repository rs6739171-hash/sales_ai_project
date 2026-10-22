import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getProducts, getStores } from './api/forecast'
import { getKPIs } from './api/chat'
import { isCancelled, messageOf } from './api/client'
import type { KPISummary, Product, Store } from './api/types'
import { demoProducts, demoStores, demoKPIs, pause } from './demo'

function initialCurrency() {
  try {
    const saved = localStorage.getItem('salesiq:currency:v1') || import.meta.env.VITE_CURRENCY || 'INR'
    return ['INR', 'USD', 'EUR', 'GBP'].includes(saved) ? saved : 'INR'
  } catch { return 'INR' }
}
interface WorkspaceValue {
  demo: boolean; setDemo: (value: boolean) => void
  currency: string; setCurrency: (value: string) => void
  products: Product[]; stores: Store[]; kpis: KPISummary | null
  productId: string; setProductId: (value: string) => void
  storeId: string; setStoreId: (value: string) => void
  loading: boolean; error: string | null; connected: boolean; refreshedAt: Date | null
  refresh: () => void; revision: number
}
const WorkspaceContext = createContext<WorkspaceValue | null>(null)
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [search, setSearch] = useSearchParams()
  const demo = search.get('demo') === '1'
  const [currency, updateCurrency] = useState(initialCurrency)
  const [products, setProducts] = useState<Product[]>([])
  const [stores, setStores] = useState<Store[]>([])
  const [kpis, setKPIs] = useState<KPISummary | null>(null)
  const [productId, setProductId] = useState('')
  const [storeId, setStoreId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    const signal = controller.signal
    setLoading(true); setError(null); setConnected(false); setKPIs(null); setProducts([]); setStores([])
    async function load() {
      const jobs = demo ? [pause(signal).then(() => demoProducts), pause(signal).then(() => demoStores), pause(signal).then(demoKPIs)] as const
        : [getProducts(signal), getStores(signal), getKPIs(signal)] as const
      const [p, s, k] = await Promise.allSettled(jobs)
      if (signal.aborted) return
      const errors: string[] = []
      if (p.status === 'fulfilled') {
        setProducts(p.value)
        setProductId((old) => p.value.some((item) => item.product_id === old) ? old : p.value[0]?.product_id || '')
      } else if (!isCancelled(p.reason)) errors.push(messageOf(p.reason))
      if (s.status === 'fulfilled') {
        setStores(s.value)
        setStoreId((old) => s.value.some((item) => item.store_id === old) ? old : s.value[0]?.store_id || '')
      } else if (!isCancelled(s.reason)) errors.push(messageOf(s.reason))
      if (k.status === 'fulfilled') setKPIs(k.value)
      else if (!isCancelled(k.reason)) errors.push(messageOf(k.reason))
      setError(errors.length ? [...new Set(errors)].join(' ') : null)
      setConnected(!demo && p.status === 'fulfilled' && s.status === 'fulfilled')
      if (p.status === 'fulfilled' || s.status === 'fulfilled' || k.status === 'fulfilled') setRefreshedAt(new Date())
      setLoading(false)
    }
    void load()
    return () => controller.abort()
  }, [demo, revision])
  const setCurrency = (value: string) => {
    updateCurrency(value)
    try { localStorage.setItem('salesiq:currency:v1', value) } catch { /* Storage is optional. */ }
  }
  const setDemo = (value: boolean) => {
    const next = new URLSearchParams(search)
    if (value) next.set('demo', '1'); else next.delete('demo')
    setSearch(next, { replace: true })
  }
  return <WorkspaceContext.Provider value={{ demo, setDemo, currency, setCurrency, products, stores, kpis,
    productId, setProductId, storeId, setStoreId, loading, error, connected, refreshedAt,
    refresh: () => setRevision((n) => n + 1), revision }}>{children}</WorkspaceContext.Provider>
}
export function useWorkspace() {
  const context = useContext(WorkspaceContext)
  if (!context) throw new Error('WorkspaceProvider is missing')
  return context
}
