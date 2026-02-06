import { z } from 'zod'

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'

export type NocoEnvConfig = {
  baseUrl: string
  apiToken: string
  apiVersion?: 'v2' | 'v3'
  baseId?: string
  workspaceId?: string
}

export type NocoRequest = {
  method: HttpMethod
  url: string
  headers: Record<string, string>
  body?: any
}

export class NocoApiError extends Error {
  status: number
  statusText: string
  bodyText: string

  constructor(param: { status: number; statusText: string; bodyText: string; message?: string }) {
    super(param.message ?? `NocoDB API ${param.status} ${param.statusText}`)
    this.name = 'NocoApiError'
    this.status = param.status
    this.statusText = param.statusText
    this.bodyText = param.bodyText
  }
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, '')
}

function rewriteUrlToTarget(rawUrl: string, target: NocoEnvConfig): string {
  const targetBase = normalizeBaseUrl(target.baseUrl)
  if (!targetBase) return rawUrl

  let pathWithQuery = rawUrl
  try {
    const u = new URL(rawUrl)
    pathWithQuery = `${u.pathname}${u.search}`
  } catch {
    // rawUrl 可能是相对路径
    if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
      // 不是合法 URL 的情况下，保底不改
      pathWithQuery = rawUrl
    } else if (rawUrl.startsWith('/')) {
      pathWithQuery = rawUrl
    } else {
      pathWithQuery = `/${rawUrl}`
    }
  }

  // 如果导入文件来自其他环境，可能带了不同 baseId。这里按用户填写的 target.baseId 进行重写。
  if (target.baseId) {
    pathWithQuery = pathWithQuery.replace(
      /\/api\/v2\/meta\/bases\/[^/]+/,
      `/api/v2/meta/bases/${target.baseId}`,
    )
  }

  // 若 pathWithQuery 仍然是绝对 URL（比如上面 catch 的保底），则不再拼接
  if (pathWithQuery.startsWith('http://') || pathWithQuery.startsWith('https://')) {
    return pathWithQuery
  }

  return `${targetBase}${pathWithQuery}`
}

function authHeaders(env: NocoEnvConfig): Record<string, string> {
  const token = (env.apiToken ?? '').trim()

  // NocoDB 在不同版本/部署中 header 可能为 xc-auth 或 xc-token。
  // 这里同时发送两者以提升兼容性（通常不会冲突）。
  const headers: Record<string, string> = {
    'xc-auth': token,
    'xc-token': token,
  }

  // 如果用户粘贴的是标准 Bearer token（例如来自反代/自定义鉴权），顺便带上。
  if (/^bearer\s+/i.test(token)) {
    headers['authorization'] = token
  }

  return headers
}

