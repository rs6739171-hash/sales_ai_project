import { request } from './client'
import type { PipelineStatusResponse, PipelineTriggerResponse, PipelineUploadAndTriggerResponse } from './types'

export const MAX_FILE_BYTES = 25 * 1024 * 1024
export function validateFile(file: File, kind: 'sales' | 'calendar'): string | null {
  const prefix = kind === 'sales' ? 'sales_transactions' : 'calendar_marketing_external'
  if (!file.name.toLowerCase().endsWith('.csv')) return 'Choose a CSV file.'
  if (!file.name.startsWith(prefix)) return `The filename must start with ${prefix}.`
  if (file.size > MAX_FILE_BYTES) return 'Choose a file smaller than 25 MB.'
  return null
}
export function uploadAndTriggerPipeline(sales: File | null, calendar: File | null, signal?: AbortSignal) {
  if (!sales && !calendar) throw new Error('Choose at least one CSV file.')
  if (sales) { const error = validateFile(sales, 'sales'); if (error) throw new Error(error) }
  if (calendar) { const error = validateFile(calendar, 'calendar'); if (error) throw new Error(error) }
  const form = new FormData()
  // These names match the current FastAPI endpoint, not the reference UI's generic files field.
  if (sales) form.append('sales_transactions_file', sales)
  if (calendar) form.append('calendar_marketing_file', calendar)
  return request<PipelineUploadAndTriggerResponse>('/pipeline/upload-and-trigger', { method: 'POST', body: form, timeout: 120_000, signal })
}
export const triggerPipeline = (signal?: AbortSignal) => request<PipelineTriggerResponse>('/pipeline/trigger', { method: 'POST', signal, timeout: 60_000 })
export const getPipelineStatus = (runId: number, signal?: AbortSignal) => request<PipelineStatusResponse>(`/pipeline/status/${runId}`, { signal, timeout: 30_000 })
export const isTerminal = (status: PipelineStatusResponse) => ['TERMINATED', 'SKIPPED', 'INTERNAL_ERROR'].includes(status.life_cycle_state)
