import { useEffect, useMemo, useState, type Key } from 'react'
import {
  Alert,
  Button,
  Card,
  Col,
  Divider,
  Form,
  Input,
  Row,
  Select,
  Space,
  Table,
  Typography,
  Upload,
  message,
} from 'antd'
import type { UploadProps } from 'antd'
import type { ApplyResult, Plan, PlanStep } from '../types'
import { fetchJson } from '../api'

type FullConfig = {
  target?: any
}

function parsePlanFileText(text: string): { plan?: Plan; error?: string } {
  const trimmed = (text ?? '').trim()
  if (!trimmed) return { error: '文件内容为空' }

  // 1) JSON（Plan 对象 / steps 数组）
  try {
    const v = JSON.parse(trimmed)
    if (Array.isArray(v)) {
      const steps = v as PlanStep[]
      return { plan: { createdAt: new Date().toISOString(), steps } }
    }
    if (v && typeof v === 'object') {
      if (Array.isArray((v as any).steps)) {
        return { plan: v as Plan }
      }
      if ((v as any).plan && Array.isArray((v as any).plan.steps)) {
        return { plan: (v as any).plan as Plan }
      }
    }
  } catch {
    // ignore
  }

  // 2) JSONL（每行一个 step）
  try {
    const lines = trimmed
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)

    const steps: PlanStep[] = lines.map((l, idx) => {
      try {
        return JSON.parse(l) as PlanStep
      } catch (e: any) {
        throw new Error(`第 ${idx + 1} 行不是合法 JSON：${e?.message ?? String(e)}`)
      }
    })

    return { plan: { createdAt: new Date().toISOString(), steps } }
  } catch (e: any) {
    return { error: e?.message ?? String(e) }
  }
}

function normalizeImportedPlan(p: Plan): Plan {
  const steps = (p.steps ?? []).map((s, i) => {
    const id = String((s as any).id ?? '').trim() || `step_${i + 1}`
    const title = String((s as any).title ?? '').trim() || id
    const request = (s as any).request ?? {}
    const method = String(request.method ?? 'POST').toUpperCase()
    const url = String(request.url ?? '').trim()
    const headers = (request.headers && typeof request.headers === 'object') ? request.headers : {}

    return {
      id,
      title,
      danger: !!(s as any).danger,
      meta: (s as any).meta ?? undefined,
      request: {
        method,
        url,
        headers,
        body: request.body ?? undefined,
      },
    } as PlanStep
  })

  return {
    createdAt: p.createdAt || new Date().toISOString(),
    options: p.options ?? { ignoreCase: true },
    steps,
  }
}

