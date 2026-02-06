import type { ThemeConfig } from 'antd'
import { theme as antdTheme } from 'antd'

export type ThemeMode = 'ops' | 'light'

const STORAGE_KEY = 'nocodb-compare:themeMode'

export function loadThemeMode(): ThemeMode {
  const v = (localStorage.getItem(STORAGE_KEY) || '').trim()
  if (v === 'light' || v === 'ops') return v
  return 'ops'
}

export function saveThemeMode(mode: ThemeMode) {
  localStorage.setItem(STORAGE_KEY, mode)
}

export function getAntdThemeConfig(mode: ThemeMode): ThemeConfig {
  if (mode === 'light') {
    // 轻量主题也稍微“压白”，避免太刺眼
    return {
      token: {
        colorPrimary: '#1677ff',
        colorBgLayout: '#f5f7fb',
      },
    }
  }

  // 运维风：深色底 + 蓝绿点缀（更像监控/运维控制台）
  return {
    algorithm: antdTheme.darkAlgorithm,
    token: {
      colorPrimary: '#00b8d9', // cyan
      colorSuccess: '#36cfc9',
      colorWarning: '#faad14',
      colorError: '#ff4d4f',

      // 背景层级
      colorBgLayout: '#0b1220',
      colorBgContainer: '#0f1a2b',
      colorBgElevated: '#12203a',

      // 边框/文字
      colorBorderSecondary: '#1d2b45',
      colorText: 'rgba(255,255,255,0.88)',
      colorTextSecondary: 'rgba(255,255,255,0.65)',

      // 圆角稍微更“产品化”
      borderRadius: 8,
    },
    components: {
      Layout: {
        headerBg: '#0f1a2b',
        siderBg: '#0f1a2b',
        bodyBg: '#0b1220',
      },
      Menu: {
        darkItemBg: '#0f1a2b',
        darkSubMenuItemBg: '#0f1a2b',
        darkItemSelectedBg: '#16385a',
        darkItemSelectedColor: '#7de3f4',
        darkItemHoverColor: '#7de3f4',
      },
      Card: {
        headerBg: '#0f1a2b',
      },
      Table: {
        headerBg: '#0f1a2b',
      },
    },
  }
}
