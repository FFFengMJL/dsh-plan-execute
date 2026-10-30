import { useEffect, useMemo, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ModelCatalog, ModelCatalogModel, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-user-questions/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { OperationPhase, OperationState, StageApprovalRequest } from '../protocol.js'
import {
  PACKAGE_NAME,
  REQUEST_SYMBOL,
  REQUEST_WIRE,
  SERVICE_KEY,
  STAGE_ENDPOINT,
  STAGE_METHOD,
  STAGE_RESULT_SYMBOL,
  STATE_ENDPOINT,
  STATE_METHOD,
  STATE_REQUEST_SYMBOL,
  STATE_RESULT_SYMBOL,
  type ModelChoice,
  type OperationStateRequest,
} from '../protocol.js'

const NS = 'planExecute'
const zh = {
  'options': '执行选项',
  'model': '执行模型',
  'current': '沿用当前模型',
  'effort': '推理档位',
  'defaultEffort': '使用模型默认值',
  'mode': '上下文处理',
  'keep': '保留上下文直接执行',
  'compact': '压缩较早历史后执行',
  'stage': '保存本次设置',
  'saved': '设置已保存；点击下方原生“批准”开始执行。',
  'loading': '正在读取可用模型…',
  'noCall': '无法绑定当前审批调用；请使用原生批准。',
  'error': '执行设置暂不可用：{message}',
  'staged': '已保存，等待批准',
  'validating': '正在校验计划与执行选项',
  'compacting': '正在压缩计划之前的历史',
  'selecting-model': '正在设置本会话执行模型',
  'released': '准备完成，计划已获批准',
  'failed': '准备失败：{code}。计划未获批准，请重新审阅。',
  'cancelled': '操作已取消，计划未获批准。',
  'notice': '自定义模型会继续用于本会话，并会通过 DSH 公共 API 更新宿主默认模型，可能影响新会话；若不希望改变默认值，请选“沿用当前模型”。压缩摘要只是背景，最终批准计划仍是执行依据。',
}
const en: Record<keyof typeof zh, string> = {
  'options': 'Execution options',
  'model': 'Execution model',
  'current': 'Use current model',
  'effort': 'Reasoning effort',
  'defaultEffort': 'Use model default',
  'mode': 'Context handling',
  'keep': 'Execute with context unchanged',
  'compact': 'Compact earlier history, then execute',
  'stage': 'Save these settings',
  'saved': 'Settings saved; click the native Approve button below to execute.',
  'loading': 'Loading available models…',
  'noCall': 'Cannot bind this review to its tool call; use native approval.',
  'error': 'Execution settings unavailable: {message}',
  'staged': 'Saved; waiting for approval',
  'validating': 'Validating the plan and execution options',
  'compacting': 'Compacting history before the plan',
  'selecting-model': 'Setting the execution model for this Session',
  'released': 'Preparation complete; the plan was approved',
  'failed': 'Preparation failed: {code}. The plan was not approved; review it again.',
  'cancelled': 'Operation cancelled; the plan was not approved.',
  'notice': 'A custom model remains active for this Session and the public DSH API also updates the Host default, which may affect new Sessions. Choose “Use current model” to avoid changing that default. The summary is background; the final approved plan remains authoritative.',
}

type Key = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    planExecute: Key
  }
}

type Translator = TranslateNS<typeof NS>
type Props = PropsRuntime<'conversation.plan-review.actions'> & PropsLocale<typeof NS>
type RemoteError = { readonly code?: string; readonly message?: string }
type RemoteResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: RemoteError }
type PlanExecuteRemote = {
  stageApproval(request: StageApprovalRequest): Promise<RemoteResult<{ operationId: string; phase: OperationPhase }>>
  getOperation(request: OperationStateRequest): Promise<RemoteResult<OperationState | null>>
}

function translate(t: Translator, key: Key, params?: Record<string, unknown>): string {
  return t(key, params)
}

function unwrap<T>(result: RemoteResult<T>): T {
  if (!result.ok) throw new Error(`${result.error.code ?? 'REMOTE_ERROR'}: ${result.error.message ?? 'Request failed'}`)
  return result.value
}

function modelKey(choice: ModelChoice): string {
  return JSON.stringify([choice.provider, choice.model])
}

function asModelChoice(value: string): ModelChoice | undefined {
  if (value === '') return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed) || typeof parsed[0] !== 'string' || typeof parsed[1] !== 'string') return undefined
    return { provider: parsed[0], model: parsed[1] }
  } catch {
    return undefined
  }
}

async function planHash(plan: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(plan))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function selectedModel(catalog: ModelCatalog | null, value: string): ModelCatalogModel | undefined {
  const choice = asModelChoice(value)
  if (choice === undefined || catalog === null) return undefined
  return catalog.groups.find(group => group.id === choice.provider)?.models.find(model => model.id === choice.model)
}

