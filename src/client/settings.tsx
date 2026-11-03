import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { ModelCatalog } from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  defaultEffort,
  effortLabel,
  effortLevels,
  findModel,
  modelKey,
  parseModelKey,
} from './model-catalog.js'
import {
  presetVerdict,
  type ExecutionPreset,
  type PresetController,
  type PresetDraft,
} from './presets.js'
import { useModelCatalog } from './use-catalog.js'

/** Dictionary namespace of the settings page. */
export const SETTINGS_NS = 'planExecuteSettings'

const zhSettings = {
  'title': '计划审批执行',
  'nav': '计划审批执行',
  'description': '为计划审批卡片保存两套执行目标。快捷按钮只暂存设置，仍需点击原生批准；未配置的快捷按钮不可用。',
  'compactTitle': '压缩历史后执行',
  'compactHint': '先压缩计划之前的安全历史，再用以下模型执行。',
  'switchTitle': '保留历史后执行',
  'switchHint': '不压缩上下文，直接用以下模型执行。',
  'model': '执行模型',
  'effort': '思考等级',
  'unconfigured': '未配置（快捷按钮不可用）',
  'defaultEffort': '使用模型默认值',
  'effortUnsupported': '该模型不支持调节思考等级。',
  'overridden': '已覆盖',
  'inherited': '继承',
  'loading': '正在读取设置…',
  'catalogLoading': '正在读取可用模型…',
  'catalogError': '模型目录加载失败：{message}',
  'catalogTimeout': '读取可用模型超时，可重试。',
  'retry': '重试',
  'unavailable': '该部署未提供计划审批执行设置。',
  'readOnly': '本部署的设置只读。',
  'sharedNote': '这些预设写入当前 profile，并与使用同一 profile 的其他浏览器共享。继承的预设不能在此清除；修改会写入当前 profile 的覆盖。',
  'save': '保存预设',
  'saving': '正在保存…',
  'discard': '放弃更改',
  'dirty': '有未保存的更改。',
  'saved': '预设已保存。',
  'conflict': '设置已在其他位置更新；当前草稿尚未保存，请检查后重试。',
  'failed': '设置未被接受；草稿已保留。',
  'invalid': '请选择一个当前可用的模型和思考等级。',
  'staleModel': '已保存但当前不可用',
  'staleHint': '宿主中的已保存值已变化；保存会用当前草稿覆盖它们。',
} as const

const enSettings: Record<keyof typeof zhSettings, string> = {
  'title': 'Plan approval execution',
  'nav': 'Plan approval execution',
  'description': 'Save two execution targets for plan-review cards. A shortcut only stages its settings; the native Approve button still executes. A shortcut without a preset stays unavailable.',
  'compactTitle': 'Compact history, then execute',
  'compactHint': 'Compact the safe history before the plan, then execute with this model.',
  'switchTitle': 'Keep history, then execute',
  'switchHint': 'Execute with this model without compacting context.',
  'model': 'Execution model',
  'effort': 'Reasoning effort',
  'unconfigured': 'Not configured (shortcut unavailable)',
  'defaultEffort': 'Use model default',
  'effortUnsupported': 'This model does not provide adjustable reasoning effort.',
  'overridden': 'Overridden',
  'inherited': 'Inherited',
  'loading': 'Loading settings…',
  'catalogLoading': 'Loading available models…',
  'catalogError': 'Could not load the model catalog: {message}',
  'catalogTimeout': 'Loading available models timed out; you can retry.',
  'retry': 'Retry',
  'unavailable': 'This deployment does not provide plan approval execution settings.',
  'readOnly': 'This deployment stores settings read-only.',
  'sharedNote': 'These presets are written to the current profile and shared with other browsers using it. An inherited preset cannot be cleared here; editing it writes an override in this profile.',
  'save': 'Save presets',
  'saving': 'Saving…',
  'discard': 'Discard changes',
  'dirty': 'Unsaved changes.',
  'saved': 'Presets saved.',
  'conflict': 'Settings changed elsewhere; the current draft was not saved. Review it and try again.',
  'failed': 'The deployment did not accept these values; the draft was kept.',
  'invalid': 'Choose a model and reasoning effort that are currently available.',
  'staleModel': 'Saved, currently unavailable',
  'staleHint': 'The saved Host values changed; saving will replace them with this draft.',
}

type SettingsKey = keyof typeof zhSettings
type Translator = (key: SettingsKey, params?: Record<string, unknown>) => string

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    planExecuteSettings: SettingsKey
  }
}

/** Dictionary pair registered by the plugin shell. */
export const settingsDictionaries = { zh: zhSettings, en: enSettings } as const

/** Business face injected into the settings section. */
export interface SettingsInjected {
  readonly controller: PresetController
  readonly loadCatalog: () => Promise<ModelCatalog>
}

