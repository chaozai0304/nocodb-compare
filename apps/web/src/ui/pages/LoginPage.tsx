import { Button, Card, Form, Input, Space, Tag, Typography, message, theme } from 'antd'
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
  const { token } = theme.useToken()

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
    <div
      className="ncc-login-bg"
      style={
        {
          '--ncc-bg-layout': token.colorBgLayout,
          '--ncc-bg-base': token.colorBgBase,
          '--ncc-border': token.colorBorderSecondary,
        } as any
      }
    >
      <style>
        {`
          .ncc-login-bg {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
            position: relative;
            overflow: hidden;
            background:
              radial-gradient(900px circle at 15% 20%, rgba(22, 119, 255, 0.28) 0%, rgba(22, 119, 255, 0) 60%),
              radial-gradient(800px circle at 85% 30%, rgba(0, 208, 255, 0.22) 0%, rgba(0, 208, 255, 0) 55%),
              radial-gradient(900px circle at 35% 85%, rgba(130, 0, 255, 0.18) 0%, rgba(130, 0, 255, 0) 55%),
              linear-gradient(180deg, var(--ncc-bg-layout) 0%, var(--ncc-bg-base) 100%);
          }

          /* grid overlay */
          .ncc-login-bg::before {
            content: '';
            position: absolute;
            inset: -20%;
            background:
              repeating-linear-gradient(
                90deg,
                rgba(255,255,255,0.05) 0,
                rgba(255,255,255,0.05) 1px,
                rgba(255,255,255,0) 1px,
                rgba(255,255,255,0) 48px
              ),
              repeating-linear-gradient(
                0deg,
                rgba(255,255,255,0.04) 0,
                rgba(255,255,255,0.04) 1px,
                rgba(255,255,255,0) 1px,
                rgba(255,255,255,0) 48px
              );
            transform: perspective(900px) rotateX(58deg) translateY(-10%);
            transform-origin: top center;
            opacity: 0.35;
            filter: drop-shadow(0 0 24px rgba(22,119,255,0.18));
            animation: nccGridFloat 10s ease-in-out infinite;
            pointer-events: none;
          }

          /* scanning line */
          .ncc-login-bg::after {
            content: '';
            position: absolute;
            left: -20%;
            right: -20%;
            top: -30%;
            height: 220px;
            background: linear-gradient(90deg, rgba(0,0,0,0) 0%, rgba(0, 208, 255, 0.14) 45%, rgba(22, 119, 255, 0.18) 55%, rgba(0,0,0,0) 100%);
            filter: blur(0.5px);
            transform: rotate(8deg);
            animation: nccScan 6.5s linear infinite;
            pointer-events: none;
          }

          @keyframes nccGridFloat {
            0%, 100% { transform: perspective(900px) rotateX(58deg) translateY(-10%) translateX(0); }
            50% { transform: perspective(900px) rotateX(58deg) translateY(-12%) translateX(-2%); }
          }

          @keyframes nccScan {
            0% { top: -35%; opacity: 0; }
            10% { opacity: 1; }
            50% { opacity: 1; }
            100% { top: 120%; opacity: 0; }
          }

          .ncc-login-card {
            border-radius: 16px;
            border: 1px solid var(--ncc-border);
            background: rgba(255, 255, 255, 0.045);
            backdrop-filter: blur(10px);
            box-shadow:
              0 16px 50px rgba(0, 0, 0, 0.28),
              0 0 0 1px rgba(22, 119, 255, 0.12) inset,
              0 0 60px rgba(22, 119, 255, 0.10);
            position: relative;
          }

          .ncc-login-card::before {
            content: '';
            position: absolute;
            inset: -1px;
            border-radius: 16px;
            background: conic-gradient(from 180deg, rgba(22,119,255,0.0), rgba(22,119,255,0.35), rgba(0,208,255,0.28), rgba(130,0,255,0.20), rgba(22,119,255,0.0));
            filter: blur(10px);
            opacity: 0.55;
            z-index: -1;
            animation: nccGlow 4.5s ease-in-out infinite;
          }

          @keyframes nccGlow {
            0%, 100% { opacity: 0.42; transform: translateY(0); }
            50% { opacity: 0.70; transform: translateY(-2px); }
          }
        `}
      </style>

      <div style={{ width: '100%', maxWidth: 520 }}>
        <div style={{ marginBottom: 16, textAlign: 'center' }}>
          <Space direction="vertical" size={6} style={{ width: '100%' }}>
            <div>
              <Tag color="geekblue" style={{ marginInlineEnd: 0, borderRadius: 999, paddingInline: 10 }}>
                AI Ops Console
              </Tag>
            </div>

            <Typography.Title level={2} style={{ margin: 0, letterSpacing: 0.2 }}>
            NocoDB 升级平台
          </Typography.Title>
            <Typography.Text type="secondary">Schema 对比 · 计划 · 执行</Typography.Text>
          </Space>
        </div>

        <Card
          className="ncc-login-card"
          styles={{
            body: {
              padding: 20,
            },
          }}
        >
          <Space direction="vertical" size={14} style={{ width: '100%' }}>
            <div>
              <Typography.Title level={4} style={{ marginTop: 0, marginBottom: 6 }}>
                登录
              </Typography.Title>
              <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                请输入用户名与密码。首次启动默认账号可在服务器环境变量中配置（INIT_USERNAME/INIT_PASSWORD）。
              </Typography.Paragraph>
            </div>

            <Form form={form} layout="vertical" onFinish={login}>
              <Form.Item name="username" label="用户名" rules={[{ required: true }]}>
                <Input autoFocus placeholder="admin" size="large" />
              </Form.Item>
              <Form.Item name="password" label="密码" rules={[{ required: true }]}>
                <Input.Password placeholder="••••••••" size="large" />
              </Form.Item>
              <Button type="primary" htmlType="submit" loading={loading} block size="large">
                登录
              </Button>
            </Form>

            <Typography.Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 12 }}>
              提示：生产环境请设置 <Typography.Text code>SESSION_SECRET</Typography.Text>，否则服务重启会让登录失效。
            </Typography.Paragraph>
          </Space>
        </Card>
      </div>
    </div>
  )
}
