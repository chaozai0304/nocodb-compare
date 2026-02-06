import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

const STORAGE_KEY = 'ncc-lang'

export type LanguageCode = string

const localeModules = import.meta.glob('./locales/*.json', { eager: true }) as Record<
  string,
  { default: any }
>

function toLangCode(path: string): string {
  // ./locales/en.json -> en
  // ./locales/zh-CN.json -> zh-CN
  const m = path.match(/\/locales\/(.+)\.json$/)
  return m?.[1] || path
}

const resources: Record<string, { translation: any }> = Object.fromEntries(
  Object.entries(localeModules).map(([path, mod]) => [toLangCode(path), { translation: mod.default }]),
)

export const availableLanguages: LanguageCode[] = Object.keys(resources).sort()

export const languageLabels: Record<string, string> = {
  en: 'English',
  'zh-CN': '简体中文',
}

export function normalizeLanguage(input: string | null | undefined): LanguageCode {
  const v = String(input ?? '').trim()
  if (!availableLanguages.length) return 'en'
  const fallback = availableLanguages.includes('en') ? 'en' : availableLanguages[0]
  if (!v) return fallback

  const lower = v.toLowerCase()
  // Prefer a known zh-CN if user/browser provides zh*.
  if (lower.startsWith('zh')) {
    if (availableLanguages.includes('zh-CN')) return 'zh-CN'
    const found = availableLanguages.find((l) => l.toLowerCase().startsWith('zh'))
    return found || fallback
  }

  // Exact match first
  const exact = availableLanguages.find((l) => l.toLowerCase() === lower)
  if (exact) return exact

  // Prefix match: en-US -> en (if exists)
  const prefix = lower.split('-')[0]
  const prefixMatch = availableLanguages.find((l) => l.toLowerCase() === prefix)
  return prefixMatch || fallback
}

export function getStoredLanguage(): LanguageCode | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return normalizeLanguage(raw)
  } catch {
    return null
  }
}

export function setStoredLanguage(lang: LanguageCode) {
  try {
    localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    // ignore
  }
}

const initialLanguage: LanguageCode = (() => {
  const stored = getStoredLanguage()
  if (stored) return stored
  // Fallback: browser language
  if (typeof navigator !== 'undefined') {
    return normalizeLanguage(navigator.language)
  }
  return normalizeLanguage('en')
})()

void i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: initialLanguage,
    fallbackLng: availableLanguages.includes('en') ? 'en' : availableLanguages[0],
    interpolation: {
      escapeValue: false,
    },
  })

export { i18n }