/** Full component props composed by the slot renderer. */
export type SettingsPageProps = PropsRuntime<'settings.section'>
  & PropsLocale<typeof SETTINGS_NS>
  & SettingsInjected

type Kind = 'compact' | 'switch'

function kindTitle(t: Translator, kind: Kind): string {
  return t(kind === 'compact' ? 'compactTitle' : 'switchTitle')
}

function kindHint(t: Translator, kind: Kind): string {
  return t(kind === 'compact' ? 'compactHint' : 'switchHint')
}

interface PresetCardProps {
  readonly t: Translator
  readonly kind: Kind
  readonly preset: ExecutionPreset | null
  readonly overridden: boolean
  readonly catalog: ModelCatalog | null
  readonly disabled: boolean
  readonly onChange: (preset: ExecutionPreset | null) => void
}

function PresetCard({ t, kind, preset, overridden, catalog, disabled, onChange }: PresetCardProps) {
  const model = preset === null ? undefined : findModel(catalog, preset.provider, preset.model)
  const levels = effortLevels(model)
  const staleModel = preset !== null && model === undefined
  const staleEffort = preset?.reasoningEffort !== undefined
    && !levels.some(level => level.id === preset.reasoningEffort)
  const defaultName = model === undefined ? undefined : defaultEffort(model)
  const defaultLabel = defaultName === undefined
    ? t('defaultEffort')
    : `${t('defaultEffort')} (${effortLabel(model, defaultName) ?? defaultName})`

  const changeModel = (value: string): void => {
    const choice = parseModelKey(value)
    if (choice === undefined) {
      onChange(null)
      return
    }
    const nextModel = findModel(catalog, choice.provider, choice.model)
    const effort = preset?.reasoningEffort !== undefined
      && effortLevels(nextModel).some(level => level.id === preset.reasoningEffort)
      ? preset.reasoningEffort
      : undefined
    onChange({ ...choice, ...(effort === undefined ? {} : { reasoningEffort: effort }) })
  }

  const changeEffort = (value: string): void => {
    if (preset === null) return
    const { reasoningEffort: _current, ...choice } = preset
    onChange(value === '' ? choice : { ...choice, reasoningEffort: value })
  }

  return (
    <section className="dpe-set-card" aria-labelledby={`dpe-set-${kind}`}>
      <div className="dpe-set-card-head">
        <h3 id={`dpe-set-${kind}`}>{kindTitle(t, kind)}</h3>
        <span className={overridden ? 'dpe-set-badge dpe-set-badge-override' : 'dpe-set-badge'}>
          {overridden ? t('overridden') : t('inherited')}
        </span>
      </div>
      <p className="dpe-set-hint">{kindHint(t, kind)}</p>
      <label className="dpe-set-field">
        <span>{t('model')}</span>
        <select value={preset === null ? '' : modelKey(preset)} disabled={disabled} onChange={event => { changeModel(event.currentTarget.value) }}>
          <option value="" disabled={preset !== null && !overridden}>{t('unconfigured')}</option>
          {catalog?.groups.map(group => (
            <optgroup key={group.id} label={group.name}>
              {group.models.map(entry => (
                <option key={entry.id} value={modelKey({ provider: group.id, model: entry.id })}>{entry.name}</option>
              ))}
            </optgroup>
          ))}
          {staleModel && preset !== null && (
            <option value={modelKey(preset)} disabled>{`${preset.model} (${t('staleModel')})`}</option>
          )}
        </select>
      </label>
      {preset === null ? null : model === undefined ? (
        <p className="dpe-set-warn">{t('invalid')}</p>
      ) : levels.length === 0 ? (
        <p className="dpe-set-hint">{t('effortUnsupported')}</p>
      ) : (
        <label className="dpe-set-field">
          <span>{t('effort')}</span>
          <select
            value={preset.reasoningEffort ?? ''}
            disabled={disabled}
            onChange={event => { changeEffort(event.currentTarget.value) }}
          >
            <option value="">{defaultLabel}</option>
            {levels.map(level => <option key={level.id} value={level.id}>{level.name}</option>)}
            {staleEffort && preset.reasoningEffort !== undefined && (
              <option value={preset.reasoningEffort} disabled>{`${preset.reasoningEffort} (${t('staleModel')})`}</option>
            )}
          </select>
        </label>
      )}
    </section>
  )
}

/**
 * Settings page for the two saved execution targets. The page owns a staged
 * draft and writes atomically through the shared ConfigForm; a write fenced to
 * an older revision is refused and the draft survives for the next attempt.
 */
