import { createRoot } from 'react-dom/client'
import { apply } from '../../src/client/index'

const catalog = {
  default: { provider: 'p', model: 'm1' },
  routableProviders: ['p'],
  groups: [{
    id: 'p',
    name: 'Provider P',
    models: [
      {
        id: 'm1',
        name: 'Model One',
        reasoning: {
          defaultEffort: 'medium',
          efforts: [
            { id: 'low', name: 'Low' },
            { id: 'medium', name: 'Medium' },
            { id: 'high', name: 'High' },
          ],
        },
      },
      { id: 'm2', name: 'Model Two' },
      { id: 'm3', name: 'A model with an intentionally very long display name for overflow checks' },
    ],
  }],
  failures: [{ id: 'q', name: 'Provider Q', message: 'temporarily offline' }],
}

const messages: Record<string, string> = {
  options: 'Execution options',
  title: 'Execution options',
  close: 'Close execution options',
  model: 'Execution model',
  current: 'Use current model',
  currentModel: 'Current: {model}',
  currentEffort: 'Reasoning effort: {effort}',
  currentHint: 'Keeps the current model. Choose a specific model to set a reasoning effort.',
  effort: 'Reasoning effort',
  defaultEffort: 'Use model default',
  effortUnsupported: 'This model does not provide adjustable reasoning effort.',
  effortStale: 'The previously selected effort is no longer available; the model default will be used.',
  mode: 'Context handling',
  keep: 'Execute with context unchanged',
  compact: 'Compact earlier history, then execute',
  stage: 'Save these settings',
  saving: 'Saving…',
  saved: 'Settings saved; click the native Approve button below to execute.',
  dirty: 'Unsaved changes; approval will use the last saved settings.',
  loading: 'Loading available models…',
  retry: 'Retry',
  catalogError: 'Could not load the model catalog: {message}',
  catalogTimeout: 'Loading available models timed out; you can retry.',
  catalogEmpty: 'No other models are available; the current model can still be used.',
  catalogPartial: 'Some providers are unavailable: {names}.',
  modelUnavailable: 'The selected model is no longer available; choose another model.',
  catalogRequired: 'The model catalog is unavailable, so the selected model cannot be validated; retry or keep the current model.',
  effortUnavailable: 'The selected reasoning effort is no longer available; choose another level.',
  pollError: 'Temporary status lookup failure; retrying…',
  noCall: 'Cannot bind this review to its tool call; use native approval.',
  error: 'Execution settings unavailable: {message}',
  staged: 'Saved; waiting for approval',
  validating: 'Validating the plan and execution options',
  compacting: 'Compacting history before the plan',
  'selecting-model': 'Setting the execution model for this Session',
  released: 'Preparation complete; the plan was approved',
  failed: 'Preparation failed: {code}. The plan was not approved; review it again.',
  cancelled: 'Operation cancelled; the plan was not approved.',
  notice: 'A custom model remains active for this Session and the public DSH API also updates the Host default. Compaction cannot be rolled back.',
  quickGroup: 'Presets',
  quickCompact: 'Compact, then run',
  quickKeep: 'Keep, then run',
  quickMore: 'Options',
  quickCompactHint: 'Stages the saved “compact history, then execute” preset; the native Approve button still executes.',
  quickKeepHint: 'Stages the saved “keep history, then execute” preset; the native Approve button still executes.',
  quickStaged: 'Staged: {mode} · {target}. Use the native “Approve” button below.',
  quickBusy: 'Staging…',
  quickPresetUnavailable: 'Preset settings are currently unavailable.',
  quickPresetMissing: 'This shortcut has no preset yet; configure it in Settings → Plan approval execution.',
  quickPresetInvalid: 'The preset model is currently unavailable; update the settings.',
  quickCatalogLoading: 'Loading the model catalog…',
  quickCatalogUnavailable: 'The model catalog is unavailable, so the preset cannot be validated.',
  quickOperationBusy: 'Execution preparation is already in progress.',
  presetSummary: 'Current presets: compact {compact}; keep {keep}.',
  presetNone: 'not configured',
  settingsHint: 'Change presets in Settings → Plan approval execution.',
  modeCompactShort: 'compact history, then execute',
  modeKeepShort: 'keep history, then execute',
  staging: 'Staging…',
}

const t = (key: string, params?: Record<string, unknown>): string => {
  const template = messages[key] ?? key
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''))
}

const review = {
  id: 'plan-review',
  question: 'Approve this plan?',
  plan: '# Fixture plan\n\nA long plan body used by the layout fixture.',
  callId: 'call-1',
  approve: { label: 'Approve' },
  decline: { label: 'Keep planning' },
}

const state = {
  lastStage: null as unknown,
  stageCount: 0,
  operation: null as null | Record<string, unknown>,
}

const gateway = {
  stageApproval: async (request: Record<string, unknown>) => {
    state.lastStage = request
    state.stageCount += 1
    state.operation = {
      operationId: 'op-1',
      phase: 'staged',
      mode: request.mode,
      ...(request.selection === undefined ? {} : { selection: request.selection }),
      updatedAt: Date.now(),
    }
    return { ok: true as const, value: { operationId: 'op-1', phase: 'staged' as const } }
  },
  getOperation: async () => ({ ok: true as const, value: state.operation }),
}

let Captured: React.ComponentType<Record<string, unknown>> | undefined
let injectFace: Record<string, unknown> = {}

const ctx = {
  effect: (factory: () => unknown) => factory(),
  locale: { register: () => () => {}, bind: () => t },
  remote: {
    $mount: async () => () => {},
    session: { modelCatalog: async () => ({ ok: true as const, value: catalog }) },
  },
  get: (key: string) => key === 'remote.planExecute' ? gateway : undefined,
  inject: () => ({}),
  slots: {
    inject: (_name: string, factory: () => unknown) => factory(),
    register: (
      definition: { inject: () => Record<string, unknown> },
      component: React.ComponentType<Record<string, unknown>>,
    ) => {
      Captured = component
      injectFace = definition.inject()
      return () => {}
    },
  },
}

const mount = document.getElementById('slot')
if (mount === null) throw new Error('missing slot')

await apply(ctx as never)
if (Captured === undefined) throw new Error('slot component was not registered')

const presets = injectFace.presets as { publish(view: unknown): void }
presets.publish({
  status: 'ready',
  presets: {
    compact: { provider: 'p', model: 'm3' },
    switch: { provider: 'p', model: 'm1', reasoningEffort: 'high' },
  },
  inherited: { compact: null, switch: null },
  overridden: { compact: true, switch: true },
  writable: true,
  revision: 1,
})

const Component = Captured as React.ComponentType<Record<string, unknown>>
createRoot(mount).render(
  <Component
    review={review}
    requestKey="fixture-request"
    sessionId="fixture-session"
    t={t}
    useProjection={() => ({ next: { provider: 'p', model: 'm1', reasoningEffort: 'high' }, lastUsed: null })}
    {...injectFace}
  />,
)

;(window as unknown as { __fixture: typeof state }).__fixture = state
