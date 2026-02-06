import { Button, Dropdown, Form, Input, Layout, Menu, Modal, Select, Space, Typography, message, theme } from 'antd'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { CloudUploadOutlined, DiffOutlined, SettingOutlined, LogoutOutlined, UserOutlined } from '@ant-design/icons'
import type { ThemeMode } from './theme'
import { fetchJson } from './api'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { availableLanguages, languageLabels, setStoredLanguage, type LanguageCode, normalizeLanguage } from './i18n'

const { Header, Sider, Content } = Layout

export function AppShell(props: { themeMode: ThemeMode; setThemeMode: (m: ThemeMode) => void }) {
  const { token } = theme.useToken()
  const nav = useNavigate()
  const loc = useLocation()
  const { t, i18n } = useTranslation()

  const selectedKey = loc.pathname.startsWith('/import') ? 'import' : 'compare'

  const { themeMode, setThemeMode } = props

  const [username, setUsername] = useState<string>('')
  const [openReset, setOpenReset] = useState(false)
  const [resetForm] = Form.useForm()

  useEffect(() => {
    ;(async () => {
      try {
        const me = await fetchJson<any>('/api/auth/me')
        setUsername(me?.user?.username ?? '')
      } catch {
        setUsername('')
      }
    })()
  }, [])

  async function logout() {
    try {
      await fetchJson('/api/auth/logout', { method: 'POST' })
    } finally {
      nav('/login', { replace: true })
    }
  }

  async function resetCredentials() {
    const v = await resetForm.validateFields()
    const payload: any = {
      currentPassword: v.currentPassword,
    }
    if ((v.newUsername ?? '').trim()) payload.newUsername = v.newUsername
    if ((v.newPassword ?? '').trim()) payload.newPassword = v.newPassword

    const r = await fetchJson<any>('/api/auth/reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setUsername(r?.user?.username ?? username)
    message.success(t('auth.updated'))
    setOpenReset(false)
    resetForm.resetFields()
  }

  async function setLanguage(lang: LanguageCode) {
    setStoredLanguage(lang)
    await i18n.changeLanguage(lang)
  }

  return (
    <Layout style={{ minHeight: '100vh', background: token.colorBgLayout }}>
      <Sider width={220} style={{ background: token.colorBgContainer }}>
        <div style={{ padding: 16 }}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {t('app.title')}
          </Typography.Title>
          <Typography.Text type="secondary">{t('app.subtitle')}</Typography.Text>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={[
            {
              key: 'compare',
              icon: <DiffOutlined />,
              label: t('nav.compare'),
              onClick: () => nav('/compare'),
            },
            {
              key: 'import',
              icon: <CloudUploadOutlined />,
              label: t('nav.import'),
              onClick: () => nav('/import'),
            },
          ]}
        />
      </Sider>

      <Layout>
        <Header
          style={{
            background: token.colorBgContainer,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            display: 'flex',
            alignItems: 'center',
            padding: '0 16px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, width: '100%' }}>
            <Typography.Text strong style={{ fontSize: 14 }}>
              {selectedKey === 'compare' ? t('header.compareTitle') : t('header.importTitle')}
            </Typography.Text>
            <Space size={8}>
              <Typography.Text type="secondary">{t('header.theme')}</Typography.Text>
              <Select
                size="small"
                value={themeMode}
                style={{ width: 120 }}
                onChange={(v) => setThemeMode(v)}
                options={[
                  { value: 'ops', label: t('header.themeOps') },
                  { value: 'light', label: t('header.themeLight') },
                ]}
              />

              <Typography.Text type="secondary">{t('header.language')}</Typography.Text>
              <Select
                size="small"
                value={normalizeLanguage(i18n.language) as LanguageCode}
                style={{ width: 140 }}
                onChange={(v) => void setLanguage(v)}
                options={availableLanguages.map((code) => ({
                  value: code,
                  label: languageLabels[code] || code,
                }))}
              />

              <Dropdown
                trigger={['click']}
                menu={{
                  items: [
                    {
                      key: 'reset',
                      icon: <SettingOutlined />,
                      label: t('header.changeCredentials'),
                      onClick: () => setOpenReset(true),
                    },
                    {
                      key: 'logout',
                      icon: <LogoutOutlined />,
                      label: t('header.logout'),
                      onClick: () => logout(),
                    },
                  ],
                }}
              >
                <Button size="small" icon={<UserOutlined />}>
                  {username || t('header.user')}
                </Button>
              </Dropdown>
            </Space>
          </div>
        </Header>

        <Content style={{ padding: 16 }}>
          <div style={{ maxWidth: 1200, margin: '0 auto' }}>
            <Outlet />
          </div>
        </Content>
      </Layout>

      <Modal
        title={t('auth.resetTitle')}
        open={openReset}
        onCancel={() => {
          setOpenReset(false)
          resetForm.resetFields()
        }}
        onOk={() => resetCredentials()}
        okText={t('auth.save')}
        cancelText={t('auth.cancel')}
      >
        <Form form={resetForm} layout="vertical">
          <Form.Item
            name="currentPassword"
            label={t('auth.currentPassword')}
            rules={[{ required: true, message: t('validation.currentPasswordRequired') }]}
          >
            <Input.Password />
          </Form.Item>
          <Form.Item name="newUsername" label={t('auth.newUsernameOptional')}>
            <Input placeholder={t('auth.keepUnchanged')} />
          </Form.Item>
          <Form.Item name="newPassword" label={t('auth.newPasswordOptional')}>
            <Input.Password placeholder={t('auth.onlyChangeUsername')} />
          </Form.Item>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            {t('auth.resetTip')}
          </Typography.Paragraph>
        </Form>
      </Modal>
    </Layout>
  )
}
