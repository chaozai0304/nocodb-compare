export type EnvConfig = {
  baseUrl: string
  apiToken?: string
  apiVersion: 'v2' | 'v3'
  baseId?: string
  workspaceId?: string
  apiTokenSaved?: boolean
}

export type CompareOptions = {
  ignoreCase: boolean
  includeDeleteOps: boolean
  includeSystemColumns: boolean
}

export type PlanStep = {
  id: string
  title: string
  danger?: boolean
  meta?: { op?: string; tableTitle?: string; columnTitle?: string }
  request: { method: string; url: string; headers: Record<string, string>; body?: any }
}

export type Plan = {
  createdAt: string
  options?: {
    ignoreCase?: boolean
  }
  steps: PlanStep[]
}

export type ApplyResult = {
  ok: boolean
  results: Array<{ id: string; ok: boolean; error?: string; status?: number; details?: string }>
}
