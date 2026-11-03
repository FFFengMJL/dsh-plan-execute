// @vitest-environment jsdom
import type { ComponentType } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelCatalog } from '@deepseek-ai/dsh-api-remotes/client'
import { apply } from '../src/client/index.js'
import { PresetStore, type PresetView } from '../src/client/presets.js'
import type { OperationPhase, OperationState, StageApprovalRequest } from '../src/protocol.js'

const PLAN = '# Approved plan\n\nKeep this plan authoritative.'
const SESSION_ID = 'session-1'
const CALL_ID = 'call-1'
const QUESTION_ID = 'plan-review'

const catalog: ModelCatalog = {
  default: { provider: 'p', model: 'm1' },
  routableProviders: ['p'],
  groups: [{
    id: 'p',
    name: 'Provider P',
    models: [{
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
    }, { id: 'm2', name: 'Model Two' }],
  }],
  failures: [],
}

const review = {
  id: QUESTION_ID,
  question: 'Approve this plan?',
  plan: PLAN,
  callId: CALL_ID,
  approve: { label: 'Approve' },
  decline: { label: 'Keep planning' },
}

const t = ((key: string, params?: Record<string, unknown>) =>
  params === undefined ? key : `${key}:${JSON.stringify(params)}`) as never

function operation(phase: OperationPhase): OperationState {
  return {
    operationId: 'op-1',
    phase,
    mode: 'keep',
    updatedAt: Date.now(),
  }
}

interface MountOptions {
  readonly catalog?: ModelCatalog | (() => Promise<ModelCatalog>)
  readonly gateway?: {
    stageApproval: ReturnType<typeof vi.fn>
    getOperation: ReturnType<typeof vi.fn>
  }
  readonly projection?: unknown
  readonly presets?: PresetView
  readonly optionalServices?: boolean
}

async function mount(options: MountOptions = {}) {
  const disposers: Array<() => void> = []
  const gateway = options.gateway ?? {
    stageApproval: vi.fn(async () => ({ ok: true, value: { operationId: 'op-1', phase: 'staged' as const } })),
    getOperation: vi.fn(async () => ({ ok: true, value: null })),
  }
  const catalogSource = options.catalog ?? catalog
  const modelCatalog = vi.fn(async () => ({
    ok: true as const,
    value: typeof catalogSource === 'function' ? await catalogSource() : catalogSource,
  }))
  let Captured: ComponentType<Record<string, unknown>> | undefined
  let injectFace: Record<string, unknown> = {}
  const registered = new Map<string, ComponentType<Record<string, unknown>>>()
  const configForms = {
    get: vi.fn(() => ({
      getSnapshot: () => ({ status: 'ready' as const, value: {}, base: {}, user: {}, revision: 0, writable: true }),
      subscribe: () => () => {},
      mutate: vi.fn(async () => true),
      unset: vi.fn(async () => true),
    })),
    whileServed: vi.fn((namespaces: readonly string[], register: (served: ReadonlySet<string>) => () => void) => register(new Set(namespaces))),
  }
  let childContext: Record<string, unknown> | undefined

  const ctx = {
    effect: (factory: () => unknown) => {
      const dispose = factory()
      if (typeof dispose === 'function') disposers.push(dispose as () => void)
      return dispose
    },
    locale: { register: () => () => {}, bind: () => t },
    remote: {
      $mount: async () => () => {},
      session: { modelCatalog },
    },
    get: (key: string) => key === 'remote.planExecute' ? gateway : undefined,
    // By default the panel test composes without Settings or the command
    // surface; the optional children simply never activate.
    inject: (_deps: readonly string[], callback: (child: Record<string, unknown>) => unknown) => {
      if (options.optionalServices === true && childContext !== undefined) callback(childContext)
      return { then: () => {} }
    },
    slots: {
      inject: (_name: string, factory: () => unknown) => factory(),
      register: (
        definition: { name: string; inject?: () => Record<string, unknown> },
        component: ComponentType<Record<string, unknown>>,
      ) => {
        registered.set(definition.name, component)
        if (definition.name === 'conversation.plan-review.actions') {
          Captured = component
          injectFace = definition.inject?.() ?? {}
        }
        return () => {}
      },
    },
  }

  childContext = {
    effect: ctx.effect,
    locale: ctx.locale,
    get: ctx.get,
    slots: ctx.slots,
    configForms,
  }

  await apply(ctx as never)
  if (Captured === undefined) throw new Error('slot component was not registered')

  const presetStore = injectFace.presets as PresetStore
  if (options.presets !== undefined) presetStore.publish(options.presets)

  const props = {
    review,
    requestKey: 'request-key-1',
    sessionId: SESSION_ID as never,
    t,
    useProjection: () => options.projection,
  }
  const view = render(<Captured {...props} {...injectFace} />)
  expect(document.body.contains(view.container)).toBe(true)
  return { gateway, modelCatalog, view, disposers, presetStore, registered, configForms }
}