function PlanExecutionOptions({ review, requestKey, sessionId, t, gateway, loadCatalog }: PlanExecutionProps) {
  const [open, setOpen] = useState(false)
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null)
  const [modelValue, setModelValue] = useState('')
  const [effortValue, setEffortValue] = useState('')
  const [mode, setMode] = useState<'compact' | 'keep'>('keep')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [operation, setOperation] = useState<OperationState | null>(null)
  const [operationHash, setOperationHash] = useState('')

  const model = useMemo(() => selectedModel(catalog, modelValue), [catalog, modelValue])
  const options = model?.reasoning?.efforts ?? []
  const hasCall = review.callId !== undefined && String(review.callId).length > 0
  const reviewAddress = useMemo(() => ({
    sessionId: String(sessionId),
    callId: String(review.callId ?? ''),
    questionId: review.id,
  }), [sessionId, review.callId, review.id])

  useEffect(() => {
    let live = true
    void loadCatalog().then(value => {
      if (live) setCatalog(value)
    }).catch(cause => {
      if (live) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { live = false }
  }, [loadCatalog, sessionId])

  useEffect(() => {
    let live = true
    if (!hasCall) return () => { live = false }
    const read = async () => {
      try {
        const state = unwrap(await gateway.getOperation({ ...reviewAddress, planHash: await planHash(review.plan) }))
        if (live && state !== null) {
          setOperation(state)
          setMode(state.mode)
          setModelValue(state.selection === undefined ? '' : modelKey(state.selection))
          setEffortValue(state.selection?.reasoningEffort ?? '')
        }
      } catch {
        // A review with no staged operation is the normal initial state.
      }
    }
    void read()
    return () => { live = false }
  }, [gateway, hasCall, review.plan, reviewAddress])

  useEffect(() => {
    if (operation === null || operation.phase !== 'staged' || operationHash === '') return
    let live = true
    const timer = window.setInterval(() => {
      void gateway.getOperation({ ...reviewAddress, planHash: operationHash }).then(result => {
        if (!live) return
        const state = unwrap(result)
        if (state !== null) setOperation(state)
      }).catch(cause => {
        if (live) setError(cause instanceof Error ? cause.message : String(cause))
      })
    }, 500)
    return () => {
      live = false
      window.clearInterval(timer)
    }
  }, [gateway, operation, operationHash, reviewAddress])
  useEffect(() => {
    let live = true
    void planHash(review.plan).then(value => { if (live) setOperationHash(value) })
    return () => { live = false }
  }, [review.plan])

  const save = async (): Promise<void> => {
    if (!hasCall) {
      setError(translate(t, 'noCall'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const choice = asModelChoice(modelValue)
      const request: StageApprovalRequest = {
        ...reviewAddress,
        planHash: await planHash(review.plan),
        mode,
        ...(choice === undefined ? {} : {
          selection: {
            ...choice,
            ...(effortValue === '' ? {} : { reasoningEffort: effortValue }),
          },
        }),
        requestId: crypto.randomUUID(),
      }
      const staged = unwrap(await gateway.stageApproval(request))
      setOperation({
        operationId: staged.operationId,
        phase: 'staged',
        mode,
        ...(request.selection === undefined ? {} : { selection: request.selection }),
        updatedAt: Date.now(),
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const phaseMessage = operation === null ? null : operation.phase === 'failed'
    ? translate(t, 'failed', { code: operation.errorCode ?? 'PREPARATION_FAILED' })
    : operation.phase === 'cancelled'
      ? translate(t, 'cancelled')
      : operation.phase === 'staged'
        ? translate(t, 'staged')
        : translate(t, operation.phase)

  return (
    <div className="dpe-root" data-plan-execute={requestKey}>
      <button type="button" className="dpe-trigger" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        {translate(t, 'options')}
      </button>
      {open && (
        <section className="dpe-panel" aria-label={translate(t, 'options')}>
          <label className="dpe-field">
            <span>{translate(t, 'model')}</span>
            <select value={modelValue} disabled={busy} onChange={event => { setModelValue(event.currentTarget.value); setEffortValue('') }}>
              <option value="">{translate(t, 'current')}</option>
              {catalog?.groups.map(group => (
                <optgroup key={group.id} label={group.name}>
                  {group.models.map(entry => (
                    <option key={entry.id} value={modelKey({ provider: group.id, model: entry.id })}>{entry.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            {catalog === null && <small>{translate(t, 'loading')}</small>}
          </label>
          {options.length > 0 && (
            <label className="dpe-field">
              <span>{translate(t, 'effort')}</span>
              <select value={effortValue} disabled={busy} onChange={event => setEffortValue(event.currentTarget.value)}>
                <option value="">{translate(t, 'defaultEffort')}</option>
                {options.map(effort => <option key={effort.id} value={effort.id}>{effort.name}</option>)}
              </select>
            </label>
          )}
          <fieldset className="dpe-mode" disabled={busy}>
            <legend>{translate(t, 'mode')}</legend>
            <label><input type="radio" name={`mode-${requestKey}`} checked={mode === 'keep'} onChange={() => setMode('keep')} />{translate(t, 'keep')}</label>
            <label><input type="radio" name={`mode-${requestKey}`} checked={mode === 'compact'} onChange={() => setMode('compact')} />{translate(t, 'compact')}</label>
          </fieldset>
          <button type="button" className="dpe-save" disabled={busy || !hasCall} onClick={() => { void save() }}>
            {busy ? translate(t, 'loading') : translate(t, 'stage')}
          </button>
          <p className="dpe-notice">{translate(t, 'notice')}</p>
          {phaseMessage !== null && <p className="dpe-status" role="status">{phaseMessage}</p>}
          {error !== null && <p className="dpe-error" role="alert">{translate(t, 'error', { message: error })}</p>}
        </section>
      )}
    </div>
  )
}

function css(): () => void {
  if (document.querySelector('style[data-plugin-css="dsh-plan-execute"]') !== null) return () => {}
  const style = document.createElement('style')
  style.dataset.pluginCss = 'dsh-plan-execute'
  style.textContent = `
    .dpe-root{display:flex;align-items:center;position:relative;font:inherit}
    .dpe-trigger{border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer;padding:4px 8px;border-radius:6px}
    .dpe-trigger:hover,.dpe-trigger:focus-visible{background:var(--dsw-alias-fill-secondary);outline:none}
    .dpe-panel{position:absolute;z-index:30;right:0;top:calc(100% + 8px);width:min(340px,calc(100vw - 32px));padding:12px;display:grid;gap:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-specific-input-major);box-shadow:var(--dsw-elevation-panel);color:var(--dsw-alias-label-primary)}
    .dpe-field{display:grid;gap:4px;font-size:12px}.dpe-field select{min-width:0;width:100%;padding:7px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-specific-input-major);color:inherit;font:inherit}
    .dpe-field small,.dpe-notice{font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.45;margin:0}
    .dpe-mode{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px;display:grid;gap:7px;font-size:12px}.dpe-mode label{display:flex;gap:7px;align-items:center}
    .dpe-save{justify-self:start;padding:6px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-fill-secondary);color:inherit;font:inherit;cursor:pointer}.dpe-save:disabled{opacity:.55;cursor:default}
    .dpe-status,.dpe-error{font-size:12px;margin:0;line-height:1.45}.dpe-error{color:var(--dsw-alias-state-danger-primary)}
    @media(max-width:600px){.dpe-panel{position:fixed;top:auto;right:12px;bottom:96px;max-height:60vh;overflow:auto}}
  `
  document.head.append(style)
  return () => style.remove()
}

const identity = (value: unknown) => value
const clientCodec = (typeSymbol: string) => ({
  mode: 'strict' as const,
  typeSymbol,
  schema: { parse: identity },
  create: () => ({ parse: identity }),
})

const CLIENT_CONTRIBUTION = {
  package: PACKAGE_NAME,
  descriptors: [
    {
      id: STAGE_ENDPOINT,
      service: SERVICE_KEY,
      namespace: SERVICE_KEY,
      method: STAGE_METHOD,
      invocation: { kind: 'direct' as const },
      parameters: [{ name: REQUEST_WIRE, wire: REQUEST_WIRE, source: 'json' as const, codec: clientCodec(REQUEST_SYMBOL) }],
      cancellation: { parameter: 'signal' as const },
      result: clientCodec(STAGE_RESULT_SYMBOL),
    },
    {
      id: STATE_ENDPOINT,
      service: SERVICE_KEY,
      namespace: SERVICE_KEY,
      method: STATE_METHOD,
      invocation: { kind: 'direct' as const },
      parameters: [{ name: REQUEST_WIRE, wire: REQUEST_WIRE, source: 'json' as const, codec: clientCodec(STATE_REQUEST_SYMBOL) }],
      result: clientCodec(STATE_RESULT_SYMBOL),
    },
  ],
}

export const inject = ['slots', 'locale', 'remote']

export async function apply(ctx: Context): Promise<void> {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), `${PACKAGE_NAME}: dictionaries`)
  ctx.effect(css, `${PACKAGE_NAME}: styles`)
  const disposeRemote = await ctx.remote.$mount(CLIENT_CONTRIBUTION)
  ctx.effect(() => disposeRemote, `${PACKAGE_NAME}: remote contribution`)

  const gateway = ctx.get(`remote.${SERVICE_KEY}`) as PlanExecuteRemote | undefined
  if (gateway === undefined) throw new Error(`${PACKAGE_NAME}: Host Remote namespace is unavailable`)

  const remote = ctx.remote
  const loadCatalog = async (): Promise<ModelCatalog> => unwrap(await remote.session.modelCatalog())
  ctx.slots.inject('conversation.plan-review.actions', () => ctx.slots.register({
    name: 'conversation.plan-review.actions',
    id: PACKAGE_NAME,
    locale: NS,
    inject: () => ({
      gateway,
      loadCatalog,
    }),
  }, PlanExecutionSlot))
}

type PlanExecutionProps = Props & { gateway: PlanExecuteRemote; loadCatalog: () => Promise<ModelCatalog> }

function PlanExecutionSlot(props: PlanExecutionProps) {
  return <PlanExecutionOptions {...props} />
}
