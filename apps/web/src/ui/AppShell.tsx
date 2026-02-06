import { Button, Dropdown, Form, Input, Layout, Menu, Modal, Select, Space, Typography, message, theme } from 'antd'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { CloudUploadOutlined, DiffOutlined, SettingOutlined, LogoutOutlined, UserOutlined } from '@ant-design/icons'
import type { ThemeMode } from './theme'
import { fetchJson } from './api'
import { useEffect, useState } from 'react'

const { Header, Sider, Content } = Layout

export function AppShell(props: { themeMode: ThemeMode; setThemeMode: (m: ThemeMode) => void }) {
  const { token } = theme.useToken()
  const nav = useNavigate()
  const loc = useLocation()

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
    message.success('账号信息已更新')
    setOpenReset(false)
    resetForm.resetFields()
  }

  return (
    <Layout style={{ minHeight: '100vh', background: token.colorBgLayout }}>
      <Sider width={220} style={{ background: token.colorBgContainer }}>
        <div style={{ padding: 16 }}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            NocoDB 升级平台
          </Typography.Title>
          <Typography.Text type="secondary">Schema 对比 · 计划 · 执行</Typography.Text>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={[
            {
              key: 'compare',
              icon: <DiffOutlined />,
              label: '对比升级',
              onClick: () => nav('/compare'),
            },
            {
              key: 'import',
              icon: <CloudUploadOutlined />,
              label: '导入执行',
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
              {selectedKey === 'compare' ? '对比与生成升级计划' : '导入升级计划并执行'}
            </Typography.Text>
            <Space size={8}>
              <Typography.Text type="secondary">主题</Typography.Text>
              <Select
                size="small"
                value={themeMode}
                style={{ width: 120 }}
                onChange={(v) => setThemeMode(v)}
                options={[
                  { value: 'ops', label: '运维' },
                  { value: 'light', label: '浅色' },
                ]}
              />

              <Dropdown
                trigger={['click']}
                menu={{
                  items: [
                    {
                      key: 'reset',
                      icon: <SettingOutlined />,
                      label: '修改用户名/密码',
                      onClick: () => setOpenReset(true),
                    },
                    {
                      key: 'logout',
                      icon: <LogoutOutlined />,
                      label: '退出登录',
                      onClick: () => logout(),
                    },
                  ],
                }}
              >
                <Button size="small" icon={<UserOutlined />}>
                  {username || '用户'}
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
        title="修改用户名/密码"
        open={openReset}
        onCancel={() => {
          setOpenReset(false)
          resetForm.resetFields()
        }}
        onOk={() => resetCredentials()}
        okText="保存"
        cancelText="取消"
      >
        <Form form={resetForm} layout="vertical">
          <Form.Item
            name="currentPassword"
            label="当前密码"
            rules={[{ required: true, message: '请输入当前密码' }]}
          >
            <Input.Password />
          </Form.Item>
          <Form.Item name="newUsername" label="新用户名（可选）">
            <Input placeholder="不填则保持不变" />
          </Form.Item>
          <Form.Item name="newPassword" label="新密码（可选）">
            <Input.Password placeholder="不填则仅修改用户名" />
          </Form.Item>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            提示：建议首次登录后立即修改默认密码。
          </Typography.Paragraph>
        </Form>
      </Modal>
    </Layout>
  )
}
