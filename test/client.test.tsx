// @vitest-environment jsdom
import type { ComponentType } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelCatalog } from '@deepseek-ai/dsh-api-remotes/client'
import { apply } from '../src/client/index.js'
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

  const ctx = {
    effect: (factory: () => unknown) => {
      const dispose = factory()
      if (typeof dispose === 'function') disposers.push(dispose as () => void)
      return dispose
    },
    locale: { register: () => () => {} },
    remote: {
      $mount: async () => () => {},
      session: { modelCatalog },
    },
    get: (key: string) => key === 'remote.planExecute' ? gateway : undefined,
    slots: {
      inject: (_name: string, factory: () => unknown) => factory(),
      register: (definition: { inject: () => Record<string, unknown> }, component: ComponentType<Record<string, unknown>>) => {
        Captured = component
        injectFace = definition.inject()
        return () => {}
      },
    },
  }

  await apply(ctx as never)
  if (Captured === undefined) throw new Error('slot component was not registered')

  const props = {
    review,
    requestKey: 'request-key-1',
    sessionId: SESSION_ID as never,
    t,
    useProjection: () => options.projection,
  }
  const view = render(<Captured {...props} {...injectFace} />)
  expect(document.body.contains(view.container)).toBe(true)
  return { gateway, modelCatalog, view, disposers }
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
})