export function ImportExecutePage() {
  const [form] = Form.useForm()

  const [plan, setPlan] = useState<Plan | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)

  const [selectedStepIds, setSelectedStepIds] = useState<string[]>([])
  const [loadingApply, setLoadingApply] = useState(false)
  const [result, setResult] = useState<ApplyResult | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const cfg = await fetchJson<FullConfig>('/api/config')
        form.setFieldsValue({
          target: {
            apiVersion: 'v2',
            ...(cfg?.target || {}),
          },
        })
      } catch (e: any) {
        console.warn('load /api/config failed', e)
        form.setFieldsValue({ target: { apiVersion: 'v2' } })
      }
    })()
  }, [form])

  const stepsData = useMemo(() => (plan?.steps ?? []).map((s) => ({ key: s.id, ...s })), [plan])

  const uploadProps: UploadProps = {
    multiple: false,
    showUploadList: false,
    accept: '.json,.jsonl,.txt',
    beforeUpload: async (file) => {
      try {
        const text = await file.text()
        setFileName(file.name)

        const parsed = parsePlanFileText(text)
        if (parsed.error) {
          setPlan(null)
          setSelectedStepIds([])
          setParseError(parsed.error)
          message.error(`解析失败：${parsed.error}`)
          return false
        }

        const normalized = normalizeImportedPlan(parsed.plan!)

        // 基础校验：必须有 url
        const bad = normalized.steps.find((s) => !s.request?.url)
        if (bad) {
          setPlan(null)
          setSelectedStepIds([])
          const msg = `步骤 ${bad.id} 缺少 request.url，无法执行（请确认导出文件来自本工具）`
          setParseError(msg)
          message.error(msg)
          return false
        }

        setParseError(null)
        setPlan(normalized)

        const safeIds = normalized.steps.filter((s) => !s.danger).map((s) => s.id)
        setSelectedStepIds(safeIds)
        setResult(null)

        const dangerCount = normalized.steps.filter((s) => !!s.danger).length
        if (dangerCount) {
          message.warning(`已导入：${normalized.steps.length} 个步骤（已默认勾选安全项；危险步骤 ${dangerCount} 个需手动勾选）`)
        } else {
          message.success(`已导入：${normalized.steps.length} 个步骤`)
        }
      } catch (e: any) {
        const msg = e?.message ?? String(e)
        setParseError(msg)
        setPlan(null)
        setSelectedStepIds([])
        message.error(`读取失败：${msg}`)
      }
      return false
    },
  }

  function selectAll() {
    if (!plan) return
    setSelectedStepIds(plan.steps.map((s) => s.id))
  }

  function selectSafeOnly() {
    if (!plan) return
    setSelectedStepIds(plan.steps.filter((s) => !s.danger).map((s) => s.id))
  }

  function clearSelection() {
    setSelectedStepIds([])
  }

  async function apply(dryRun: boolean) {
    if (!plan) return

    setLoadingApply(true)
    try {
      const v = await form.validateFields()

      // 不回显 token 的情况下：空字符串代表“沿用已保存 token”，避免覆盖服务端存储的 token
      const token = String(v?.target?.apiToken ?? '').trim()
      if (!token) {
        delete v?.target?.apiToken
      }

      const data = await fetchJson<ApplyResult>('/api/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          target: v.target,
          plan,
          selectedStepIds,
          dryRun,
        }),
      })

      setResult(data)

      const failed = (data.results || []).filter((r) => !r.ok)
      if (data.ok) {
        message.success(dryRun ? 'Dry-run 通过（未实际执行）' : '执行完成')
      } else {
        message.warning(`执行结束：成功 ${(data.results?.length ?? 0) - failed.length}，失败 ${failed.length}`)
      }
    } catch (e: any) {
      message.error(e?.message ?? String(e))
    } finally {
      setLoadingApply(false)
    }
  }

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Card size="small" style={{ borderRadius: 8 }}>
        <Typography.Title level={3} style={{ marginTop: 0, marginBottom: 4 }}>
          导入执行
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          将“导出 JSONL/JSON”导入后，直接执行到你指定的 target 服务。适合把计划带到另一台执行机或走人工审核流程。
        </Typography.Paragraph>
      </Card>

      <Card title="1) 导入计划文件" size="small" style={{ borderRadius: 8 }}>
        <Upload.Dragger {...uploadProps}>
          <p style={{ margin: 0, fontWeight: 600 }}>拖拽文件到这里，或点击选择</p>
          <p style={{ margin: '8px 0 0 0', color: 'rgba(0,0,0,0.45)' }}>支持 .json / .jsonl / .txt（JSONL：每行一个步骤）</p>
        </Upload.Dragger>
        <div style={{ marginTop: 8 }}>
          <Typography.Text type="secondary">当前文件：</Typography.Text>
          <Typography.Text>{fileName ?? '未选择'}</Typography.Text>
        </div>
        {parseError ? (
          <Alert style={{ marginTop: 12 }} type="error" showIcon message="导入失败" description={parseError} />
        ) : null}
      </Card>

      <Card title="2) 目标环境（执行平台）" size="small" style={{ borderRadius: 8 }}>
        <Form form={form} layout="vertical">
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name={['target', 'apiVersion']} label="API 版本" initialValue="v2">
                <Select options={[{ value: 'v2' }, { value: 'v3' }]} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name={['target', 'baseUrl']} label="Base URL" rules={[{ required: true }]}>
                <Input placeholder="https://nocodb-staging.company.com" />
              </Form.Item>
            </Col>
            <Col span={8}>
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
                <Input.Password placeholder={form.getFieldValue(['target', 'apiTokenSaved']) ? '已保存（不回显）' : 'xc-auth token'} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name={['target', 'baseId']} label="Base ID" rules={[{ required: true }]}>
                <Input placeholder="例如 pRdVnZXPZgA" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Alert
                type="info"
                showIcon
                message="提示"
                description="执行时后端会以这里填写的 baseUrl/baseId 为准，并尝试将导入文件中的 URL 自动重写到当前 target。"
              />
            </Col>
          </Row>
        </Form>
      </Card>

      <Card
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span>3) 步骤预览与执行</span>
            <Space wrap>
              <Button disabled={!plan} onClick={selectAll}>
                全选
              </Button>
              <Button disabled={!plan} onClick={selectSafeOnly}>
                仅选安全项
              </Button>
              <Button disabled={!plan} onClick={clearSelection}>
                清空
              </Button>
              <Divider type="vertical" />
              <Button disabled={!plan} loading={loadingApply} onClick={() => apply(true)}>
                Dry-run
              </Button>
              <Button danger disabled={!plan} loading={loadingApply} onClick={() => apply(false)}>
                执行
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
          说明：导入文件的请求头通常是 ***（已脱敏）。执行时后端会注入真实 token，并解析 URL 里的 {`{tableId}`} / {`{columnId}`} 占位符。
        </Typography.Paragraph>
      </Card>

      <Card title="执行结果" size="small" style={{ borderRadius: 8 }}>
        {result ? (
          <Table
            size="small"
            rowKey="id"
            dataSource={result.results}
            columns={[
              { title: 'Step ID', dataIndex: 'id', width: 260 },
              {
                title: 'OK',
                dataIndex: 'ok',
                width: 80,
                render: (v: boolean) => (v ? '是' : '否'),
              },
              { title: 'HTTP', dataIndex: 'status', width: 90 },
              { title: 'Error', dataIndex: 'error' },
            ]}
            expandable={{
              expandedRowRender: (r) => (
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{r.details || ''}</pre>
              ),
              rowExpandable: (r) => !!r.details,
            }}
            pagination={{ pageSize: 20 }}
          />
        ) : (
          <Typography.Text type="secondary">尚未执行</Typography.Text>
        )}
      </Card>
    </Space>
  )
}
