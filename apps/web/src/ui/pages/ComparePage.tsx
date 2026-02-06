import { useEffect, useMemo, useState, type Key } from 'react'
import { Button, Card, Col, Divider, Form, Input, Row, Select, Space, Switch, Table, Typography, message } from 'antd'
import { fetchJson } from '../api'
import type { Plan, PlanStep } from '../types'

type Diff = any

type FullConfig = {
  source?: any
  target?: any
  options?: any
}

export function ComparePage() {
  const [form] = Form.useForm()
  const [plan, setPlan] = useState<Plan | null>(null)
  const [diff, setDiff] = useState<Diff | null>(null)
  const [selectedStepIds, setSelectedStepIds] = useState<string[]>([])
  const [loadingCompare, setLoadingCompare] = useState(false)
  const [loadingApply, setLoadingApply] = useState(false)

  useEffect(() => {
    ;(async () => {
      try {
        const cfg = await fetchJson<FullConfig>('/api/config')
        if (cfg?.source || cfg?.target || cfg?.options) {
          form.setFieldsValue(cfg)
        } else {
          form.setFieldsValue({
            options: {
              ignoreCase: true,
              includeDeleteOps: false,
              includeSystemColumns: false,
            },
            source: { apiVersion: 'v2' },
            target: { apiVersion: 'v2' },
          })
        }
      } catch (e: any) {
        console.warn('load /api/config failed', e)
        form.setFieldsValue({
          options: {
            ignoreCase: true,
            includeDeleteOps: false,
            includeSystemColumns: false,
          },
          source: { apiVersion: 'v2' },
          target: { apiVersion: 'v2' },
        })
        message.warning('后端未响应：已加载默认配置（请确认 server 已启动）')
      }
    })()
  }, [form])

  const stepsData = useMemo(() => (plan?.steps ?? []).map((s: PlanStep) => ({ key: s.id, ...s })), [plan])

  async function runCompareWithValues(v: any) {
    const data = await fetchJson<any>('/api/compare', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(v),
    })
    setDiff(data.diff)
    setPlan(data.plan)
    setSelectedStepIds([])
    return data
  }

  async function saveConfig() {
    const v = await form.validateFields()

    // 不回显 token 的情况下：空字符串代表“沿用已保存 token”，避免覆盖服务端存储的 token
    for (const side of ['source', 'target'] as const) {
      const t = (v?.[side]?.apiToken ?? '').trim()
      if (!t) {
        delete v?.[side]?.apiToken
      }
    }

    await fetchJson('/api/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(v),
    })

    message.success('配置已保存到本地 data/config.json')
  }

  async function compare() {
    setLoadingCompare(true)
    try {
      const v = await form.validateFields()
      await saveConfig()

      const data = await runCompareWithValues(v)
      message.success(`对比完成：生成 ${data.plan?.steps?.length ?? 0} 个步骤`)
    } catch (e: any) {
      message.error(e?.message ?? String(e))
    } finally {
      setLoadingCompare(false)
    }
  }

  async function apply(dryRun: boolean) {
    if (!plan) return
    setLoadingApply(true)
    try {
      const v = await form.validateFields()
      const data = await fetchJson<any>('/api/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          target: v.target,
          plan,
          selectedStepIds,
          dryRun,
        }),
      })

      if (data.ok) message.success(dryRun ? 'Dry-run 通过（未实际执行）' : '执行完成')
      else message.warning('执行结束，但有失败步骤，请查看结果')

      const failed = (data.results || []).filter((r: any) => !r.ok)
      if (failed.length) {
        console.error('failed steps', failed)
        message.error(`失败 ${failed.length} 个步骤（详情见控制台）`)
      }

      // 执行后自动重新对比，刷新 diff/plan。
      if (!dryRun) {
        setLoadingCompare(true)
        try {
          const next = await runCompareWithValues(v)
          message.info(`已自动重新对比：当前剩余 ${next.plan?.steps?.length ?? 0} 个步骤`)
        } finally {
          setLoadingCompare(false)
        }
      }
    } catch (e: any) {
      message.error(e?.message ?? String(e))
    } finally {
      setLoadingApply(false)
    }
  }

  async function exportJsonl() {
    if (!plan) return
    try {
      const res = await fetch('/api/export/jsonl', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ plan }),
      })
      const text = await res.text()
      if (!res.ok) throw new Error(text || `HTTP ${res.status} ${res.statusText}`)
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `nocodb-plan-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      message.error(e?.message ?? String(e))
    }
  }

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Card size="small" style={{ borderRadius: 8 }}>
        <Typography.Title level={3} style={{ marginTop: 0, marginBottom: 4 }}>
          对比升级
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          配置 source/target 后点击“开始对比”，生成可勾选的升级步骤；可 Dry-run 验证，也可直接执行。
        </Typography.Paragraph>
      </Card>

      <Card title="环境配置" size="small" style={{ borderRadius: 8 }}>
        <Form form={form} layout="vertical">
          <Row gutter={12}>
            <Col span={12}>
              <Card title="Source（正式环境）" size="small" style={{ borderRadius: 8 }}>
                <Form.Item name={['source', 'apiVersion']} label="API 版本" initialValue="v2">
                  <Select options={[{ value: 'v2' }, { value: 'v3' }]} />
                </Form.Item>
                <Form.Item name={['source', 'baseUrl']} label="Base URL" rules={[{ required: true }]}
                >
                  <Input placeholder="https://nocodb.company.com" />
                </Form.Item>
                <Form.Item
                  name={['source', 'apiToken']}
                  label="API Token"
                  dependencies={[["source", "apiTokenSaved"]]}
                  rules={[
                    {
                      validator: async (_rule, value) => {
                        const saved = !!form.getFieldValue(['source', 'apiTokenSaved'])
                        if (saved && !String(value ?? '').trim()) return
                        if (String(value ?? '').trim()) return
                        throw new Error('API Token 必填')
                      },
                    },
                  ]}
                >
                  <Input.Password
                    placeholder={form.getFieldValue(['source', 'apiTokenSaved']) ? '已保存（不回显）' : 'xc-auth token'}
                  />
                </Form.Item>
                <Form.Item name={['source', 'baseId']} label="Base ID" rules={[{ required: true }]}
                >
                  <Input placeholder="例如 pRdVnZXPZgA" />
                </Form.Item>
              </Card>
            </Col>

            <Col span={12}>
              <Card title="Target（待升级环境）" size="small" style={{ borderRadius: 8 }}>
                <Form.Item name={['target', 'apiVersion']} label="API 版本" initialValue="v2">
                  <Select options={[{ value: 'v2' }, { value: 'v3' }]} />
                </Form.Item>
                <Form.Item name={['target', 'baseUrl']} label="Base URL" rules={[{ required: true }]}
                >
                  <Input placeholder="https://nocodb-staging.company.com" />
                </Form.Item>
                <Form.Item
                  name={['target', 'apiToken']}
                  label="API Token"
                  dependencies={[["target", "apiTokenSaved"]]}
                  rules={[
                    {
                      validator: async (_rule, value) => {
                        const saved = !!form.getFieldValue(['target', 'apiTokenSaved'])
                        if (saved && !String(value ?? '').trim()) return
                        if (String(value ?? '').trim()) return
                        throw new Error('API Token 必填')
                      },
                    },
                  ]}
                >
                  <Input.Password
                    placeholder={form.getFieldValue(['target', 'apiTokenSaved']) ? '已保存（不回显）' : 'xc-auth token'}
                  />
                </Form.Item>
                <Form.Item name={['target', 'baseId']} label="Base ID" rules={[{ required: true }]}
                >
                  <Input placeholder="例如 pRdVnZXPZgA" />
                </Form.Item>
              </Card>
            </Col>
          </Row>

          <Divider />

          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name={['options', 'ignoreCase']} label="标题忽略大小写" valuePropName="checked" initialValue={true}>
                <Switch />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name={['options', 'includeSystemColumns']} label="包含系统字段" valuePropName="checked" initialValue={false}>
                <Switch />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name={['options', 'includeDeleteOps']} label="包含删除操作(危险)" valuePropName="checked" initialValue={false}>
                <Switch />
              </Form.Item>
            </Col>
          </Row>

          <Space>
            <Button onClick={saveConfig}>保存配置</Button>
            <Button type="primary" loading={loadingCompare} onClick={compare}>
              开始对比
            </Button>
          </Space>
        </Form>
      </Card>

      <Card
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span>升级计划（Plan）</span>
            <Space wrap>
              <Button disabled={!plan} onClick={exportJsonl}>
                导出 JSONL
              </Button>
              <Button disabled={!plan} loading={loadingApply} onClick={() => apply(true)}>
                Dry-run
              </Button>
              <Button danger disabled={!plan} loading={loadingApply} onClick={() => apply(false)}>
                执行升级
              </Button>
            </Space>
          </div>
        }
        size="small"
        style={{ borderRadius: 8 }}
      >
        <Table
          size="small"
          dataSource={stepsData}
          rowSelection={{
            selectedRowKeys: selectedStepIds,
            onChange: (keys: Key[]) => setSelectedStepIds(keys as string[]),
          }}
          columns={[
            {
              title: '危险',
              dataIndex: 'danger',
              width: 70,
              render: (v: boolean) => (v ? '是' : ''),
            },
            { title: '步骤', dataIndex: 'title' },
            { title: 'Method', dataIndex: ['request', 'method'], width: 90 },
            { title: 'URL', dataIndex: ['request', 'url'] },
          ]}
          pagination={{ pageSize: 20 }}
        />
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          说明：表/字段的 add/update/delete 会转成 target 环境的 NocoDB Meta API 调用。删除操作建议先导出 JSONL 并人工复核。
        </Typography.Paragraph>
      </Card>

      <Card title="差异摘要（Diff）" size="small" style={{ borderRadius: 8 }}>
        <pre style={{ whiteSpace: 'pre-wrap', margin: 0, maxHeight: 260, overflow: 'auto' }}>{diff ? JSON.stringify(diff, null, 2) : '尚未对比'}</pre>
      </Card>
    </Space>
  )
}
