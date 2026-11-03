import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { Context } from '@deepseek-ai/cordis'
import type { ModelCatalog, ModelSelection, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-user-questions/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ExecutionMode, OperationPhase, OperationState, StageApprovalRequest } from '../protocol.js'
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
import {
  defaultEffort,
  effortLabel,
  effortLevels,
  findModel,
  modelKey,
  parseModelKey,
  providerName,
  selectionFor,
  supportsEffort,
  validateSelection,
  type SelectionVerdict,
} from './model-catalog.js'
import { describeError } from './describe.js'
import {
  PresetController,
  PresetStore,
  SETTINGS_ENTRY_ID,
  presetVerdict,
  type ExecutionPreset,
  type PresetFormValue,
} from './presets.js'
import { SETTINGS_NS, SettingsPage, settingsDictionaries } from './settings.js'
import { useModelCatalog } from './use-catalog.js'

const NS = 'planExecute'
const zh = {
  'options': '执行选项',
  'title': '执行选项',
  'close': '关闭执行选项',
  'model': '执行模型',
  'current': '沿用当前模型',
  'currentModel': '当前：{model}',
  'currentEffort': '思考等级：{effort}',
  'currentHint': '沿用当前模型；如需指定思考等级，请选择一个具体模型。',
  'effort': '思考等级',
  'defaultEffort': '使用模型默认值',
  'effortUnsupported': '该模型不支持调节思考等级。',
  'effortStale': '此前选择的思考等级已不可用，将使用模型默认值。',
  'mode': '上下文处理',
  'keep': '保留上下文直接执行',
  'compact': '压缩较早历史后执行',
  'stage': '保存本次设置',
  'saving': '正在保存…',
  'saved': '设置已保存；点击下方原生“批准”开始执行。',
  'dirty': '有未保存的更改；批准将使用上一次已保存的设置。',
  'loading': '正在读取可用模型…',
  'retry': '重试',
  'catalogError': '模型目录加载失败：{message}',
  'catalogTimeout': '读取可用模型超时，可重试。',
  'catalogEmpty': '没有发现其他可用模型；仍可沿用当前模型。',
  'catalogPartial': '部分提供方不可用：{names}。',
  'modelUnavailable': '所选模型已不在可用目录中，请重新选择。',
  'catalogRequired': '模型目录不可用，无法校验所选模型；请重试或沿用当前模型。',
  'effortUnavailable': '所选思考等级已不可用，请重新选择。',
  'pollError': '状态查询暂时失败，正在重试…',
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
  'quickGroup': '按预设',
  'quickCompact': '压缩后执行',
  'quickKeep': '保留后执行',
  'quickMore': '选项',
  'quickCompactHint': '按已保存的“压缩历史后执行”预设暂存；仍需点击原生批准。',
  'quickKeepHint': '按已保存的“保留历史后执行”预设暂存；仍需点击原生批准。',
  'quickStaged': '已暂存：{mode} · {target}。请点击下方的原生「同意执行」按钮。',
  'quickBusy': '正在暂存…',
  'quickPresetUnavailable': '预设设置暂不可用。',
  'quickPresetMissing': '尚未配置该快捷方式；请在“设置 → 计划审批执行”中配置。',
  'quickPresetInvalid': '预设模型当前不可用；请更新设置。',
  'quickCatalogLoading': '正在读取模型目录…',
  'quickCatalogUnavailable': '模型目录不可用，无法校验预设。',
  'quickOperationBusy': '已有执行准备进行中。',
  'presetSummary': '当前预设：压缩 {compact}；保留 {keep}。',
  'presetNone': '未配置',
  'settingsHint': '可在“设置 → 计划审批执行”中修改预设。',
  'modeCompactShort': '压缩历史后执行',
  'modeKeepShort': '保留历史后执行',
  'staging': '正在暂存…',
}
const en: Record<keyof typeof zh, string> = {
  'options': 'Execution options',
  'title': 'Execution options',
  'close': 'Close execution options',
  'model': 'Execution model',
  'current': 'Use current model',
  'currentModel': 'Current: {model}',
  'currentEffort': 'Reasoning effort: {effort}',
  'currentHint': 'Keeps the current model. Choose a specific model to set a reasoning effort.',
  'effort': 'Reasoning effort',
  'defaultEffort': 'Use model default',
  'effortUnsupported': 'This model does not provide adjustable reasoning effort.',
  'effortStale': 'The previously selected effort is no longer available; the model default will be used.',
  'mode': 'Context handling',
  'keep': 'Execute with context unchanged',
  'compact': 'Compact earlier history, then execute',
  'stage': 'Save these settings',
  'saving': 'Saving…',
  'saved': 'Settings saved; click the native Approve button below to execute.',
  'dirty': 'Unsaved changes; approval will use the last saved settings.',
  'loading': 'Loading available models…',
  'retry': 'Retry',
  'catalogError': 'Could not load the model catalog: {message}',
  'catalogTimeout': 'Loading available models timed out; you can retry.',
  'catalogEmpty': 'No other models are available; the current model can still be used.',
  'catalogPartial': 'Some providers are unavailable: {names}.',
  'modelUnavailable': 'The selected model is no longer available; choose another model.',
  'catalogRequired': 'The model catalog is unavailable, so the selected model cannot be validated; retry or keep the current model.',
  'effortUnavailable': 'The selected reasoning effort is no longer available; choose another level.',
  'pollError': 'Temporary status lookup failure; retrying…',
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
  'quickGroup': 'Presets',
  'quickCompact': 'Compact, then run',
  'quickKeep': 'Keep, then run',
  'quickMore': 'Options',
  'quickCompactHint': 'Stages the saved “compact history, then execute” preset; the native Approve button still executes.',
  'quickKeepHint': 'Stages the saved “keep history, then execute” preset; the native Approve button still executes.',
  'quickStaged': 'Staged: {mode} · {target}. Use the native “Approve” button below.',
  'quickBusy': 'Staging…',
  'quickPresetUnavailable': 'Preset settings are currently unavailable.',
  'quickPresetMissing': 'This shortcut has no preset yet; configure it in Settings → Plan approval execution.',
  'quickPresetInvalid': 'The preset model is currently unavailable; update the settings.',
  'quickCatalogLoading': 'Loading the model catalog…',
  'quickCatalogUnavailable': 'The model catalog is unavailable, so the preset cannot be validated.',
  'quickOperationBusy': 'Execution preparation is already in progress.',
  'presetSummary': 'Current presets: compact {compact}; keep {keep}.',
  'presetNone': 'not configured',
  'settingsHint': 'Change presets in Settings → Plan approval execution.',
  'modeCompactShort': 'compact history, then execute',
  'modeKeepShort': 'keep history, then execute',
  'staging': 'Staging…',
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
type ModelSelectionProjection = {
  readonly lastUsed: ModelSelection | null
  readonly next: ModelSelection | null
}
type ProjectionReader = (key: 'modelSelection') => ModelSelectionProjection | undefined
type PlanExecutionProps = Props & {
  gateway: PlanExecuteRemote
  loadCatalog: () => Promise<ModelCatalog>
  presets: PresetStore
}

const FALLBACK_PROJECTION: ProjectionReader = () => undefined
const NO_EFFORT = ''
const POLL_INTERVAL_MS = 500
const TERMINAL_PHASES: ReadonlySet<OperationPhase> = new Set(['released', 'failed', 'cancelled'])

interface PanelPosition {
  readonly top: number
  readonly left: number
  readonly width: number
  readonly maxHeight: number
}

function translate(t: Translator, key: Key, params?: Record<string, unknown>): string {
  return t(key, params)
}

function unwrap<T>(result: RemoteResult<T>): T {
  if (!result.ok) throw new Error(`${result.error.code ?? 'REMOTE_ERROR'}: ${result.error.message ?? 'Request failed'}`)
  return result.value
}

function newRequestId(): string {
  const source = globalThis.crypto
  if (source !== undefined && typeof source.randomUUID === 'function') return source.randomUUID()
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

async function planHash(plan: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(plan))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function verdictKey(verdict: Exclude<SelectionVerdict, 'ok'>): Key {
  switch (verdict) {
    case 'model-unavailable': return 'modelUnavailable'
    case 'effort-unavailable': return 'effortUnavailable'
    case 'catalog-unavailable': return 'catalogRequired'
  }
}

function modelLabel(catalog: ModelCatalog | null, selection: ModelSelection): string {
  const model = findModel(catalog, selection.provider, selection.model)
  return `${providerName(catalog, selection.provider)} / ${model?.name ?? selection.model}`
}

function partialFailureNames(catalog: ModelCatalog | null): string | undefined {
  const failures = catalog?.failures ?? []
  if (failures.length === 0) return undefined
  const names = failures.slice(0, 3).map(failure => failure.name)
  return failures.length > 3 ? `${names.join(', ')}, …` : names.join(', ')
}


function CompactIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <rect x="2.5" y="3" width="11" height="2.4" rx="0.7" />
      <path d="M3.6 5.4v6.1a1 1 0 0 0 1 1h6.8a1 1 0 0 0 1-1V5.4" />
      <path d="M6.5 7.7h3" />
    </svg>
  )
}

function KeepIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path d="M5.2 3.6l6.8 4.4-6.8 4.4z" />
    </svg>
  )
}

function SlidersIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path d="M2.5 4.2h11M2.5 8h11M2.5 11.8h11" />
      <circle cx="5.2" cy="4.2" r="1.2" />
      <circle cx="10.4" cy="8" r="1.2" />
      <circle cx="6.8" cy="11.8" r="1.2" />
    </svg>
  )
}

function PlanExecutionOptions(props: PlanExecutionProps) {
  const { review, requestKey, sessionId, t, gateway, loadCatalog, presets } = props
  const readProjection = (props.useProjection ?? FALLBACK_PROJECTION) as unknown as ProjectionReader
  const projection = readProjection('modelSelection')
  const presetView = useSyncExternalStore(presets.subscribe, presets.getSnapshot, presets.getSnapshot)
  const catalogState = useModelCatalog(loadCatalog, sessionId)

  const [open, setOpen] = useState(false)
  const [modelValue, setModelValue] = useState('')
  const [effortByModel, setEffortByModel] = useState<Record<string, string>>({})
  const [mode, setMode] = useState<'compact' | 'keep'>('keep')
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [operation, setOperation] = useState<OperationState | null>(null)
  const [operationHash, setOperationHash] = useState('')
  const [pollError, setPollError] = useState<string | null>(null)
  const [position, setPosition] = useState<PanelPosition | null>(null)

  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const errorRef = useRef<HTMLParagraphElement>(null)
  const stagedByUserRef = useRef(false)
  const busyRef = useRef(false)
  const generatedId = useId()
  const panelId = `dpe-panel-${generatedId.replace(/[^a-zA-Z0-9_-]/g, '')}`
  const titleId = `${panelId}-title`

  const hasCall = review.callId !== undefined && String(review.callId).length > 0
  const reviewAddress = useMemo(() => ({
    sessionId: String(sessionId),
    callId: String(review.callId ?? ''),
    questionId: review.id,
  }), [sessionId, review.callId, review.id])
  const reviewIdentity = `${reviewAddress.sessionId}\u0000${reviewAddress.callId}\u0000${reviewAddress.questionId}`

  const catalog = catalogState.catalog
  const selectedModel = useMemo(() => {
    const choice = parseModelKey(modelValue)
    return choice === undefined ? undefined : findModel(catalog, choice.provider, choice.model)
  }, [catalog, modelValue])
  const storedEffort = modelValue === '' ? NO_EFFORT : effortByModel[modelValue] ?? NO_EFFORT
  const effectiveEffort = supportsEffort(selectedModel, storedEffort) ? storedEffort : NO_EFFORT
  const staleEffort = storedEffort !== NO_EFFORT && !supportsEffort(selectedModel, storedEffort)
  const levels = effortLevels(selectedModel)
  const defaultReasoning = defaultEffort(selectedModel)
  const defaultReasoningLabel = defaultReasoning === undefined
    ? translate(t, 'defaultEffort')
    : `${translate(t, 'defaultEffort')} (${effortLabel(selectedModel, defaultReasoning) ?? defaultReasoning})`

  const current = projection?.next ?? projection?.lastUsed ?? catalog?.default
  const currentModel = current === undefined ? undefined : findModel(catalog, current.provider, current.model)
  const currentEffort = current === undefined
    ? undefined
    : current.reasoningEffort ?? defaultEffort(currentModel)
  const currentEffortName = currentEffort === undefined ? undefined : effortLabel(currentModel, currentEffort) ?? currentEffort
  const currentLabel = current === undefined ? undefined : modelLabel(catalog, current)
  const failures = partialFailureNames(catalog)

  useEffect(() => {
    let live = true
    if (!hasCall) {
      setOperationHash('')
      return () => { live = false }
    }
    void planHash(review.plan).then(value => {
      if (live) setOperationHash(value)
    }).catch(() => {
      if (live) setOperationHash('')
    })
    return () => { live = false }
  }, [hasCall, review.plan])

  useEffect(() => {
    stagedByUserRef.current = false
    setOperation(null)
    setOperationHash('')
    setPollError(null)
    setError(null)
    setDirty(false)
    setMode('keep')
    setModelValue('')
    setEffortByModel({})
  }, [reviewIdentity])

  useEffect(() => {
    if (!hasCall || operationHash === '') return
    let live = true
    void planHash(review.plan).then(hash => gateway.getOperation({ ...reviewAddress, planHash: hash })).then(result => {
      if (!live || stagedByUserRef.current) return
      const state = unwrap(result)
      setOperation(state)
      if (state === null) return
      setMode(state.mode)
      setDirty(false)
      if (state.selection === undefined) {
        setModelValue('')
        return
      }
      const key = modelKey(state.selection)
      setModelValue(key)
      if (state.selection.reasoningEffort !== undefined) {
        setEffortByModel(previous => ({ ...previous, [key]: state.selection!.reasoningEffort! }))
      }
    }).catch(() => {
      // A review without a staged operation is the normal initial state.
    })
    return () => { live = false }
  }, [gateway, hasCall, operationHash, review.plan, reviewAddress])

  useEffect(() => {
    if (!hasCall || operation === null || operationHash === '') return
    if (TERMINAL_PHASES.has(operation.phase)) return
    let live = true
    let inFlight = false
    const tick = async (): Promise<void> => {
      if (!live || inFlight) return
      inFlight = true
      try {
        const state = unwrap(await gateway.getOperation({ ...reviewAddress, planHash: operationHash }))
        if (!live) return
        setPollError(null)
        setOperation(state)
      } catch (cause) {
        if (live) setPollError(describeError(cause))
      } finally {
        inFlight = false
      }
    }
    void tick()
    const timer = window.setInterval(() => { void tick() }, POLL_INTERVAL_MS)
    return () => {
      live = false
      window.clearInterval(timer)
    }
  }, [gateway, hasCall, operation?.phase, operationHash, reviewAddress])

  const close = useCallback(() => {
    setOpen(false)
    triggerRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return
    panelRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (error === null) return
    const target = errorRef.current
    if (target !== null && typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'nearest' })
  }, [error])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      close()
    }
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (panelRef.current?.contains(target) === true) return
      if (triggerRef.current?.contains(target) === true) return
      close()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [close, open])

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    const update = (): void => {
      const trigger = triggerRef.current
      const panel = panelRef.current
      if (trigger === null) return
      const viewport = window.visualViewport
      const viewWidth = viewport?.width ?? window.innerWidth
      const viewHeight = viewport?.height ?? window.innerHeight
      const width = Math.max(240, Math.min(360, viewWidth - 24))
      const maxHeight = Math.max(160, Math.min(440, viewHeight - 24))
      const anchor = trigger.getBoundingClientRect()
      const measured = panel?.getBoundingClientRect().height ?? 0
      const height = Math.min(measured > 0 ? measured : maxHeight, maxHeight)
      let top = anchor.bottom + 8
      if (top + height > viewHeight - 12) top = Math.max(12, anchor.top - height - 8)
      if (top + height > viewHeight - 12) top = 12
      let left = anchor.right - width
      left = Math.min(Math.max(12, left), Math.max(12, viewWidth - width - 12))
      setPosition({ top, left, width, maxHeight })
    }
    update()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update)
    if (triggerRef.current !== null) observer?.observe(triggerRef.current)
    if (panelRef.current !== null) observer?.observe(panelRef.current)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    const viewport = window.visualViewport
    viewport?.addEventListener('resize', update)
    viewport?.addEventListener('scroll', update)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      viewport?.removeEventListener('resize', update)
      viewport?.removeEventListener('scroll', update)
    }
  }, [open, catalogState.phase, modelValue, error, operation?.phase])

  const selectModel = (value: string): void => {
    setModelValue(value)
    setDirty(true)
    setError(null)
  }

  const selectEffort = (value: string): void => {
    if (modelValue === '') return
    setEffortByModel(previous => {
      const next = { ...previous }
      if (value === NO_EFFORT) delete next[modelValue]
      else next[modelValue] = value
      return next
    })
    setDirty(true)
    setError(null)
  }

  const applySelectionToForm = (nextMode: ExecutionMode, selection: ModelChoice | undefined): void => {
    setMode(nextMode)
    if (selection === undefined) {
      setModelValue('')
      return
    }
    const key = modelKey(selection)
    setModelValue(key)
    setEffortByModel(previous => {
      const next = { ...previous }
      if (selection.reasoningEffort === undefined) delete next[key]
      else next[key] = selection.reasoningEffort
      return next
    })
  }

  /**
   * Stage one explicit pair. The mode and selection are passed by value so a
   * shortcut never stages a value React has not committed yet.
   */
  const stageSelection = async (
    nextMode: ExecutionMode,
    selection: ModelChoice | undefined,
  ): Promise<boolean> => {
    if (busyRef.current) return false
    if (!hasCall) {
      setError(translate(t, 'noCall'))
      return false
    }
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      const request: StageApprovalRequest = {
        ...reviewAddress,
        planHash: await planHash(review.plan),
        mode: nextMode,
        ...(selection === undefined ? {} : { selection }),
        requestId: newRequestId(),
      }
      const staged = unwrap(await gateway.stageApproval(request))
      stagedByUserRef.current = true
      setOperation({
        operationId: staged.operationId,
        phase: 'staged',
        mode: nextMode,
        ...(selection === undefined ? {} : { selection }),
        updatedAt: Date.now(),
      })
      setDirty(false)
      applySelectionToForm(nextMode, selection)
      return true
    } catch (cause) {
      setError(describeError(cause))
      return false
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const save = async (): Promise<void> => {
    if (busyRef.current) return
    if (!hasCall) {
      setError(translate(t, 'noCall'))
      return
    }
    const selection = selectionFor(modelValue, effectiveEffort)
    if (modelValue !== '' && selection !== undefined) {
      const verdict = validateSelection(catalog, selection)
      if (verdict !== 'ok') {
        setError(translate(t, verdictKey(verdict)))
        return
      }
    }
    await stageSelection(mode, selection)
  }

  const quickPreset = (kind: 'compact' | 'keep'): ExecutionPreset | null => (
    kind === 'compact' ? presetView.presets.compact : presetView.presets.switch
  )

  const quickBlock = (kind: 'compact' | 'keep'): Key | null => {
    if (!hasCall) return 'noCall'
    if (presetView.status !== 'ready') return 'quickPresetUnavailable'
    if (quickPreset(kind) === null) return 'quickPresetMissing'
    if (busy) return 'staging'
    if (operation !== null && !TERMINAL_PHASES.has(operation.phase) && operation.phase !== 'staged') {
      return 'quickOperationBusy'
    }
    if (catalogState.phase === 'loading') return 'quickCatalogLoading'
    if (catalog === null) return 'quickCatalogUnavailable'
    if (presetVerdict(catalog, quickPreset(kind)) !== 'ok') return 'quickPresetInvalid'
    return null
  }

  const quickStage = async (kind: 'compact' | 'keep'): Promise<void> => {
    const blocked = quickBlock(kind)
    if (blocked !== null) {
      if (blocked !== 'staging') setError(translate(t, blocked))
      return
    }
    const preset = quickPreset(kind)
    if (preset === null) return
    await stageSelection(kind === 'compact' ? 'compact' : 'keep', preset)
  }

  const quickTitle = (kind: 'compact' | 'keep'): string => {
    const blocked = quickBlock(kind)
    if (blocked !== null) return translate(t, blocked)
    const preset = quickPreset(kind)
    const base = translate(t, kind === 'compact' ? 'quickCompactHint' : 'quickKeepHint')
    if (preset === null) return base
    const effort = preset.reasoningEffort === undefined
      ? undefined
      : effortLabel(findModel(catalog, preset.provider, preset.model), preset.reasoningEffort) ?? preset.reasoningEffort
    return `${base} ${modelLabel(catalog, preset)}${effort === undefined ? '' : ` · ${effort}`}`
  }

  const compactBlocked = quickBlock('compact')
  const keepBlocked = quickBlock('keep')

  const toggle = (): void => { setOpen(value => !value) }

  const phaseMessage = operation === null ? null : operation.phase === 'failed'
    ? translate(t, 'failed', { code: operation.errorCode ?? 'PREPARATION_FAILED' })
    : operation.phase === 'cancelled'
      ? translate(t, 'cancelled')
      : operation.phase === 'staged'
        ? translate(t, 'staged')
        : translate(t, operation.phase)

  const panelStyle = position === null
    ? { position: 'fixed' as const, top: 0, left: 0, width: 'min(360px, calc(100vw - 24px))', visibility: 'hidden' as const }
    : { position: 'fixed' as const, top: position.top, left: position.left, width: position.width, maxHeight: position.maxHeight }

  const panel = open ? createPortal(
    <div
      ref={panelRef}
      id={panelId}
      className="dpe-panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      tabIndex={-1}
      style={panelStyle}
      data-plan-execute={requestKey}
    >
      <div className="dpe-head">
        <h2 className="dpe-title" id={titleId}>{translate(t, 'title')}</h2>
        <button type="button" className="dpe-close" aria-label={translate(t, 'close')} onClick={close}>×</button>
      </div>
      <p className="dpe-hint dpe-preset-summary">
        {translate(t, 'presetSummary', {
          compact: quickPreset('compact') === null ? translate(t, 'presetNone') : modelLabel(catalog, quickPreset('compact')!),
          keep: quickPreset('keep') === null ? translate(t, 'presetNone') : modelLabel(catalog, quickPreset('keep')!),
        })}
        {' '}
        {translate(t, 'settingsHint')}
      </p>
      <div className="dpe-quick-panel" role="group" aria-label={translate(t, 'quickGroup')}>
        <button
          type="button"
          className="dpe-panel-quick"
          aria-disabled={compactBlocked !== null}
          title={quickTitle('compact')}
          onClick={() => { void quickStage('compact') }}
        >
          <CompactIcon />
          <span className="dpe-panel-quick-text">
            <span>{translate(t, 'quickCompact')}</span>
            <small>{quickPreset('compact') === null ? translate(t, 'presetNone') : modelLabel(catalog, quickPreset('compact')!)}</small>
          </span>
        </button>
        <button
          type="button"
          className="dpe-panel-quick"
          aria-disabled={keepBlocked !== null}
          title={quickTitle('keep')}
          onClick={() => { void quickStage('keep') }}
        >
          <KeepIcon />
          <span className="dpe-panel-quick-text">
            <span>{translate(t, 'quickKeep')}</span>
            <small>{quickPreset('keep') === null ? translate(t, 'presetNone') : modelLabel(catalog, quickPreset('keep')!)}</small>
          </span>
        </button>
      </div>
      <label className="dpe-field">
        <span>{translate(t, 'model')}</span>
        <select value={modelValue} disabled={busy} onChange={event => { selectModel(event.currentTarget.value) }}>
          <option value="">{translate(t, 'current')}</option>
          {catalog?.groups.map(group => (
            <optgroup key={group.id} label={group.name}>
              {group.models.map(entry => (
                <option key={entry.id} value={modelKey({ provider: group.id, model: entry.id })}>{entry.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
        {modelValue === '' && currentLabel !== undefined && (
          <small className="dpe-hint">
            {translate(t, 'currentModel', { model: currentLabel })}
            {currentEffortName === undefined ? null : ` · ${translate(t, 'currentEffort', { effort: currentEffortName })}`}
          </small>
        )}
        {catalogState.phase === 'loading' && <small className="dpe-hint">{translate(t, 'loading')}</small>}
        {catalogState.phase === 'timeout' && (
          <small className="dpe-warn">
            {translate(t, 'catalogTimeout')}
            <button type="button" className="dpe-link" onClick={catalogState.retry}>{translate(t, 'retry')}</button>
          </small>
        )}
        {catalogState.phase === 'error' && (
          <small className="dpe-warn">
            {translate(t, 'catalogError', { message: catalogState.error ?? '' })}
            <button type="button" className="dpe-link" onClick={catalogState.retry}>{translate(t, 'retry')}</button>
          </small>
        )}
        {catalogState.phase === 'ready' && catalog !== null && catalog.groups.length === 0 && (
          <small className="dpe-hint">{translate(t, 'catalogEmpty')}</small>
        )}
        {failures !== undefined && <small className="dpe-hint">{translate(t, 'catalogPartial', { names: failures })}</small>}
      </label>
      {modelValue === '' ? (
        <p className="dpe-hint">{translate(t, 'currentHint')}</p>
      ) : selectedModel === undefined ? (
        <p className="dpe-warn">{translate(t, 'modelUnavailable')}</p>
      ) : levels.length === 0 ? (
        <p className="dpe-hint">{translate(t, 'effortUnsupported')}</p>
      ) : (
        <label className="dpe-field">
          <span>{translate(t, 'effort')}</span>
          <select value={effectiveEffort} disabled={busy} onChange={event => { selectEffort(event.currentTarget.value) }}>
            <option value="">{defaultReasoningLabel}</option>
            {levels.map(level => <option key={level.id} value={level.id} title={level.description}>{level.name}</option>)}
          </select>
          {staleEffort && <small className="dpe-warn">{translate(t, 'effortStale')}</small>}
        </label>
      )}
      <fieldset className="dpe-mode" disabled={busy}>
        <legend>{translate(t, 'mode')}</legend>
        <label><input type="radio" name={`mode-${requestKey}`} checked={mode === 'keep'} onChange={() => { setMode('keep'); setDirty(true) }} />{translate(t, 'keep')}</label>
        <label><input type="radio" name={`mode-${requestKey}`} checked={mode === 'compact'} onChange={() => { setMode('compact'); setDirty(true) }} />{translate(t, 'compact')}</label>
      </fieldset>
      <button type="button" className="dpe-save" disabled={busy || !hasCall} onClick={() => { void save() }}>
        {busy ? translate(t, 'saving') : translate(t, 'stage')}
      </button>
      {dirty && !busy && <p className="dpe-status dpe-warn" role="status">{translate(t, 'dirty')}</p>}
      {!dirty && phaseMessage !== null && <p className="dpe-status" role="status">{phaseMessage}</p>}
      {pollError !== null && <p className="dpe-hint">{translate(t, 'pollError')}</p>}
      <p className="dpe-notice">{translate(t, 'notice')}</p>
      {error !== null && <p ref={errorRef} className="dpe-error" role="alert">{translate(t, 'error', { message: error })}</p>}
    </div>,
    document.body,
  ) : null

  const selectionLabel = (selection: ModelSelection | undefined): string => {
    if (selection === undefined) return translate(t, 'current')
    const effort = selection.reasoningEffort === undefined
      ? undefined
      : effortLabel(findModel(catalog, selection.provider, selection.model), selection.reasoningEffort)
        ?? selection.reasoningEffort
    return `${modelLabel(catalog, selection)}${effort === undefined ? '' : ` (${effort})`}`
  }
  const stagedSummary = operation?.phase === 'staged'
    ? translate(t, 'quickStaged', {
        mode: translate(t, operation.mode === 'compact' ? 'modeCompactShort' : 'modeKeepShort'),
        target: selectionLabel(operation.selection),
      })
    : null
  // The expanded panel owns detail; the collapsed strip only carries the
  // state a person needs before reopening it.
  const statusLine = open
    ? null
    : busy
      ? translate(t, 'staging')
      : error !== null
        ? translate(t, 'error', { message: error })
        : stagedSummary
          ?? (operation !== null && !TERMINAL_PHASES.has(operation.phase) ? phaseMessage : null)

  return (
    <div className="dpe-root" data-plan-execute={requestKey}>
      <div className="dpe-group" role="group" aria-label={translate(t, 'quickGroup')}>
        <span className="dpe-group-label">{translate(t, 'quickGroup')}</span>
        <button
          type="button"
          className="dpe-quick"
          aria-disabled={compactBlocked !== null}
          title={quickTitle('compact')}
          aria-label={`${translate(t, 'quickCompact')}: ${quickTitle('compact')}`}
          onClick={() => { void quickStage('compact') }}
        >
          <CompactIcon />
          <span className="dpe-quick-long">{translate(t, 'quickCompact')}</span>
        </button>
        <button
          type="button"
          className="dpe-quick"
          aria-disabled={keepBlocked !== null}
          title={quickTitle('keep')}
          aria-label={`${translate(t, 'quickKeep')}: ${quickTitle('keep')}`}
          onClick={() => { void quickStage('keep') }}
        >
          <KeepIcon />
          <span className="dpe-quick-long">{translate(t, 'quickKeep')}</span>
        </button>
        <button
          ref={triggerRef}
          type="button"
          className="dpe-more"
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-controls={panelId}
          aria-label={translate(t, 'options')}
          title={translate(t, 'options')}
          onClick={toggle}
        >
          <SlidersIcon />
          <span className="dpe-more-label">{translate(t, 'quickMore')}</span>
        </button>
      </div>
      {statusLine !== null && (
        <p
          className={error !== null ? 'dpe-quick-status dpe-quick-status-error' : 'dpe-quick-status'}
          role={error !== null ? 'alert' : 'status'}
          title={statusLine}
        >
          {statusLine}
        </p>
      )}
      {panel}
    </div>
  )
}

function css(): () => void {
  if (document.querySelector('style[data-plugin-css="dsh-plan-execute"]') !== null) return () => {}
  const style = document.createElement('style')
  style.dataset.pluginCss = 'dsh-plan-execute'
  style.textContent = `
    .dpe-root{display:flex;flex-direction:column;align-items:flex-end;gap:3px;min-width:0;max-width:100%;margin-left:10px;padding-left:10px;border-left:1px solid color-mix(in srgb,currentColor 24%,transparent);font:inherit}
    .dpe-group{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:1px;min-width:0;max-width:100%;padding:2px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-specific-input-major);color:var(--dsw-alias-label-primary);box-shadow:0 1px 2px rgb(0 0 0 / .05)}
    .dpe-group-label{padding:0 6px;font-size:11px;line-height:1;color:var(--dsw-alias-label-secondary);white-space:nowrap}
    .dpe-quick,.dpe-more{display:inline-flex;align-items:center;gap:4px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;font-weight:500;line-height:1;padding:6px 8px;cursor:pointer;white-space:nowrap}
    .dpe-quick svg,.dpe-more svg{flex:none;fill:none;stroke:currentColor;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round}
    .dpe-quick:hover:not(:disabled),.dpe-more:hover{background:var(--dsw-alias-interactive-bg-hover)}
    .dpe-quick:focus-visible,.dpe-more:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
    .dpe-quick[aria-disabled="true"]{opacity:.42;cursor:not-allowed}
    .dpe-more{margin-left:1px;padding-left:8px;border-left:1px solid var(--dsw-alias-border-l1);border-radius:0 7px 7px 0;color:var(--dsw-alias-label-secondary)}
    .dpe-quick-status{max-width:min(380px,60vw);margin:0;font-size:11px;line-height:1.35;color:inherit;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .dpe-quick-panel{display:none;gap:6px}
    .dpe-panel-quick{display:flex;align-items:center;gap:8px;padding:8px 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-specific-input-major);color:inherit;font:inherit;text-align:left;cursor:pointer}
    .dpe-panel-quick svg{flex:none;fill:none;stroke:currentColor;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round}
    .dpe-panel-quick:hover{background:var(--dsw-alias-interactive-bg-hover)}
    .dpe-panel-quick:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
    .dpe-panel-quick[aria-disabled="true"]{opacity:.5;cursor:not-allowed}
    .dpe-panel-quick-text{display:grid;gap:1px;min-width:0}
    .dpe-panel-quick-text span{font-size:13px}
    .dpe-panel-quick-text small{overflow:hidden;color:var(--dsw-alias-label-secondary);font-size:11px;text-overflow:ellipsis;white-space:nowrap}
    .dpe-quick-status-error{color:var(--dsw-alias-state-error-primary);font-weight:500}
    .dpe-panel{box-sizing:border-box;position:fixed;z-index:60;display:grid;gap:10px;padding:13px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-specific-input-major);box-shadow:var(--dsw-elevation-panel);color:var(--dsw-alias-label-primary);overflow:auto;overscroll-behavior:contain;outline:none}
    .dpe-panel *{box-sizing:border-box}
    .dpe-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
    .dpe-title{margin:0;font-size:14px;font-weight:600;line-height:1.4}
    .dpe-close{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:18px;line-height:1;cursor:pointer;padding:2px 6px;border-radius:6px}
    .dpe-close:hover,.dpe-close:focus-visible{background:var(--dsw-alias-interactive-bg-hover);outline:none}
    .dpe-field{display:grid;gap:5px;font-size:13px}
    .dpe-field select{min-width:0;width:100%;padding:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-specific-input-major);color:inherit;font:inherit;font-size:13px}
    .dpe-field small,.dpe-hint,.dpe-notice{font-size:11.5px;line-height:1.45;margin:0;color:var(--dsw-alias-label-secondary)}
    .dpe-preset-summary{padding:7px 8px;border-radius:7px;background:var(--dsw-alias-interactive-bg-hover)}
    .dpe-warn{color:var(--dsw-alias-state-warn-primary)}
    .dpe-mode{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:9px;display:grid;gap:7px;font-size:13px;margin:0}
    .dpe-mode label{display:flex;gap:7px;align-items:center}
    .dpe-save{justify-self:start;padding:7px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-interactive-bg-hover);color:inherit;font:inherit;font-size:13px;cursor:pointer}
    .dpe-save:disabled{opacity:.55;cursor:default}
    .dpe-link{border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-decoration:underline;cursor:pointer;padding:0 2px}
    .dpe-status,.dpe-error{font-size:12px;margin:0;line-height:1.45}
    .dpe-error{color:var(--dsw-alias-state-error-primary)}
    .dpe-set{display:flex;flex-direction:column;gap:14px;max-width:640px;color:var(--dsw-alias-label-primary);font-size:13px}
    .dpe-set-head h2{margin:0 0 6px;font-size:16px;font-weight:600;line-height:1.4}
    .dpe-set-head p{margin:0;color:var(--dsw-alias-label-secondary);line-height:1.55}
    .dpe-set-card{display:flex;flex-direction:column;gap:9px;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-specific-input-major)}
    .dpe-set-card-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
    .dpe-set-card-head h3{margin:0;font-size:14px;font-weight:600;line-height:1.4}
    .dpe-set-badge{padding:3px 7px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1;white-space:nowrap}
    .dpe-set-badge-override{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 16%,transparent);color:var(--dsw-alias-state-business-primary)}
    .dpe-set-hint{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}
    .dpe-set-field{display:grid;gap:5px;font-size:12px}
    .dpe-set-field select{width:100%;min-width:0;padding:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-specific-input-major);color:inherit;font:inherit;font-size:13px}
    .dpe-set-field select:disabled{opacity:.6}
    .dpe-set-warn{margin:0;color:var(--dsw-alias-state-warn-primary);font-size:12px;line-height:1.5}
    .dpe-set-error{margin:0;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:1.5}
    .dpe-set-status{margin:0;color:var(--dsw-alias-state-success-primary);font-size:12px;line-height:1.5}
    .dpe-set-note{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}
    .dpe-set-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
    .dpe-set-primary{padding:7px 14px;border:0;border-radius:7px;background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-state-business-primary));color:var(--dsw-alias-label-primary-inverted,#fff);font:inherit;font-size:13px;cursor:pointer}
    .dpe-set-primary:disabled{opacity:.5;cursor:not-allowed}
    .dpe-set-secondary{padding:7px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:transparent;color:inherit;font:inherit;font-size:13px;cursor:pointer}
    .dpe-set-secondary:disabled{opacity:.5;cursor:not-allowed}
    .dpe-set-link{border:0;background:transparent;color:inherit;font:inherit;text-decoration:underline;cursor:pointer;padding:0 2px}
    .dpe-set-dirty{color:var(--dsw-alias-state-warn-primary);font-size:12px}
    @media (width<=760px){
      .dpe-group-label{display:none}
    }
    @media (width<=560px){
      .dpe-root{margin-left:4px;padding-left:4px}
      .dpe-group-label{display:none}
      .dpe-quick{display:none}
      .dpe-more{margin-left:0;padding:5px 8px;border-left:0;border-radius:7px;color:var(--dsw-alias-label-primary)}
      .dpe-group{gap:0;padding:1px}
      .dpe-quick-panel{display:grid}
      .dpe-quick-status{max-width:200px}
    }
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

export const inject = ['slots', 'locale', 'remote', 'remote.session']

export async function apply(ctx: Context): Promise<void> {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), `${PACKAGE_NAME}: dictionaries`)
  ctx.effect(() => ctx.locale.register(SETTINGS_NS, settingsDictionaries), `${PACKAGE_NAME}: settings dictionaries`)
  ctx.effect(css, `${PACKAGE_NAME}: styles`)
  const disposeRemote = await ctx.remote.$mount(CLIENT_CONTRIBUTION)
  ctx.effect(() => disposeRemote, `${PACKAGE_NAME}: remote contribution`)

  const gateway = ctx.get(`remote.${SERVICE_KEY}`) as PlanExecuteRemote | undefined
  if (gateway === undefined) throw new Error(`${PACKAGE_NAME}: Host Remote namespace is unavailable`)

  const remote = ctx.remote
  const loadCatalog = async (): Promise<ModelCatalog> => unwrap(await remote.session.modelCatalog())
  const presets = new PresetStore()
  const settingsT = ctx.locale.bind(SETTINGS_NS)

  // Optional settings dependency: without Settings the panel keeps working and
  // the shortcuts stay unavailable, so a minimal composition still loads.
  ctx.inject(['configForms'], (forms) => {
    const form = forms.configForms.get<PresetFormValue>(SETTINGS_ENTRY_ID)
    const controller = new PresetController(form, presets)
    forms.effect(() => () => { controller.dispose() }, `${PACKAGE_NAME}: preset subscription`)
    forms.effect(() => forms.configForms.whileServed([SETTINGS_ENTRY_ID], () => (
      forms.slots.inject('settings.section', () => forms.slots.register({
        name: 'settings.section',
        id: PACKAGE_NAME,
        order: 55,
        label: () => settingsT('nav'),
        locale: SETTINGS_NS,
        inject: () => ({ controller, loadCatalog }),
      }, SettingsPage))
    )), `${PACKAGE_NAME}: settings page`)
  })

  ctx.slots.inject('conversation.plan-review.actions', () => ctx.slots.register({
    name: 'conversation.plan-review.actions',
    id: PACKAGE_NAME,
    locale: NS,
    inject: () => ({
      gateway,
      loadCatalog,
      presets,
    }),
  }, PlanExecutionSlot))
}

function PlanExecutionSlot(props: PlanExecutionProps) {
  return <PlanExecutionOptions {...props} />
}
