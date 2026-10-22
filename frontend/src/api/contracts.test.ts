import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, request } from './client'
import { getForecastWithHistory, explainForecast } from './forecast'
import { sendChatMessage } from './chat'
import { isTerminal, uploadAndTriggerPipeline, validateFile } from './pipeline'

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
describe('FastAPI contracts', () => {
  it('sends the two named multipart fields and lets fetch supply the boundary', async () => {
    const fetcher = vi.fn().mockResolvedValue(ok({ run_id: 7 }))
    vi.stubGlobal('fetch', fetcher)
    const sales = new File(['date,units'], 'sales_transactions_2026.csv')
    const calendar = new File(['date,event'], 'calendar_marketing_external.csv')
    await uploadAndTriggerPipeline(sales, calendar)
    const [url, options] = fetcher.mock.calls[0]
    expect(url).toBe('/api/pipeline/upload-and-trigger')
    expect(options.headers).toBeUndefined()
    expect([...options.body.keys()]).toEqual(['sales_transactions_file', 'calendar_marketing_file'])
    expect(options.body.get('sales_transactions_file').name).toBe(sales.name)
  })
  it('allows a calendar-only upload', async () => {
    const fetcher = vi.fn().mockResolvedValue(ok({ run_id: 8 }))
    vi.stubGlobal('fetch', fetcher)
    await uploadAndTriggerPipeline(null, new File(['a'], 'calendar_marketing_external.csv'))
    expect([...fetcher.mock.calls[0][1].body.keys()]).toEqual(['calendar_marketing_file'])
  })
  it('rejects empty uploads and wrong filenames before making a request', () => {
    expect(() => uploadAndTriggerPipeline(null, null)).toThrow('at least one')
    expect(validateFile(new File(['a'], 'sales.csv'), 'sales')).toContain('sales_transactions')
    expect(validateFile(new File(['a'], 'sales_transactions.xlsx'), 'sales')).toContain('CSV')
  })
  it('encodes forecast identifiers and requests history explicitly', async () => {
    const fetcher = vi.fn().mockResolvedValue(ok({ points: [] }))
    vi.stubGlobal('fetch', fetcher)
    await getForecastWithHistory('P & 1', 'S/2', 60)
    const url = new URL(fetcher.mock.calls[0][0], 'http://test')
    expect(Object.fromEntries(url.searchParams)).toEqual({product_id:'P & 1',store_id:'S/2',include_history:'true',history_days:'60'})
  })
  it('preserves chat history and optional store context in JSON', async () => {
    const fetcher = vi.fn().mockResolvedValue(ok({answer:'ok'}))
    vi.stubGlobal('fetch', fetcher)
    const history = [{role:'user' as const,content:'Earlier question'}]
    await sendChatMessage('Next?', history)
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({message:'Next?',history,store_id:null,store_name:null})
  })
  it('sends an optional explanation question as null when absent', async () => {
    const fetcher = vi.fn().mockResolvedValue(ok({explanation:'ok'}))
    vi.stubGlobal('fetch', fetcher)
    await explainForecast('P1', 'S1')
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({product_id:'P1',store_id:'S1',user_question:null})
  })
  it('shows FastAPI validation errors with their status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({detail:[{msg:'Field required'}]}),{status:422})))
    await expect(request('/chat')).rejects.toMatchObject({message:'Field required',status:422})
  })
  it('distinguishes a caller cancellation from an API failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Aborted','AbortError')))
    const controller = new AbortController(); controller.abort()
    await expect(request('/chat',{signal:controller.signal})).rejects.toMatchObject({name:'AbortError'})
  })
  it('turns timeout into actionable feedback', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise((_resolve,reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted','AbortError'))))))
    const pending = expect(request('/chat',{timeout:100})).rejects.toBeInstanceOf(ApiError)
    await vi.advanceTimersByTimeAsync(101); await pending
  })
  it('stops polling all terminal Databricks lifecycle states', () => {
    const status = {run_id:1,result_state:null,state_message:null}
    for (const life_cycle_state of ['TERMINATED','SKIPPED','INTERNAL_ERROR']) expect(isTerminal({...status,life_cycle_state})).toBe(true)
    expect(isTerminal({...status,life_cycle_state:'RUNNING'})).toBe(false)
  })
})