function presetView(overrides: Partial<PresetView> = {}): PresetView {
  return {
    status: 'ready',
    presets: {
      compact: { provider: 'p', model: 'm1', reasoningEffort: 'high' },
      switch: { provider: 'p', model: 'm2' },
    },
    inherited: { compact: null, switch: null },
    overridden: { compact: true, switch: true },
    writable: true,
    revision: 1,
    ...overrides,
  }
}

async function openPanel(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('button', { name: 'options' }))
  return screen.findByRole('dialog')
}

function modelSelect(): HTMLSelectElement {
  return screen.getAllByRole('combobox')[0] as HTMLSelectElement
}

function effortSelect(): HTMLSelectElement {
  return screen.getAllByRole('combobox')[1] as HTMLSelectElement
}

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('execution options client', () => {
  it('keeps polling non-terminal phases until the operation settles', async () => {
    let current: OperationState | null = operation('staged')
    const gateway = {
      stageApproval: vi.fn(),
      getOperation: vi.fn(async () => ({ ok: true as const, value: current })),
    }
    await mount({ gateway })
    const panel = await openPanel()

    expect(panel.parentElement).toBe(document.body)
    await screen.findByText('staged')

    for (const phase of ['validating', 'compacting', 'selecting-model'] as const) {
      current = operation(phase)
      await waitFor(() => expect(screen.getByText(phase)).toBeTruthy(), { timeout: 2500 })
    }

    current = operation('released')
    await waitFor(() => expect(screen.getByText('released')).toBeTruthy(), { timeout: 2500 })
    const callsAfterRelease = gateway.getOperation.mock.calls.length
    await new Promise(resolve => setTimeout(resolve, 700))
    expect(gateway.getOperation.mock.calls.length).toBe(callsAfterRelease)
  }, 20_000)

  it('reports a catalog failure and retries without losing the current-model option', async () => {
    let attempts = 0
    const catalogSource = async (): Promise<ModelCatalog> => {
      attempts += 1
      if (attempts === 1) throw new Error('provider exploded')
      return catalog
    }
    await mount({ catalog: catalogSource })
    await openPanel()

    await screen.findByText(/catalogError/)
    expect(screen.getByRole('option', { name: 'current' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'retry' }))
    await waitFor(() => expect(screen.getByRole('option', { name: 'Model One' })).toBeTruthy())
    expect(attempts).toBe(2)
  })

  it('loads reasoning levels, remembers them per model, and submits the exact selection', async () => {
    const gateway = {
      stageApproval: vi.fn(async () => ({ ok: true as const, value: { operationId: 'op-1', phase: 'staged' as const } })),
      getOperation: vi.fn(async () => ({ ok: true as const, value: null })),
    }
    await mount({ gateway })
    await openPanel()

    fireEvent.change(modelSelect(), { target: { value: '["p","m1"]' } })
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(2))
    const effort = effortSelect()
    expect(Array.from(effort.options).map(option => option.textContent)).toEqual([
      'defaultEffort (Medium)',
      'Low',
      'Medium',
      'High',
    ])

    fireEvent.change(effort, { target: { value: 'high' } })
    expect(screen.getByText('dirty')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'stage' }))

    await waitFor(() => expect(gateway.stageApproval).toHaveBeenCalledTimes(1))
    const request = gateway.stageApproval.mock.calls[0]![0] as StageApprovalRequest
    expect(request.selection).toEqual({ provider: 'p', model: 'm1', reasoningEffort: 'high' })
    expect(request.mode).toBe('keep')

    fireEvent.change(modelSelect(), { target: { value: '["p","m2"]' } })
    expect(await screen.findByText('effortUnsupported')).toBeTruthy()

    fireEvent.change(modelSelect(), { target: { value: '["p","m1"]' } })
    expect(effortSelect().value).toBe('high')
  })

  it('submits no reasoningEffort when the model default is kept', async () => {
    const gateway = {
      stageApproval: vi.fn(async () => ({ ok: true as const, value: { operationId: 'op-1', phase: 'staged' as const } })),
      getOperation: vi.fn(async () => ({ ok: true as const, value: null })),
    }
    await mount({ gateway })
    await openPanel()
    fireEvent.change(modelSelect(), { target: { value: '["p","m1"]' } })
    fireEvent.click(screen.getByRole('button', { name: 'stage' }))

    await waitFor(() => expect(gateway.stageApproval).toHaveBeenCalledTimes(1))
    const request = gateway.stageApproval.mock.calls[0]![0] as StageApprovalRequest
    expect(request.selection).toEqual({ provider: 'p', model: 'm1' })
  })

  it('shows the current model and effort from the Session projection', async () => {
    await mount({
      projection: { next: { provider: 'p', model: 'm1', reasoningEffort: 'high' }, lastUsed: null },
    })
    await openPanel()
    expect(await screen.findByText(/currentModel/)).toBeTruthy()
    expect(screen.getByText(/currentEffort/)).toBeTruthy()
  })

  it('closes on Escape, on outside pointer down, and restores trigger focus', async () => {
    await mount()
    const trigger = screen.getByRole('button', { name: 'options' })
    fireEvent.click(trigger)
    await screen.findByRole('dialog')
    expect(trigger.getAttribute('aria-expanded')).toBe('true')

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(trigger)

    fireEvent.click(trigger)
    await screen.findByRole('dialog')
    fireEvent.pointerDown(document.body)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('shows a save failure without clearing the staged state text', async () => {
    const gateway = {
      stageApproval: vi.fn(async () => ({ ok: false as const, error: { code: 'REVIEW_NOT_ACTIVE', message: 'gone' } })),
      getOperation: vi.fn(async () => ({ ok: true as const, value: null })),
    }
    await mount({ gateway })
    await openPanel()
    fireEvent.click(screen.getByRole('button', { name: 'stage' }))
    expect(await screen.findByText(/REVIEW_NOT_ACTIVE/)).toBeTruthy()
    expect(screen.queryByText('staged')).toBeNull()
  })

  it('stops showing the loading hint after a catalog timeout and offers retry', async () => {
    vi.useFakeTimers()
    let resolveCatalog: ((value: { ok: true; value: ModelCatalog }) => void) | undefined
    const pending = new Promise<{ ok: true; value: ModelCatalog }>(resolve => { resolveCatalog = resolve })
    await mount({ catalog: () => pending })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    fireEvent.click(screen.getByRole('button', { name: 'options' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(screen.getByText('catalogTimeout')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'retry' })).toBeTruthy()
    resolveCatalog?.({ ok: true, value: catalog })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  })

  it('stages the saved compact preset and still waits for the native approval', async () => {
    let staged: StageApprovalRequest | undefined
    const gateway = {
      stageApproval: vi.fn(async (request: StageApprovalRequest) => {
        staged = request
        return { ok: true as const, value: { operationId: 'op-1', phase: 'staged' as const } }
      }),
      getOperation: vi.fn(async () => ({
        ok: true as const,
        value: staged === undefined ? null : {
          operationId: 'op-1',
          phase: 'staged' as const,
          mode: staged.mode,
          ...(staged.selection === undefined ? {} : { selection: staged.selection }),
          updatedAt: Date.now(),
        },
      })),
    }
    await mount({ gateway, presets: presetView() })
    const button = screen.getByRole('button', { name: /quickCompact:/ })
    await waitFor(() => expect(button.getAttribute('aria-disabled')).toBe('false'))

    fireEvent.click(button)
    await waitFor(() => expect(gateway.stageApproval).toHaveBeenCalledTimes(1))
    const request = gateway.stageApproval.mock.calls[0]![0] as StageApprovalRequest
    expect(request.mode).toBe('compact')
    expect(request.selection).toEqual({ provider: 'p', model: 'm1', reasoningEffort: 'high' })
    expect(await screen.findByText(/quickStaged/)).toBeTruthy()
  })

  it('stages the keep preset without inventing a reasoning effort', async () => {
    let staged: StageApprovalRequest | undefined
    const gateway = {
      stageApproval: vi.fn(async (request: StageApprovalRequest) => {
        staged = request
        return { ok: true as const, value: { operationId: 'op-1', phase: 'staged' as const } }
      }),
      getOperation: vi.fn(async () => ({
        ok: true as const,
        value: staged === undefined ? null : {
          operationId: 'op-1',
          phase: 'staged' as const,
          mode: staged.mode,
          ...(staged.selection === undefined ? {} : { selection: staged.selection }),
          updatedAt: Date.now(),
        },
      })),
    }
    await mount({ gateway, presets: presetView() })
    const button = screen.getByRole('button', { name: /quickKeep:/ })
    await waitFor(() => expect(button.getAttribute('aria-disabled')).toBe('false'))

    fireEvent.click(button)
    await waitFor(() => expect(gateway.stageApproval).toHaveBeenCalledTimes(1))
    const request = gateway.stageApproval.mock.calls[0]![0] as StageApprovalRequest
    expect(request.mode).toBe('keep')
    expect(request.selection).toEqual({ provider: 'p', model: 'm2' })
  })

  it('explains an unconfigured shortcut instead of staging a guessed model', async () => {
    const gateway = {
      stageApproval: vi.fn(async () => ({ ok: true as const, value: { operationId: 'op-1', phase: 'staged' as const } })),
      getOperation: vi.fn(async () => ({ ok: true as const, value: null })),
    }
    await mount({ gateway, presets: presetView({ presets: { compact: null, switch: null } }) })
    const button = screen.getByRole('button', { name: /quickCompact:/ })
    expect(button.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(button)
    expect(gateway.stageApproval).not.toHaveBeenCalled()
    expect(screen.getByText(/quickPresetMissing/)).toBeTruthy()
  })

  it('disables a preset whose model is no longer in the catalog', async () => {
    const gateway = {
      stageApproval: vi.fn(async () => ({ ok: true as const, value: { operationId: 'op-1', phase: 'staged' as const } })),
      getOperation: vi.fn(async () => ({ ok: true as const, value: null })),
    }
    await mount({
      gateway,
      presets: presetView({ presets: { compact: { provider: 'p', model: 'gone' }, switch: null } }),
    })
    await openPanel()
    await waitFor(() => expect(screen.getByRole('option', { name: 'Model One' })).toBeTruthy())
    fireEvent.keyDown(document, { key: 'Escape' })

    const button = screen.getByRole('button', { name: /quickCompact:/ })
    expect(button.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(button)
    expect(gateway.stageApproval).not.toHaveBeenCalled()
    expect(screen.getByText(/quickPresetInvalid/)).toBeTruthy()
  })

  it('wires the optional settings page without blocking the panel', async () => {
    const result = await mount({ optionalServices: true })
    expect(result.registered.has('conversation.plan-review.actions')).toBe(true)
    expect(result.registered.has('settings.section')).toBe(true)
    expect(result.configForms.get).toHaveBeenCalledWith('plan-execute')
    expect(result.configForms.whileServed).toHaveBeenCalledWith(['plan-execute'], expect.any(Function))
  })
})