async function requestJson<T>(req: NocoRequest): Promise<T> {
  const res = await fetch(req.url, {
    method: req.method,
    headers: {
      'content-type': 'application/json',
      ...req.headers,
    },
    body: req.body ? JSON.stringify(req.body) : undefined,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new NocoApiError({
      status: res.status,
      statusText: res.statusText,
      bodyText: text,
      message: `NocoDB API ${res.status} ${res.statusText}`,
    })
  }

  return (await res.json()) as T
}

export async function listBases(env: Pick<NocoEnvConfig, 'baseUrl' | 'apiToken' | 'apiVersion'>) {
  const baseUrl = normalizeBaseUrl(env.baseUrl)
  const apiVersion = env.apiVersion ?? 'v2'

  if (apiVersion === 'v2') {
    // GET /api/v2/meta/bases/
    const url = `${baseUrl}/api/v2/meta/bases/`
    const data = await requestJson<any>({
      method: 'GET',
      url,
      headers: authHeaders(env as NocoEnvConfig),
    })

    const list = Array.isArray(data?.list) ? data.list : data
    return (list || []).map((b: any) => ({ id: b.id, title: b.title }))
  }

  // v3：必须带 workspaceId
  if (!('workspaceId' in env) || !(env as any).workspaceId) {
    throw new Error('v3 需要 workspaceId 才能列出 bases')
  }

  const url = `${baseUrl}/api/v3/meta/workspaces/${(env as any).workspaceId}/bases`
  const data = await requestJson<any>({
    method: 'GET',
    url,
    headers: authHeaders(env as NocoEnvConfig),
  })

  const list = Array.isArray(data?.list) ? data.list : data
  return (list || []).map((b: any) => ({ id: b.id, title: b.title }))
}

export type NormalizedColumn = {
  id: string
  title: string
  column_name?: string
  uidt?: string
  dt?: string
  rqd?: boolean
  pk?: boolean
  ai?: boolean
  un?: boolean
  unique?: boolean
  system?: boolean
  meta?: any
  validate?: any
  raw: any
}

export type NormalizedTable = {
  id: string
  title: string
  table_name?: string
  description?: string | null
  columns: NormalizedColumn[]
  raw: any
}

export type NormalizedBaseSchema = {
  baseId: string
  tables: NormalizedTable[]
}

export async function fetchBaseSchema(
  env: NocoEnvConfig,
  options?: { includeSystemColumns?: boolean },
): Promise<NormalizedBaseSchema> {
  const apiVersion = env.apiVersion ?? 'v2'
  if (apiVersion !== 'v2') {
    throw new Error('当前 server 侧 schema 拉取实现优先支持 v2（可按需扩展 v3）')
  }
  if (!env.baseId) throw new Error('缺少 baseId')

  const baseUrl = normalizeBaseUrl(env.baseUrl)
  const headers = authHeaders(env)

  // 1) list tables
  const tablesUrl = `${baseUrl}/api/v2/meta/bases/${env.baseId}/tables?includeM2M=true`
  const tablesRes = await requestJson<any>({ method: 'GET', url: tablesUrl, headers })
  const tables = (tablesRes?.list ?? []) as any[]

  // 2) get each table meta (contains columns)
  const normalized: NormalizedTable[] = []

  for (const t of tables) {
    const tableMetaUrl = `${baseUrl}/api/v2/meta/tables/${t.id}`
    const meta = await requestJson<any>({ method: 'GET', url: tableMetaUrl, headers })

    const cols = (meta?.columns ?? []) as any[]
    const normCols: NormalizedColumn[] = cols
      .map((c: any) => {
        const rawMeta = typeof c.meta === 'string' ? safeJsonParse(c.meta) : c.meta
        const rawValidate = typeof c.validate === 'string' ? safeJsonParse(c.validate) : c.validate
        return {
          id: c.id,
          title: c.title,
          column_name: c.column_name,
          uidt: c.uidt,
          dt: c.dt,
          rqd: c.rqd,
          pk: c.pk,
          ai: c.ai,
          un: c.un,
          unique: c.unique,
          system: c.system,
          meta: rawMeta,
          validate: rawValidate,
          raw: { ...c, meta: rawMeta, validate: rawValidate },
        }
      })
      .filter((c) => (options?.includeSystemColumns ? true : !c.system))

    normalized.push({
      id: meta?.id ?? t.id,
      title: meta?.title ?? t.title,
      table_name: meta?.table_name ?? meta?.tableName ?? meta?.name,
      description: meta?.description ?? null,
      columns: normCols,
      raw: meta,
    })
  }

  return {
    baseId: env.baseId,
    tables: normalized,
  }
}

function safeJsonParse(v: any) {
  try {
    return JSON.parse(v)
  } catch {
    return v
  }
}

export async function applyPlan(param: {
  target: NocoEnvConfig
  plan: {
    options?: { ignoreCase?: boolean }
    steps: Array<{
      id: string
      request: NocoRequest
      danger?: boolean
      meta?: { op?: string; tableTitle?: string; columnTitle?: string }
    }>
  }
  selectedStepIds: string[]
  dryRun: boolean
}) {
  const { target, plan, selectedStepIds, dryRun } = param
  const selected = new Set(selectedStepIds.length ? selectedStepIds : plan.steps.map((s) => s.id))

  const results: Array<{ id: string; ok: boolean; error?: string; status?: number; details?: string }> = []

  const ignoreCase = plan.options?.ignoreCase ?? true
  const titleKey = (s: string) => {
    const t = (s ?? '').trim()
    return ignoreCase ? t.toLowerCase() : t
  }

  // 为了把 {tableId}/{columnId} 占位符替换成真实 id，这里先拉一次 target schema
  let schema: NormalizedBaseSchema | null = null
  const tableByTitle = new Map<string, NormalizedTable>()
  const columnsByTableTitle = new Map<string, Map<string, NormalizedColumn>>()

  async function refreshSchema() {
    schema = await fetchBaseSchema(target, { includeSystemColumns: true })
    tableByTitle.clear()
    columnsByTableTitle.clear()

    for (const t of schema.tables) {
      const tk = titleKey(t.title)
      tableByTitle.set(tk, t)
      const cm = new Map<string, NormalizedColumn>()
      for (const c of t.columns) cm.set(titleKey(c.title), c)
      columnsByTableTitle.set(tk, cm)
    }
  }

  await refreshSchema()

  function resolveUrl(step: any): string {
    let url = step.request.url

    if (url.includes('{tableId}')) {
      const tableTitle = step.meta?.tableTitle
      if (!tableTitle) throw new Error(`Step ${step.id} 缺少 meta.tableTitle，无法解析 {tableId}`)
      const table = tableByTitle.get(titleKey(tableTitle))
      if (!table) throw new Error(`目标环境未找到表 '${tableTitle}'，无法解析 {tableId}`)
      url = url.replaceAll('{tableId}', table.id)
    }

    if (url.includes('{columnId}')) {
      const tableTitle = step.meta?.tableTitle
      const columnTitle = step.meta?.columnTitle
      if (!tableTitle || !columnTitle) {
        throw new Error(`Step ${step.id} 缺少 meta.tableTitle/meta.columnTitle，无法解析 {columnId}`)
      }
      const cm = columnsByTableTitle.get(titleKey(tableTitle))
      const col = cm?.get(titleKey(columnTitle))
      if (!col) throw new Error(`目标环境未找到字段 '${tableTitle}.${columnTitle}'，无法解析 {columnId}`)
      url = url.replaceAll('{columnId}', col.id)
    }

    return url
  }

  const priorityOf = (op?: string) => {
    switch (op) {
      case 'table_add':
        return 10
      case 'col_add':
        return 20
      case 'col_update':
        return 30
      case 'col_delete':
        return 40
      case 'table_delete':
        return 90
      default:
        return 50
    }
  }

  const stepsToRun = plan.steps
    .filter((s) => selected.has(s.id))
    .slice()
    .sort((a, b) => {
      const pa = priorityOf(a.meta?.op)
      const pb = priorityOf(b.meta?.op)
      if (pa !== pb) return pa - pb
      // 同优先级下，按表名稳定排序，保证执行顺序可预测
      const ta = titleKey(a.meta?.tableTitle ?? '')
      const tb = titleKey(b.meta?.tableTitle ?? '')
      if (ta !== tb) return ta < tb ? -1 : 1
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })

  for (const step of stepsToRun) {

    if (dryRun) {
      results.push({ id: step.id, ok: true })
      continue
    }

    try {
      // NOTE: request.headers 已经是“导出友好”的 header（token 已隐藏）。这里需要注入真实 token。
      const headers = {
        ...step.request.headers,
        ...authHeaders(target),
      }

      const url = rewriteUrlToTarget(resolveUrl(step), target)

      const resp = await requestJson<any>({
        ...step.request,
        url,
        headers,
      })

      // 若新建表成功，把新表 id 写进 map，便于后续字段创建
      const createdTableId = resp?.id ?? resp?.table?.id ?? resp?.data?.id
      if (step.meta?.op === 'table_add' && step.meta?.tableTitle && createdTableId) {
        const newTable: NormalizedTable = {
          id: createdTableId,
          title: step.meta.tableTitle,
          columns: [],
          raw: resp,
        }
        const tk = titleKey(step.meta.tableTitle)
        tableByTitle.set(tk, newTable)
        columnsByTableTitle.set(tk, new Map())

        // 建表通常会同时创建列；刷新 schema 以便后续 {columnId}/{tableId} 能正确解析
        await refreshSchema()
      }

      // 字段新增/更新后，为了确保后续步骤能解析到最新 columnId，刷新一次 schema
      if (['col_add', 'col_update', 'col_delete'].includes(step.meta?.op ?? '')) {
        await refreshSchema()
      }

      results.push({ id: step.id, ok: true })
    } catch (e: any) {
      if (e instanceof NocoApiError) {
        results.push({
          id: step.id,
          ok: false,
          status: e.status,
          error: e.message,
          details: e.bodyText,
        })
      } else {
        results.push({ id: step.id, ok: false, error: e?.message ?? String(e) })
      }
    }
  }

  return { ok: results.every((r) => r.ok), results }
}
