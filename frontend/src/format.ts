import type { ForecastRecord } from './api/types'

export const number = (value: number | null | undefined, decimals = 0) => value == null ? '—' : new Intl.NumberFormat('en-IN', { maximumFractionDigits: decimals }).format(value)
export const compact = (value: number | null | undefined) => value == null ? '—' : new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
export const money = (value: number | null | undefined, currency: string, short = false) => value == null ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0, ...(short ? { notation: 'compact' as const, maximumFractionDigits: 1 } : {}) }).format(value)
export const dateLabel = (value: string, full = false) => new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(full ? { year: 'numeric' as const } : {}) })

export function exportForecastCSV(rows: ForecastRecord[]) {
  const keys: (keyof ForecastRecord)[] = ['product_id', 'category', 'store_id', 'store_name', 'forecast_date', 'predicted_units', 'model_name', 'model_version']
  const cell = (value: string | number) => {
    const safe = typeof value === 'string' && /^[=+\-@\t\r]/.test(value) ? `'${value}` : String(value)
    return `"${safe.replaceAll('"', '""')}"`
  }
  const csv = '\uFEFF' + [keys.join(','), ...rows.map((row) => keys.map((key) => cell(row[key])).join(','))].join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = 'sales-forecast.csv'; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