export function SettingsPage({ controller, loadCatalog, t }: SettingsPageProps) {
  const store = controller.store
  const view = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const catalogState = useModelCatalog(loadCatalog, 'plan-approval-settings')
  const catalog = catalogState.catalog

  const [draft, setDraft] = useState<PresetDraft | null>(null)
  const [dirty, setDirty] = useState(false)
  const [fence, setFence] = useState<number | undefined>(undefined)
  const [stale, setStale] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ readonly level: 'ok' | 'warn' | 'error'; readonly text: string } | null>(null)

  useEffect(() => {
    if (view.status !== 'ready') return
    if (dirty) {
      if (fence !== undefined && view.revision !== undefined && view.revision !== fence) setStale(true)
      return
    }
    setDraft(view.presets)
    setFence(view.revision)
    setStale(false)
  }, [dirty, fence, view])

  const refresh = catalogState.retry

  const edit = useCallback((kind: Kind, preset: ExecutionPreset | null): void => {
    setDraft(current => {
      const base = current ?? view.presets
      return { ...base, [kind]: preset }
    })
    setDirty(true)
    setMessage(null)
  }, [view.presets])

  const discard = useCallback((): void => {
    setDraft(view.presets)
    setDirty(false)
    setFence(view.revision)
    setStale(false)
    setMessage(null)
  }, [view])

  const save = useCallback(async (): Promise<void> => {
    if (busy || draft === null || view.status !== 'ready' || !view.writable) return
    for (const kind of ['compact', 'switch'] as const) {
      if (presetVerdict(catalog, draft[kind]) !== 'ok' && draft[kind] !== null) {
        setMessage({ level: 'error', text: t('invalid') })
        return
      }
    }
    setBusy(true)
    setMessage(null)
    try {
      const outcome = await controller.save(draft, fence)
      if (outcome === 'saved' || outcome === 'unchanged') {
        setDirty(false)
        setMessage({ level: 'ok', text: t('saved') })
        return
      }
      if (outcome === 'conflict') {
        setStale(true)
        setFence(store.getSnapshot().revision)
        setMessage({ level: 'warn', text: t('conflict') })
        return
      }
      setMessage({ level: 'error', text: t('failed') })
    } finally {
      setBusy(false)
    }
  }, [busy, catalog, controller, draft, fence, store, t, view.status, view.writable])

  const configurable = view.status === 'ready'
  const disabled = busy || !view.writable || !configurable
  const effective = draft ?? view.presets
  const duration = catalogState.phase

  const catalogNote = useMemo(() => {
    if (duration === 'loading') return <p className="dpe-set-hint">{t('catalogLoading')}</p>
    if (duration === 'timeout') {
      return (
        <p className="dpe-set-warn">
          {t('catalogTimeout')}
          <button type="button" className="dpe-set-link" onClick={refresh}>{t('retry')}</button>
        </p>
      )
    }
    if (duration === 'error') {
      return (
        <p className="dpe-set-warn">
          {t('catalogError', { message: catalogState.error ?? '' })}
          <button type="button" className="dpe-set-link" onClick={refresh}>{t('retry')}</button>
        </p>
      )
    }
    return null
  }, [catalogState.error, duration, refresh, t])

  return (
    <div className="dpe-set" data-plan-execute-settings="plan-execute">
      <header className="dpe-set-head">
        <h2>{t('title')}</h2>
        <p>{t('description')}</p>
      </header>
      {!configurable ? (
        <p className="dpe-set-warn" role="status">
          {view.status === 'loading' ? t('loading') : t('unavailable')}
        </p>
      ) : (
        <>
          {!view.writable && <p className="dpe-set-warn" role="status">{t('readOnly')}</p>}
          {catalogNote}
          <PresetCard
            t={t}
            kind="compact"
            preset={effective.compact}
            overridden={view.overridden.compact}
            catalog={catalog}
            disabled={disabled}
            onChange={preset => { edit('compact', preset) }}
          />
          <PresetCard
            t={t}
            kind="switch"
            preset={effective.switch}
            overridden={view.overridden.switch}
            catalog={catalog}
            disabled={disabled}
            onChange={preset => { edit('switch', preset) }}
          />
          <p className="dpe-set-note">{t('sharedNote')}</p>
          {stale && <p className="dpe-set-warn" role="status">{t('staleHint')}</p>}
          {message !== null && (
            <p className={message.level === 'ok' ? 'dpe-set-status' : `dpe-set-${message.level}`} role="status">{message.text}</p>
          )}
          <div className="dpe-set-actions">
            <button type="button" className="dpe-set-primary" disabled={disabled || !dirty || busy} onClick={() => { void save() }}>
              {busy ? t('saving') : t('save')}
            </button>
            <button type="button" className="dpe-set-secondary" disabled={disabled || !dirty || busy} onClick={discard}>
              {t('discard')}
            </button>
            {dirty && !busy && <span className="dpe-set-dirty">{t('dirty')}</span>}
          </div>
        </>
      )}
    </div>
  )
}
