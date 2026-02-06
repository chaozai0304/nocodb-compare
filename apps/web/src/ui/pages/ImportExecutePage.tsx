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
import { useTranslation } from 'react-i18next'

type FullConfig = {
  target?: any
}

type ParsePlanResult =
  | { plan: Plan }
  | {
      errorKey:
        | 'import.errors.emptyFile'
        | 'import.errors.invalidJsonlLine'
        | 'import.errors.unrecognizedFormat'
      errorParams?: Record<string, any>
    }

function parsePlanFileText(text: string): ParsePlanResult {
  const trimmed = (text ?? '').trim()
  if (!trimmed) return { errorKey: 'import.errors.emptyFile' }

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

    const steps: PlanStep[] = []
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]
      try {
        steps.push(JSON.parse(l) as PlanStep)
      } catch (e: any) {
        return {
          errorKey: 'import.errors.invalidJsonlLine',
          errorParams: { line: i + 1, error: e?.message ?? String(e) },
        }
      }
    }

    return { plan: { createdAt: new Date().toISOString(), steps } }
  } catch {
    // ignore
  }

  return { errorKey: 'import.errors.unrecognizedFormat' }
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
  const { t } = useTranslation()
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
        if ('errorKey' in parsed) {
          setPlan(null)
          setSelectedStepIds([])
          const err = t(parsed.errorKey, parsed.errorParams)
          setParseError(err)
          message.error(t('import.parseFailed', { error: err }))
          return false
        }

        const normalized = normalizeImportedPlan(parsed.plan)

        // 基础校验：必须有 url
        const bad = normalized.steps.find((s) => !s.request?.url)
        if (bad) {
          setPlan(null)
          setSelectedStepIds([])
          const msg = t('import.missingUrl', { id: bad.id })
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
          message.warning(t('import.importedSafeDefault', { total: normalized.steps.length, danger: dangerCount }))
        } else {
          message.success(t('import.imported', { total: normalized.steps.length }))
        }
      } catch (e: any) {
        const msg = e?.message ?? String(e)
        setParseError(msg)
        setPlan(null)
        setSelectedStepIds([])
        message.error(t('import.readFailed', { error: msg }))
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
        message.success(dryRun ? t('import.dryRunOk') : t('import.applyOk'))
      } else {
        message.warning(
          t('import.applySummary', {
            ok: (data.results?.length ?? 0) - failed.length,
            failed: failed.length,
          }),
        )
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
          {t('import.title')}
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          {t('import.subtitle')}
        </Typography.Paragraph>
      </Card>

      <Card title={t('import.step1')} size="small" style={{ borderRadius: 8 }}>
        <Upload.Dragger {...uploadProps}>
          <p style={{ margin: 0, fontWeight: 600 }}>{t('import.dragHint')}</p>
          <p style={{ margin: '8px 0 0 0', color: 'rgba(0,0,0,0.45)' }}>{t('import.supportHint')}</p>
        </Upload.Dragger>
        <div style={{ marginTop: 8 }}>
          <Typography.Text type="secondary">{t('common.selectedFile')}：</Typography.Text>
          <Typography.Text>{fileName ?? t('common.notSelected')}</Typography.Text>
        </div>
        {parseError ? (
          <Alert style={{ marginTop: 12 }} type="error" showIcon message={t('import.importFailed')} description={parseError} />
        ) : null}
      </Card>

      <Card title={t('import.step2')} size="small" style={{ borderRadius: 8 }}>
        <Form form={form} layout="vertical">
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name={['target', 'apiVersion']} label={t('compare.apiVersion')} initialValue="v2">
                <Select options={[{ value: 'v2' }, { value: 'v3' }]} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name={['target', 'baseUrl']} label={t('compare.baseUrl')} rules={[{ required: true, message: t('validation.required') }]}>
                <Input placeholder="https://nocodb-staging.company.com" />
              </Form.Item>
            </Col>
            <Col span={8}>
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
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name={['target', 'baseId']} label={t('compare.baseId')} rules={[{ required: true, message: t('validation.required') }]}>
                <Input placeholder={t('compare.baseIdPlaceholder')} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Alert
                type="info"
                showIcon
                message={t('common.tip')}
                description={t('import.rewriteHint')}
              />
            </Col>
          </Row>
        </Form>
      </Card>

      <Card
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span>{t('import.step3')}</span>
            <Space wrap>
              <Button disabled={!plan} onClick={selectAll}>
                {t('import.selectAll')}
              </Button>
              <Button disabled={!plan} onClick={selectSafeOnly}>
                {t('import.selectSafeOnly')}
              </Button>
              <Button disabled={!plan} onClick={clearSelection}>
                {t('import.clear')}
              </Button>
              <Divider type="vertical" />
              <Button disabled={!plan} loading={loadingApply} onClick={() => apply(true)}>
                {t('common.dryRun')}
              </Button>
              <Button danger disabled={!plan} loading={loadingApply} onClick={() => apply(false)}>
                {t('common.execute')}
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
          {t('import.note')}
        </Typography.Paragraph>
      </Card>

      <Card title={t('import.resultTitle')} size="small" style={{ borderRadius: 8 }}>
        {result ? (
          <Table
            size="small"
            rowKey="id"
            dataSource={result.results}
            columns={[
              { title: t('import.resultColumns.stepId'), dataIndex: 'id', width: 260 },
              {
                title: t('import.resultColumns.ok'),
                dataIndex: 'ok',
                width: 80,
                render: (v: boolean) => (v ? t('common.yes') : t('common.no')),
              },
              { title: t('import.resultColumns.http'), dataIndex: 'status', width: 90 },
              { title: t('import.resultColumns.error'), dataIndex: 'error' },
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
          <Typography.Text type="secondary">{t('common.notExecuted')}</Typography.Text>
        )}
      </Card>
    </Space>
  )
}
