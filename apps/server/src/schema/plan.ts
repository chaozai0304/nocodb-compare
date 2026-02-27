import type { SchemaDiff } from './diff.js'
import type { NocoEnvConfig, NocoRequest } from '../nocodb/nocoClient.js'
import { createHash } from 'node:crypto'

export type PlanStep = {
  id: string
  title: string
  danger?: boolean
  meta: {
    op:
      | 'table_add'
      | 'table_delete'
      | 'col_add'
      | 'col_update'
      | 'col_delete'
    tableTitle?: string
    columnTitle?: string
  }
  request: NocoRequest
}

export type Plan = {
  createdAt: string
  options: {
    ignoreCase: boolean
  }
  steps: PlanStep[]
}

function makeId(prefix: string, parts: string[]) {
  return `${prefix}:${parts.map((p) => p.replace(/\s+/g, '_')).join(':')}`
}

export function buildPlan(
  diff: SchemaDiff,
  ctx: {
    source: NocoEnvConfig
    target: NocoEnvConfig
    options: { includeDeleteOps: boolean; ignoreCase?: boolean }
  },
): Plan {
  const steps: PlanStep[] = []

  const targetBaseUrl = ctx.target.baseUrl.replace(/\/+$/, '')
  const targetBaseId = ctx.target.baseId
  if (!targetBaseId) throw new Error('buildPlan: target.baseId 缺失')

  const authHeaderName = (ctx.target.apiVersion ?? 'v2') === 'v3' ? 'xc-token' : 'xc-auth'

  // table add
  for (const t of diff.tables) {
    if (t.type === 'add') {
      // v2: POST /api/v2/meta/bases/:baseId/tables
      const url = `${targetBaseUrl}/api/v2/meta/bases/${targetBaseId}/tables`
      const columns = (t.table.columns || [])
        .filter((c: any) => {
          // 系统字段通常不需要创建，但有些 NocoDB/部署会要求在建表时显式提供主键列。
          // 因此：保留 ID/PK/AI 列，即便它标记为 system。
          if (!c?.system) return true
          if (c?.uidt === 'ID') return true
          if (c?.pk || c?.ai) return true
          return false
        })
        .map((c: any) => columnReqFromSource(c))

      const body: any = {
        title: t.table.title,
        // 保持与 source schema 一致：优先使用 source 的 table_name。
        // 之前这里用 safeDbName 会把例如 "Table-新增" 变成 "table"，
        // 导致与现有表别名冲突（DUPLICATE_ALIAS），并造成“差异摘要 vs 导出计划”不一致。
        table_name: (t.table.table_name && String(t.table.table_name).trim())
          ? t.table.table_name
          : safeDbName(t.table.title, 't'),
        // NocoDB v2 create-table schema 要求 columns 必填
        columns,
      }
      if (t.table.description) body.description = t.table.description

      steps.push({
        id: makeId('table_add', [t.table.title]),
        title: `新增表: ${t.table.title}`,
        meta: { op: 'table_add', tableTitle: t.table.title },
        request: exportFriendlyRequest(authHeaderName, { method: 'POST', url, body }),
      })
    }

    if (t.type === 'delete') {
      const url = `${targetBaseUrl}/api/v2/meta/tables/{tableId}`
      steps.push({
        id: makeId('table_delete', [t.table.title]),
        title: `删除表(危险): ${t.table.title}`,
        danger: true,
        meta: { op: 'table_delete', tableTitle: t.table.title },
        request: exportFriendlyRequest(authHeaderName, { method: 'DELETE', url }),
      })
    }
  }

  // column add/update/delete
  for (const c of diff.columns) {
    if (c.type === 'add') {
      // NOTE：这里需要 target tableId，但 diff 里只有 tableTitle。
      // 为了保持计划可导出/可复用，我们在执行时会先重新拉取 target schema 做 title->id 映射。
      // 因此 url 中先用占位符，apply 时会替换。
      const url = `${targetBaseUrl}/api/v2/meta/tables/{tableId}/columns/`
      const body = columnReqFromSource(c.column)

      steps.push({
        id: makeId('col_add', [c.tableTitle, c.column.title]),
        title: `新增字段: ${c.tableTitle}.${c.column.title}`,
        meta: { op: 'col_add', tableTitle: c.tableTitle, columnTitle: c.column.title },
        request: exportFriendlyRequest(authHeaderName, { method: 'POST', url, body }),
      })
    }

    if (c.type === 'update') {
      const url = `${targetBaseUrl}/api/v2/meta/columns/{columnId}`
      const body = columnReqFromSource(c.source)
      steps.push({
        id: makeId('col_update', [c.tableTitle, c.source.title]),
        title: `修改字段: ${c.tableTitle}.${c.source.title} (${c.fieldsChanged.join(', ')})`,
        meta: { op: 'col_update', tableTitle: c.tableTitle, columnTitle: c.source.title },
        request: exportFriendlyRequest(authHeaderName, { method: 'PATCH', url, body }),
      })
    }

    if (c.type === 'delete') {
      const url = `${targetBaseUrl}/api/v2/meta/columns/{columnId}`
      steps.push({
        id: makeId('col_delete', [c.tableTitle, c.column.title]),
        title: `删除字段(危险): ${c.tableTitle}.${c.column.title}`,
        danger: true,
        meta: { op: 'col_delete', tableTitle: c.tableTitle, columnTitle: c.column.title },
        request: exportFriendlyRequest(authHeaderName, { method: 'DELETE', url }),
      })
    }
  }

  return {
    createdAt: new Date().toISOString(),
    options: { ignoreCase: ctx.options.ignoreCase ?? true },
    steps,
  }
}

