/** Explicitly selected sample data. Never used as a fallback for a failed live request. */
import type { ChatResponse, ForecastExplanation, ForecastHistoryResponse, ForecastRecord, KPISummary, Product, Store } from './api/types'

export const demoProducts: Product[] = [
  { product_id: 'P01', product_name: 'Whole milk · 1 L', category: 'Dairy' },
  { product_id: 'P02', product_name: 'Artisan sourdough', category: 'Bakery' },
  { product_id: 'P03', product_name: 'Basmati rice · 5 kg', category: 'Grocery' },
  { product_id: 'P04', product_name: 'Cold brew coffee', category: 'Beverages' },
  { product_id: 'P05', product_name: 'Greek yogurt', category: 'Dairy' },
  { product_id: 'P06', product_name: 'Organic bananas', category: 'Fresh produce' },
  { product_id: 'P07', product_name: 'Rolled oats · 1 kg', category: 'Grocery' },
  { product_id: 'P08', product_name: 'Dark chocolate', category: 'Snacks' },
  { product_id: 'P09', product_name: 'Green tea · 25 bags', category: 'Beverages' },
  { product_id: 'P10', product_name: 'Extra virgin olive oil', category: 'Grocery' },
]
export const demoStores: Store[] = [
  { store_id: 'S01', store_name: 'Central Market', city: 'Bengaluru', region: 'South' },
  { store_id: 'S02', store_name: 'Westside Hub', city: 'Mumbai', region: 'West' },
  { store_id: 'S03', store_name: 'Riverside Store', city: 'Ahmedabad', region: 'West' },
]
const bases = [121, 83, 64, 98, 76, 110, 54, 61, 43, 34]
const prices = [64, 145, 650, 120, 90, 65, 180, 95, 160, 590]
const day = (offset: number) => new Date(Date.UTC(2026, 9, 22 + offset)).toISOString().slice(0, 10)
const factor = (store: string) => store === 'S02' ? 0.85 : store === 'S03' ? 0.65 : 1

export function demoRows(storeId?: string): ForecastRecord[] {
  return demoStores.filter((s) => !storeId || s.store_id === storeId).flatMap((store) =>
    demoProducts.flatMap((product, index) => Array.from({ length: 30 }, (_, i) => ({
      forecast_id: `${store.store_id}-${product.product_id}-${i}`,
      forecast_date: day(i + 1), product_id: product.product_id, category: product.category,
      brand: 'Sample brand', store_id: store.store_id, store_name: store.store_name, city: store.city,
      forecast_horizon: i + 1,
      predicted_units: Math.round((bases[index] * 1.13 + Math.sin(i * 0.55 + index) * 17 + (i % 7 > 4 ? 15 : 0)) * factor(store.store_id)),
      prediction_timestamp: '2026-10-22T03:30:00Z', model_name: 'Sample forecast model', model_version: '12',
    }))))
}
export function demoTrend(productId: string, storeId: string, days: number): ForecastHistoryResponse {
  const index = Math.max(0, demoProducts.findIndex((p) => p.product_id === productId))
  return {
    product_id: productId, store_id: storeId, history_days: days,
    points: [
      ...Array.from({ length: days }, (_, i) => ({
        date: day(i - days + 1),
        actual_units: Math.max(0, Math.round((bases[index] + Math.sin(i * 0.56) * 21 + Math.cos(i * 0.23) * 10 + (i % 7 > 4 ? 14 : 0)) * factor(storeId))),
        predicted_units: null,
      })),
      ...demoRows(storeId).filter((r) => r.product_id === productId).map((r) => ({ date: r.forecast_date, actual_units: null, predicted_units: r.predicted_units })),
    ],
  }
}
export function demoKPIs(): KPISummary {
  const rows = demoRows()
  return {
    top_category: { days: 90, category: 'Grocery', total_units: 34_200 },
    top_product: { days: 90, product_id: 'P01', product_name: demoProducts[0].product_name, total_units: 27_225 },
    predicted_revenue: {
      total_predicted_units: rows.reduce((sum, row) => sum + row.predicted_units, 0),
      total_predicted_revenue: rows.reduce((sum, row) => sum + row.predicted_units * prices[demoProducts.findIndex((p) => p.product_id === row.product_id)], 0),
      note: 'Illustrative sample forecast, using sample product prices.',
    },
    at_risk_count: 8,
  }
}
export function demoExplanation(productId: string, storeId: string): ForecastExplanation {
  const points = demoTrend(productId, storeId, 90).points
  const prediction = points.filter((p) => p.predicted_units !== null)
  const actual = points.filter((p) => p.actual_units !== null).slice(-28)
  const total = prediction.reduce((sum, p) => sum + (p.predicted_units || 0), 0)
  const average = total / prediction.length
  const baseline = actual.reduce((sum, p) => sum + (p.actual_units || 0), 0) / actual.length
  const change = (average - baseline) / baseline * 100
  return {
    product_id: productId, store_id: storeId,
    forecast_summary: { avg_predicted_units: average, total_predicted_units: total, vs_recent_history_pct_change: change },
    explanation: `The sample forecast points to ${change.toFixed(1)}% higher daily demand than the recent 28-day average. Expect around ${Math.round(average)} units per day over the next 30 days.`,
    key_drivers: ['Recent sales establish a steady demand baseline.', 'The sample forecast includes a recurring weekly demand pattern.'],
    risks_or_opportunities: ['Higher forecast demand may require more frequent stock replenishment.'],
    recommendation: 'Plan inventory around the forecast, then review actual sales each week to avoid overstocking.',
    model_version: '12',
  }
}
export function demoChat(question: string, action?: string): ChatResponse {
  const kpis = demoKPIs()
  if (action === 'top_category' || /categor/i.test(question)) return {
    answer: '**Grocery** leads the sample dataset with **34,200 units** sold in the last 90 days.\n\nUse this category as a starting point for inventory planning, then compare performance by store.',
    data: { sample_top_category: kpis.top_category }, functions_used: ['sample_top_category'],
  }
  if (action === 'trending_down_products' || /risk|declin|down/i.test(question)) return {
    answer: 'There are **8 product–store combinations** flagged for attention in the sample dataset.\n\nReview recent demand before making replenishment decisions. In live mode, this answer is calculated from your own data.',
    data: { sample_at_risk_count: 8 }, functions_used: ['sample_trending_down'],
  }
  if (action === 'top_product') return {
    answer: '**Whole milk · 1 L** is the best-selling product in the sample dataset, with **27,225 units** sold over 90 days.',
    data: { sample_top_product: kpis.top_product }, functions_used: ['sample_top_product'],
  }
  return {
    answer: `The sample 30-day forecast totals **${kpis.predicted_revenue.total_predicted_units?.toLocaleString('en-IN')} units** across all stores.\n\nSelect a product and store on the overview to explore daily demand. This is a sample-data response; switch to live data to ask questions about your own sales.`,
    data: { sample_forecast_summary: kpis.predicted_revenue }, functions_used: ['sample_forecast_summary'],
  }
}
export function pause(signal?: AbortSignal, ms = 600): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return }
    const abort = () => { clearTimeout(timer); reject(new DOMException('Cancelled', 'AbortError')) }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, ms)
    signal?.addEventListener('abort', abort, { once: true })
  })
}
