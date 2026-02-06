export async function readBody(res: Response): Promise<any> {
  const ct = res.headers.get('content-type') ?? ''
  if (ct.includes('application/json')) {
    return await res.json()
  }
  return await res.text()
}

export function errorFromResponse(res: Response, body: any): Error {
  if (body && typeof body === 'object') {
    const msg = body.message || body.error || `HTTP ${res.status} ${res.statusText}`
    const detail = body.details ? `\n${String(body.details)}` : ''
    return new Error(`${msg}${detail}`)
  }
  const text = typeof body === 'string' ? body : ''
  return new Error(text || `HTTP ${res.status} ${res.statusText}`)
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    ...init,
  })
  const body = await readBody(res)
  if (!res.ok) throw errorFromResponse(res, body)
  return body as T
}
