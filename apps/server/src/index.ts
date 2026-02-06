import express, { type NextFunction, type Request, type Response } from 'express'
import cors from 'cors'
import session from 'express-session'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { readConfig, writeConfig, redactConfig } from './storage/configStore.js'
import { ensureAuthInitialized, generateSessionSecret, readAuth, updateCredentials, verifyPassword } from './auth/authStore.js'
import {
  listBases,
  fetchBaseSchema,
  applyPlan,
  NocoApiError,
  type NocoEnvConfig,
} from './nocodb/nocoClient.js'
import { diffSchemas, type SchemaDiff } from './schema/diff.js'
import { buildPlan, type Plan } from './schema/plan.js'

const app = express()

const PORT = Number(process.env.PORT || 5175)
const CORS_ORIGIN = process.env.CORS_ORIGIN

if (CORS_ORIGIN && CORS_ORIGIN.trim()) {
  const allow = CORS_ORIGIN.split(',').map((s) => s.trim())
  app.use(cors({ origin: allow, credentials: true }))
} else {
  // 默认放开，便于部署：
  // - 同源部署不依赖 CORS
  // - 分离部署时也避免因为忘记配 CORS_ORIGIN 而无法访问
  // origin: true 会把响应 origin 反射为请求 origin（便于本地 5173 -> 5175，且可携带 cookie）
  app.use(cors({ origin: true, credentials: true }))
}
app.use(express.json({ limit: '2mb' }))

// --- auth/session ---
await ensureAuthInitialized()

const SESSION_SECRET = (process.env.SESSION_SECRET || '').trim() || generateSessionSecret()
if (!(process.env.SESSION_SECRET || '').trim()) {
  // eslint-disable-next-line no-console
  console.warn('[server] SESSION_SECRET 未设置：已使用临时随机值（重启会导致登录失效；生产环境请在 .env 中设置）')
}

app.use(
  session({
    name: 'nocodb_compare_sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      maxAge: 1000 * 60 * 60 * 12, // 12h
    },
  }),
)

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const s: any = (req as any).session
  if (s?.user?.username) return next()
  return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: '请先登录' })
}

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => any
function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ ok: true })
})

app.get(
  '/api/auth/me',
  asyncHandler(async (req: Request, res: Response) => {
    const s: any = (req as any).session
    if (s?.user?.username) return res.json({ ok: true, user: { username: s.user.username } })
    return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' })
  }),
)

app.post(
  '/api/auth/login',
  asyncHandler(async (req: Request, res: Response) => {
    const Body = z.object({ username: z.string().min(1), password: z.string().min(1) })
    const { username, password } = Body.parse(req.body)

    const ok = await verifyPassword(username, password)
    if (!ok) return res.status(401).json({ ok: false, error: 'INVALID_CREDENTIALS', message: '用户名或密码错误' })

    ;(req as any).session.user = { username }
    res.json({ ok: true, user: { username } })
  }),
)

app.post(
  '/api/auth/logout',
  asyncHandler(async (req: Request, res: Response) => {
    await new Promise<void>((resolve) => {
      ;(req as any).session?.destroy(() => resolve())
    })
    res.json({ ok: true })
  }),
)

app.get(
  '/api/auth/bootstrap',
  asyncHandler(async (_req: Request, res: Response) => {
    const rec = await readAuth()
    res.json({ ok: true, initialized: true, username: rec.username })
  }),
)

app.post(
  '/api/auth/reset',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const Body = z.object({
      currentPassword: z.string().min(1),
      newUsername: z.string().optional(),
      newPassword: z.string().optional(),
    })
    const { currentPassword, newUsername, newPassword } = Body.parse(req.body)

    const s: any = (req as any).session
    const currentUser = s?.user?.username
    const ok = await verifyPassword(currentUser, currentPassword)
    if (!ok) return res.status(401).json({ ok: false, error: 'INVALID_CREDENTIALS', message: '当前密码不正确' })

    const next = await updateCredentials({ newUsername, newPassword })
    // 更新 session 里的用户名
    s.user = { username: next.username }
    res.json({ ok: true, user: { username: next.username } })
  }),
)

// 保护所有业务 API
app.use('/api', (req: Request, res: Response, next: NextFunction) => {
  if (req.path === '/health') return next()
  if (req.path.startsWith('/auth/')) return next()
  return requireAuth(req, res, next)
})

app.get(
  '/api/config',
  asyncHandler(async (_req: Request, res: Response) => {
    const cfg = await readConfig()
    res.json(redactConfig(cfg))
  }),
)

app.post(
  '/api/config',
  asyncHandler(async (req: Request, res: Response) => {
    const Schema = z.object({
      source: z.any().optional(),
      target: z.any().optional(),
      options: z.any().optional(),
    })
    const parsed = Schema.parse(req.body)
    const current = await readConfig()

    const mergeEnv = (prev: any, nextEnv: any) => {
      const out = { ...(prev || {}), ...(nextEnv || {}) }
      const token = (nextEnv?.apiToken ?? '').trim()
      if (!token || token === '***') {
        if (prev?.apiToken) out.apiToken = prev.apiToken
      }
      return out
    }

    const merged = {
      ...current,
      ...parsed,
      source: mergeEnv((current as any).source, (parsed as any).source),
      target: mergeEnv((current as any).target, (parsed as any).target),
      options: { ...((current as any).options || {}), ...((parsed as any).options || {}) },
    }

    const next = await writeConfig(merged)
    res.json(redactConfig(next))
  }),
)

