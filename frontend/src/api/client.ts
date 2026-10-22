export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL?.trim() || '/api').replace(/\/$/, '')

export class ApiError extends Error {
  constructor(message: string, public status = 0) { super(message); this.name = 'ApiError' }
}

interface RequestOptions {
  method?: 'GET' | 'POST'
  body?: unknown
  signal?: AbortSignal
  timeout?: number
}

function errorDetail(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map((item) => {
    if (item && typeof item === 'object' && 'msg' in item) return String(item.msg)
    return 'The submitted values could not be accepted.'
  }).join(' ')
  return 'The request could not be completed. Please try again.'
}

export async function request<T>(path: string, { method = 'GET', body, signal, timeout = 60_000 }: RequestOptions = {}): Promise<T> {
  const controller = new AbortController()
  let timedOut = false
  const cancel = () => controller.abort()
  if (signal?.aborted) controller.abort()
  signal?.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeout)
  try {
    const form = body instanceof FormData
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method, signal: controller.signal,
      headers: body !== undefined && !form ? { 'Content-Type': 'application/json' } : undefined,
      body: body === undefined ? undefined : form ? body : JSON.stringify(body),
    })
    const text = await response.text()
    let data: unknown
    try { data = text ? JSON.parse(text) : null } catch {
      throw new ApiError('The API returned an unexpected response. Check that the backend is running and the API address is correct.', response.status)
    }
    if (!response.ok) {
      const detail = data && typeof data === 'object' && 'detail' in data ? data.detail : null
      throw new ApiError(errorDetail(detail), response.status)
    }
    return data as T
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError')
    if (timedOut) throw new ApiError('This request is taking longer than expected. Please try again when the service is ready.')
    if (error instanceof ApiError) throw error
    throw new ApiError('Cannot reach the backend. Start FastAPI on port 8000, then try again.')
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
  }
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}
export function isCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}
