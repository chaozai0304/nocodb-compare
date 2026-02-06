import type { NormalizedBaseSchema, NormalizedColumn, NormalizedTable } from '../nocodb/nocoClient.js'

export type DiffOptions = {
  ignoreCase: boolean
  includeDeleteOps: boolean
}

export type ColumnChange =
  | { type: 'add'; tableTitle: string; column: NormalizedColumn }
  | { type: 'delete'; tableTitle: string; column: NormalizedColumn }
  | {
      type: 'update'
      tableTitle: string
      source: NormalizedColumn
      target: NormalizedColumn
      fieldsChanged: string[]
    }

export type TableChange =
  | { type: 'add'; table: NormalizedTable }
  | { type: 'delete'; table: NormalizedTable }

export type SchemaDiff = {
  tables: TableChange[]
  columns: ColumnChange[]
}

function keyOfTitle(title: string, ignoreCase: boolean) {
  const t = (title ?? '').trim()
  return ignoreCase ? t.toLowerCase() : t
}

function columnSignature(c: NormalizedColumn) {
  // 这里取“结构相关且相对安全”的字段做对比。
  // 你后续如果想更严格/更宽松，可以扩展或做成 UI 可配置。
  return {
    title: c.title,
    uidt: c.uidt,
    dt: c.dt,
    rqd: !!c.rqd,
    pk: !!c.pk,
    ai: !!c.ai,
    un: !!c.un,
    unique: !!c.unique,
  }
}

export function diffSchemas(source: NormalizedBaseSchema, target: NormalizedBaseSchema, opt: DiffOptions): SchemaDiff {
  const tablesDiff: TableChange[] = []
  const colsDiff: ColumnChange[] = []

  const sourceTables = new Map<string, NormalizedTable>()
  const targetTables = new Map<string, NormalizedTable>()

  for (const t of source.tables) sourceTables.set(keyOfTitle(t.title, opt.ignoreCase), t)
  for (const t of target.tables) targetTables.set(keyOfTitle(t.title, opt.ignoreCase), t)

  // tables add/delete
  for (const [k, st] of sourceTables) {
    if (!targetTables.has(k)) tablesDiff.push({ type: 'add', table: st })
  }
  if (opt.includeDeleteOps) {
    for (const [k, tt] of targetTables) {
      if (!sourceTables.has(k)) tablesDiff.push({ type: 'delete', table: tt })
    }
  }

  // columns add/update/delete for common tables
  for (const [k, st] of sourceTables) {
    const tt = targetTables.get(k)
    if (!tt) continue

    const sCols = new Map<string, NormalizedColumn>()
    const tCols = new Map<string, NormalizedColumn>()

    for (const c of st.columns) sCols.set(keyOfTitle(c.title, opt.ignoreCase), c)
    for (const c of tt.columns) tCols.set(keyOfTitle(c.title, opt.ignoreCase), c)

    for (const [ck, sc] of sCols) {
      const tc = tCols.get(ck)
      if (!tc) {
        colsDiff.push({ type: 'add', tableTitle: st.title, column: sc })
      } else {
        const a = columnSignature(sc)
        const b = columnSignature(tc)
        const fieldsChanged: string[] = []
        for (const f of Object.keys(a) as (keyof typeof a)[]) {
          if (JSON.stringify(a[f]) !== JSON.stringify(b[f])) fieldsChanged.push(String(f))
        }
        if (fieldsChanged.length) {
          colsDiff.push({ type: 'update', tableTitle: st.title, source: sc, target: tc, fieldsChanged })
        }
      }
    }

    if (opt.includeDeleteOps) {
      for (const [ck, tc] of tCols) {
        if (!sCols.has(ck)) colsDiff.push({ type: 'delete', tableTitle: st.title, column: tc })
      }
    }
  }

  return { tables: tablesDiff, columns: colsDiff }
}
