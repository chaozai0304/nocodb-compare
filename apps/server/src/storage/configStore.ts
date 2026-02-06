import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

export type AppConfig = {
  source?: any
  target?: any
  options?: any
}

function resolveFilePath(p: string) {
  // 允许相对路径（以进程 cwd 为基准）
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p)
}

export function getAppDataDir() {
  // 统一把本地敏感配置放到用户目录，避免误提交
  const dir = process.env.NC_HOME || path.join(os.homedir(), '.nocodb-compare')
  return resolveFilePath(dir)
}

export function getConfigFilePath() {
  const p = process.env.CONFIG_FILE
  if (p && p.trim()) return resolveFilePath(p)
  return path.join(getAppDataDir(), 'config.json')
}

function getLegacyConfigFiles() {
  // 兼容旧版本路径（可能存在于仓库内）
  return [
    resolveFilePath('./data/config.json'),
    resolveFilePath('./apps/server/data/config.json'),
  ]
}

async function ensureDir(filePath: string) {
  const dir = path.dirname(filePath)
  await fs.mkdir(dir, { recursive: true })
}

export async function readConfig(): Promise<AppConfig> {
  const primary = getConfigFilePath()

  try {
    const txt = await fs.readFile(primary, 'utf8')
    return JSON.parse(txt)
  } catch {
    // fallback to legacy files
  }

  for (const legacy of getLegacyConfigFiles()) {
    try {
      const txt = await fs.readFile(legacy, 'utf8')
      const cfg = JSON.parse(txt)

      // 自动迁移到主路径（仅当主路径还不存在/不可读）
      try {
        await ensureDir(primary)
        await fs.writeFile(primary, JSON.stringify(cfg, null, 2), 'utf8')
      } catch {
        // ignore migration failure
      }

      return cfg
    } catch {
      // continue
    }
  }

  return {}
}

export async function writeConfig(next: AppConfig): Promise<AppConfig> {
  const primary = getConfigFilePath()
  await ensureDir(primary)
  await fs.writeFile(primary, JSON.stringify(next, null, 2), 'utf8')
  return next
}

export function redactConfig(cfg: AppConfig): AppConfig {
  const clone = JSON.parse(JSON.stringify(cfg || {})) as AppConfig

  for (const k of ['source', 'target'] as const) {
    const env: any = (clone as any)[k]
    if (env && typeof env === 'object') {
      if (env.apiToken) {
        env.apiTokenSaved = true
        env.apiToken = ''
      }
      if (env.xcAuth) {
        env.xcAuthSaved = true
        env.xcAuth = ''
      }
      if (env.xcToken) {
        env.xcTokenSaved = true
        env.xcToken = ''
      }
    }
  }

  return clone
}
