import { Button, Card, Form, Input, Space, Typography, message } from 'antd'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { fetchJson } from '../api'

type LoginResp = { ok: boolean; user?: { username: string } }

type LocState = { from?: string }

export function LoginPage() {
  const [form] = Form.useForm()
  const nav = useNavigate()
  const loc = useLocation()
  const state = (loc.state || {}) as LocState
  const [loading, setLoading] = useState(false)

  async function login() {
    setLoading(true)
    try {
      const v = await form.validateFields()
      const res = await fetchJson<LoginResp>('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(v),
      })
      if (res.ok) {
        message.success('登录成功')
        nav(state.from || '/compare', { replace: true })
      }
    } catch (e: any) {
      message.error(e?.message ?? String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 520, margin: '64px auto' }}>
      <Card style={{ borderRadius: 12 }}>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div>
            <Typography.Title level={3} style={{ marginTop: 0, marginBottom: 4 }}>
              登录
            </Typography.Title>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
              请输入用户名与密码。首次启动默认账号可在服务器环境变量中配置（INIT_USERNAME/INIT_PASSWORD）。
            </Typography.Paragraph>
          </div>

          <Form form={form} layout="vertical" onFinish={login}>
            <Form.Item name="username" label="用户名" rules={[{ required: true }]}>
              <Input autoFocus placeholder="admin" />
            </Form.Item>
            <Form.Item name="password" label="密码" rules={[{ required: true }]}>
              <Input.Password placeholder="••••••••" />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block>
              登录
            </Button>
          </Form>
        </Space>
      </Card>
    </div>
  )
}
