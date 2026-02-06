import fs from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { getAppDataDir } from '../storage/configStore.js'

export type AuthRecord = {
  username: string
  passwordHash: string
  updatedAt: string
}

function resolveFilePath(p: string) {
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p)
}

export function getAuthFilePath() {
  const p = process.env.AUTH_FILE
  if (p && p.trim()) return resolveFilePath(p)
  return path.join(getAppDataDir(), 'auth.json')
}

async function ensureDir(filePath: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
}

function defaultCredentials() {
  const u = (process.env.INIT_USERNAME || 'admin').trim() || 'admin'
  const p = (process.env.INIT_PASSWORD || '').trim() || 'ChangeMe123!'
  return { username: u, password: p }
}

export async function ensureAuthInitialized(): Promise<void> {
  const file = getAuthFilePath()
  try {
    const txt = await fs.readFile(file, 'utf8')
    const v = JSON.parse(txt)
    if (v?.username && v?.passwordHash) return
  } catch {
    // not exists
  }

  const { username, password } = defaultCredentials()
  const passwordHash = await bcrypt.hash(password, 10)
  const rec: AuthRecord = { username, passwordHash, updatedAt: new Date().toISOString() }

  await ensureDir(file)
  await fs.writeFile(file, JSON.stringify(rec, null, 2), 'utf8')
}

export async function readAuth(): Promise<AuthRecord> {
  const file = getAuthFilePath()
  await ensureAuthInitialized()
  const txt = await fs.readFile(file, 'utf8')
  return JSON.parse(txt) as AuthRecord
}

export async function verifyPassword(username: string, password: string): Promise<boolean> {
  const rec = await readAuth()
  if (rec.username !== username) return false
  return await bcrypt.compare(password, rec.passwordHash)
}

export async function updateCredentials(param: { newUsername?: string; newPassword?: string }): Promise<AuthRecord> {
  const file = getAuthFilePath()
  const rec = await readAuth()

  const username = (param.newUsername ?? rec.username).trim() || rec.username
  let passwordHash = rec.passwordHash

  if (param.newPassword != null) {
    const pw = String(param.newPassword).trim()
    if (!pw) throw new Error('newPassword 不能为空')
    passwordHash = await bcrypt.hash(pw, 10)
  }

  const next: AuthRecord = {
    username,
    passwordHash,
    updatedAt: new Date().toISOString(),
  }

  await ensureDir(file)
  await fs.writeFile(file, JSON.stringify(next, null, 2), 'utf8')
  return next
}

export function generateSessionSecret() {
  return randomBytes(32).toString('hex')
}