app.post(
  '/api/bases',
  asyncHandler(async (req: Request, res: Response) => {
    const Body = z.object({
      env: z.object({
        baseUrl: z.string().min(1),
        apiToken: z.string().min(1),
        apiVersion: z.enum(['v2', 'v3']).default('v2'),
      }),
    })
    const { env } = Body.parse(req.body)
    const current = await readConfig()
    const token = (env.apiToken ?? '').trim()
    const hydrated = {
      ...env,
      apiToken: token || (current as any)?.target?.apiToken || (current as any)?.source?.apiToken || env.apiToken,
    }

    const list = await listBases(hydrated)
    res.json({ list })
  }),
)

app.post(
  '/api/compare',
  asyncHandler(async (req: Request, res: Response) => {
    const Body = z.object({
      source: z.custom<NocoEnvConfig>(),
      target: z.custom<NocoEnvConfig>(),
      options: z
        .object({
          ignoreCase: z.boolean().default(true),
          includeDeleteOps: z.boolean().default(false),
          includeSystemColumns: z.boolean().default(false),
        })
        .default({
          ignoreCase: true,
          includeDeleteOps: false,
          includeSystemColumns: false,
        }),
    })

    const parsed = Body.parse(req.body)
    const { options } = parsed

    const current = await readConfig()
    const source: NocoEnvConfig = {
      ...(parsed.source as any),
      apiToken:
        (parsed.source?.apiToken ?? '').trim() || ((current as any)?.source?.apiToken as string) || parsed.source?.apiToken,
    }
    const target: NocoEnvConfig = {
      ...(parsed.target as any),
      apiToken:
        (parsed.target?.apiToken ?? '').trim() || ((current as any)?.target?.apiToken as string) || parsed.target?.apiToken,
    }

    if (source?.apiVersion === 'v3' || target?.apiVersion === 'v3') {
      return res.status(400).json({
        ok: false,
        error: 'UNSUPPORTED_API_VERSION',
        message: '当前 schema 拉取/对比优先支持 v2；v3 需要后续扩展（可先把 API 版本切回 v2）',
      })
    }

    const [sourceSchema, targetSchema] = await Promise.all([
      fetchBaseSchema(source, options),
      fetchBaseSchema(target, options),
    ])

    const diff: SchemaDiff = diffSchemas(sourceSchema, targetSchema, options)
    const plan: Plan = buildPlan(diff, { source, target, options })

    res.json({ diff, plan })
  }),
)

app.post(
  '/api/apply',
  asyncHandler(async (req: Request, res: Response) => {
    const Body = z.object({
      target: z.custom<NocoEnvConfig>(),
      plan: z.custom<Plan>(),
      selectedStepIds: z.array(z.string()).default([]),
      dryRun: z.boolean().default(false),
    })

    const parsed = Body.parse(req.body)
    const current = await readConfig()
    const target: NocoEnvConfig = {
      ...(parsed.target as any),
      apiToken:
        (parsed.target?.apiToken ?? '').trim() || ((current as any)?.target?.apiToken as string) || parsed.target?.apiToken,
    }

    const result = await applyPlan({
      target,
      plan: parsed.plan,
      selectedStepIds: parsed.selectedStepIds,
      dryRun: parsed.dryRun,
    })
    res.json(result)
  }),
)

function planToJsonl(p: Plan) {
  return p.steps
    .map((s) =>
      JSON.stringify({
        id: s.id,
        title: s.title,
        danger: !!s.danger,
        meta: s.meta,
        request: {
          method: s.request.method,
          url: s.request.url,
          headers: s.request.headers,
          body: s.request.body ?? null,
        },
      }),
    )
    .join('\n')
}

app.get(
  '/api/export/jsonl',
  asyncHandler(async (req: Request, res: Response) => {
    // 兼容旧的 GET 导出：用 base64 放在 query 里（大 plan 可能超长）
    const PlanSchema = z.object({ plan: z.string().min(2) })
    const { plan } = PlanSchema.parse(req.query)
    const decoded = JSON.parse(Buffer.from(plan, 'base64').toString('utf8')) as Plan

    res.setHeader('content-type', 'text/plain; charset=utf-8')
    res.send(planToJsonl(decoded))
  }),
)

app.post(
  '/api/export/jsonl',
  asyncHandler(async (req: Request, res: Response) => {
    const Body = z.object({ plan: z.custom<Plan>() })
    const { plan } = Body.parse(req.body)

    res.setHeader('content-type', 'text/plain; charset=utf-8')
    res.send(planToJsonl(plan))
  }),
)

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  // eslint-disable-next-line no-console
  console.error(err)

  if (err instanceof z.ZodError) {
    return res.status(400).json({
      ok: false,
      error: 'BAD_REQUEST',
      message: 'Invalid request body',
      issues: err.issues,
    })
  }

  if (err instanceof NocoApiError) {
    return res.status(err.status).json({
      ok: false,
      error: 'NOCO_API_ERROR',
      message: err.message,
      details: err.bodyText,
    })
  }

  const message = err instanceof Error ? err.message : 'Unknown error'
  return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR', message })
})

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[server] listening on http://localhost:${PORT}`)
})

// --- optional: serve web build ---
// 在生产环境（或显式指定 SERVE_WEB=1）时，后端直接托管 apps/web/dist，实现单进程部署。
try {
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const webDist = path.resolve(__dirname, '../../web/dist')
  const shouldServeWeb = process.env.SERVE_WEB === '1' || process.env.NODE_ENV === 'production'

  if (shouldServeWeb && fs.existsSync(path.join(webDist, 'index.html'))) {
    app.use(express.static(webDist))
    app.get('*', (req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith('/api/')) return next()
      res.sendFile(path.join(webDist, 'index.html'))
    })
    // eslint-disable-next-line no-console
    console.log(`[server] serving web dist from ${webDist}`)
  }
} catch {
  // ignore
}
