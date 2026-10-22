import { request } from './client'
import type { ChatResponse, ChatTurnHistory, KPISummary } from './types'

export const getKPIs = (signal?: AbortSignal) => request<KPISummary>('/kpis', { signal, timeout: 90_000 })
export function sendChatMessage(message: string, history: ChatTurnHistory[], storeId?: string, storeName?: string, signal?: AbortSignal) {
  return request<ChatResponse>('/chat', {
    method: 'POST', body: { message, history, store_id: storeId || null, store_name: storeName || null },
    timeout: 240_000, signal,
  })
}
export function sendQuickAction(action: string, params: Record<string, unknown> = {}, signal?: AbortSignal) {
  return request<ChatResponse>('/chat/quick', { method: 'POST', body: { action, params }, timeout: 90_000, signal })
}
