import { useEffect, useMemo, useState, type Key } from 'react'
import { Button, Card, Col, Divider, Form, Input, Row, Select, Space, Switch, Table, Typography, message } from 'antd'
import { fetchJson } from '../api'
import type { Plan, PlanStep } from '../types'
import { useTranslation } from 'react-i18next'

type Diff = any

type FullConfig = {
  source?: any
  target?: any
  options?: any
}

export function ComparePage() {
  const { t } = useTranslation()
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
        message.warning(t('compare.serverNotResponding'))
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

    message.success(t('compare.configSaved'))
  }

  async function compare() {
    setLoadingCompare(true)
    try {
      const v = await form.validateFields()
      await saveConfig()

      const data = await runCompareWithValues(v)
      message.success(t('compare.compareDone', { count: data.plan?.steps?.length ?? 0 }))
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

      if (data.ok) message.success(dryRun ? t('compare.applyOkDryRun') : t('compare.applyOk'))
      else message.warning(t('compare.applyHasFailures'))

      const failed = (data.results || []).filter((r: any) => !r.ok)
      if (failed.length) {
        console.error('failed steps', failed)
        message.error(t('compare.failedCount', { count: failed.length }))
      }

      // 执行后自动重新对比，刷新 diff/plan。
      if (!dryRun) {
        setLoadingCompare(true)
        try {
          const next = await runCompareWithValues(v)
          message.info(t('compare.reCompareDone', { count: next.plan?.steps?.length ?? 0 }))
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
          {t('compare.title')}
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          {t('compare.subtitle')}
        </Typography.Paragraph>
      </Card>

      <Card title={t('compare.envConfig')} size="small" style={{ borderRadius: 8 }}>
        <Form form={form} layout="vertical">
          <Row gutter={12}>
            <Col span={12}>
              <Card title={t('compare.source')} size="small" style={{ borderRadius: 8 }}>
                <Form.Item name={['source', 'apiVersion']} label={t('compare.apiVersion')} initialValue="v2">
                  <Select options={[{ value: 'v2' }, { value: 'v3' }]} />
                </Form.Item>
                <Form.Item name={['source', 'baseUrl']} label={t('compare.baseUrl')} rules={[{ required: true, message: t('validation.required') }]}
                >
                  <Input placeholder="https://nocodb.company.com" />
                </Form.Item>
                <Form.Item
                  name={['source', 'apiToken']}
                  label={t('compare.apiToken')}
                  dependencies={[["source", "apiTokenSaved"]]}
                  rules={[
                    {
                      validator: async (_rule, value) => {
                        const saved = !!form.getFieldValue(['source', 'apiTokenSaved'])
                        if (saved && !String(value ?? '').trim()) return
                        if (String(value ?? '').trim()) return
                        throw new Error(t('validation.apiTokenRequired'))
                      },
                    },
                  ]}
                >
                  <Input.Password
                    placeholder={
                      form.getFieldValue(['source', 'apiTokenSaved'])
                        ? t('compare.apiTokenSaved')
                        : t('compare.apiTokenPlaceholder')
                    }
                  />
                </Form.Item>
                <Form.Item name={['source', 'baseId']} label={t('compare.baseId')} rules={[{ required: true, message: t('validation.required') }]}
                >
                  <Input placeholder={t('compare.baseIdPlaceholder')} />
                </Form.Item>
              </Card>
            </Col>

            <Col span={12}>
              <Card title={t('compare.target')} size="small" style={{ borderRadius: 8 }}>
                <Form.Item name={['target', 'apiVersion']} label={t('compare.apiVersion')} initialValue="v2">
                  <Select options={[{ value: 'v2' }, { value: 'v3' }]} />
                </Form.Item>
                <Form.Item name={['target', 'baseUrl']} label={t('compare.baseUrl')} rules={[{ required: true, message: t('validation.required') }]}
                >
                  <Input placeholder="https://nocodb-staging.company.com" />
                </Form.Item>
                <Form.Item
                  name={['target', 'apiToken']}
                  label={t('compare.apiToken')}
                  dependencies={[["target", "apiTokenSaved"]]}
                  rules={[
                    {
                      validator: async (_rule, value) => {
                        const saved = !!form.getFieldValue(['target', 'apiTokenSaved'])
                        if (saved && !String(value ?? '').trim()) return
                        if (String(value ?? '').trim()) return
                        throw new Error(t('validation.apiTokenRequired'))
                      },
                    },
                  ]}
                >
                  <Input.Password
                    placeholder={
                      form.getFieldValue(['target', 'apiTokenSaved'])
                        ? t('compare.apiTokenSaved')
                        : t('compare.apiTokenPlaceholder')
                    }
                  />
                </Form.Item>
                <Form.Item name={['target', 'baseId']} label={t('compare.baseId')} rules={[{ required: true, message: t('validation.required') }]}
                >
                  <Input placeholder={t('compare.baseIdPlaceholder')} />
                </Form.Item>
              </Card>
            </Col>
          </Row>

          <Divider />

          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name={['options', 'ignoreCase']} label={t('compare.optionsIgnoreCase')} valuePropName="checked" initialValue={true}>
                <Switch />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name={['options', 'includeSystemColumns']} label={t('compare.optionsIncludeSystem')} valuePropName="checked" initialValue={false}>
                <Switch />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name={['options', 'includeDeleteOps']} label={t('compare.optionsIncludeDelete')} valuePropName="checked" initialValue={false}>
                <Switch />
              </Form.Item>
            </Col>
          </Row>

          <Space>
            <Button onClick={saveConfig}>{t('common.saveConfig')}</Button>
            <Button type="primary" loading={loadingCompare} onClick={compare}>
              {t('common.startCompare')}
            </Button>
          </Space>
        </Form>
      </Card>

      <Card
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span>{t('compare.planTitle')}</span>
            <Space wrap>
              <Button disabled={!plan} onClick={exportJsonl}>
                {t('common.exportJsonl')}
              </Button>
              <Button disabled={!plan} loading={loadingApply} onClick={() => apply(true)}>
                {t('common.dryRun')}
              </Button>
              <Button danger disabled={!plan} loading={loadingApply} onClick={() => apply(false)}>
                {t('common.apply')}
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
              title: t('common.danger'),
              dataIndex: 'danger',
              width: 70,
              render: (v: boolean) => (v ? t('common.yes') : ''),
            },
            { title: t('common.step'), dataIndex: 'title' },
            { title: t('common.method'), dataIndex: ['request', 'method'], width: 90 },
            { title: t('common.url'), dataIndex: ['request', 'url'] },
          ]}
          pagination={{ pageSize: 20 }}
        />
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          {t('compare.planNote')}
        </Typography.Paragraph>
      </Card>

      <Card title={t('compare.diffTitle')} size="small" style={{ borderRadius: 8 }}>
        <pre style={{ whiteSpace: 'pre-wrap', margin: 0, maxHeight: 260, overflow: 'auto' }}>{diff ? JSON.stringify(diff, null, 2) : t('compare.notCompared')}</pre>
      </Card>
    </Space>
  )
}