function slugify(s: string) {
  return (s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 63)
}

function shortHash(s: string) {
  return createHash('sha1').update(String(s ?? '')).digest('hex').slice(0, 8)
}

function safeDbName(input: string, prefix: string) {
  const s = slugify(input)
  let out = s

  // 不能是空
  if (!out) out = `${prefix}_${shortHash(input)}`

  // 避免以数字开头
  if (/^[0-9]/.test(out)) out = `${prefix}_${out}`

  // 再截断一次（防止拼 prefix/hash 后超长）
  return out.slice(0, 63)
}

function columnReqFromSource(col: { title: string; column_name?: string; uidt?: string; dt?: string; meta?: any; validate?: any; rqd?: boolean; pk?: boolean; ai?: boolean; un?: boolean; unique?: boolean | null }) {
  // ColumnReqType 在不同版本/不同类型下字段很丰富。
  // 这里尽量用“最常用且比较稳”的字段。
  const body: any = {
    title: col.title,
    // 与 source 保持一致：优先使用 source 的 column_name。
    // 否则才根据 title 生成一个“安全名”（避免空/非法）。
    column_name: (col.column_name && String(col.column_name).trim())
      ? col.column_name
      : safeDbName(col.title, 'c'),
    uidt: col.uidt,
    dt: col.dt,
    rqd: col.rqd,
    pk: col.pk,
    ai: col.ai,
    un: col.un,
    unique: col.unique,
  }

  if (col.meta != null) body.meta = col.meta
  if (col.validate != null && col.validate !== '') body.validate = col.validate

  // 清理 undefined
  for (const k of Object.keys(body)) {
    if (body[k] === undefined || body[k] === null) delete body[k]
  }

  return body
}

function exportFriendlyRequest(
  authHeaderName: 'xc-auth' | 'xc-token',
  r: { method: any; url: string; body?: any },
): NocoRequest {
  // 导出时不带真实 token，避免泄露
  return {
    method: r.method,
    url: r.url,
    headers: {
      [authHeaderName]: '***',
    },
    body: r.body,
  }
}
