import { request } from './client'
import type { ForecastExplanation, ForecastHistoryResponse, ForecastListResponse, Product, Store } from './types'

export const getProducts = (signal?: AbortSignal) => request<Product[]>('/products', { signal })
export const getStores = (signal?: AbortSignal) => request<Store[]>('/stores', { signal })
export function getForecastWithHistory(productId: string, storeId: string, days = 90, signal?: AbortSignal) {
  const params = new URLSearchParams({ product_id: productId, store_id: storeId, include_history: 'true', history_days: String(days) })
  return request<ForecastHistoryResponse>(`/forecast?${params}`, { signal })
}
export function getForecastRows(storeId: string, signal?: AbortSignal) {
  return request<ForecastListResponse>(`/forecast?${new URLSearchParams({ store_id: storeId })}`, { signal })
}
export function explainForecast(productId: string, storeId: string, userQuestion?: string, signal?: AbortSignal) {
  return request<ForecastExplanation>('/forecast/explain', {
    method: 'POST', body: { product_id: productId, store_id: storeId, user_question: userQuestion || null },
    timeout: 240_000, signal,
  })
}
