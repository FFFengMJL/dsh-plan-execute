import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import { PlanExecuteGateway } from '../src/index.js'
import { TYPERT } from '../src/typert.js'

const PLAN = '# Plan\n\n- Do the work.'

interface Harness {
  readonly ctx: Context
  readonly gateway: PlanExecuteGateway
  readonly listeners: Map<string, { listener: (...args: never[]) => unknown; options: unknown }[]>
  readonly effects: Array<() => void>
  readonly typert: unknown[]
  emit(event: string, ...args: unknown[]): unknown
  disposeAll(): void
}

function harness(): Harness {
  const listeners = new Map<string, { listener: (...args: never[]) => unknown; options: unknown }[]>()
  const effects: Array<() => void> = []
  const typert: unknown[] = []
  const compactRegion = vi.fn(async () => ({ shadowedSeqs: [] }))
  const ctx = {
    reflect: { provide: () => {} },
    effect: (factory: () => unknown) => {
      const dispose = factory()
      if (typeof dispose === 'function') effects.push(dispose as () => void)
      return dispose
    },
    on: (event: string, listener: (...args: never[]) => unknown, options: unknown) => {
      const entries = listeners.get(event) ?? []
      entries.unshift({ listener, options })
      listeners.set(event, entries)
      return () => {}
    },
    get: (key: string) => key === 'compaction' ? { compactRegion } : undefined,
    typert: { register: (contribution: unknown) => { typert.push(contribution) } },
    tokenMeter: { measure: () => ({ nodes: [] }) },
    sessionController: { selectModel: vi.fn() },
    agentPresets: { serviceFor: () => ({ compactRegion }) },
    logger: { warn: () => {} },
  }
  const gateway = new PlanExecuteGateway(ctx as unknown as Context, { minShadowedTokens: 50 })
  return {
    ctx: ctx as unknown as Context,
    gateway,
    listeners,
    effects,
    typert,
    emit(event, ...args) {
      const entry = listeners.get(event)?.[0]
      if (entry === undefined) throw new Error(`no listener for ${event}`)
      return entry.listener(...(args as never[]))
    },
    disposeAll() {
      for (const dispose of effects.splice(0)) dispose()
    },
  }
}

function planRequest(): AskUserQuestionRequest {
  const agent = {
    session: { header: { id: 'session-1' }, surface: { nodes: [1, 2] } },
    ctx: { get: () => ({ compactRegion: async () => ({ shadowedSeqs: [] }) }) },
  }
  return {
    agent,
    questions: [{
      id: 'plan-review',
      question: 'Approve this plan?',
      detail: PLAN,
      options: [{ label: 'Approve' }, { label: 'Keep planning' }],
      intent: { kind: 'plan-review', approve: 'Approve', callId: 'call-1' },
    }],
  } as unknown as AskUserQuestionRequest
}

describe('gateway lifecycle through the real constructor', () => {
  it('prepends the plan-review waterfall and registers the Typert manifest', () => {
    const h = harness()
    const entries = h.listeners.get('user-questions/request')
    expect(entries).toHaveLength(1)
    expect(entries?.[0]?.options).toEqual({ prepend: true })
    expect(h.typert).toEqual([TYPERT])
  })

  it('forwards non-plan questions untouched', async () => {
    const h = harness()
    const request = {
      questions: [{ id: 'q', question: 'Pick one', options: [{ label: 'A' }] }],
    } as unknown as AskUserQuestionRequest
    const next = vi.fn(async () => ({ answers: [] }))
    await expect(h.emit('user-questions/request', request, next)).resolves.toEqual({ answers: [] })
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('waits for the native answerer before returning the approval answer', async () => {
    const h = harness()
    let settle: ((value: unknown) => void) | undefined
    const next = vi.fn(() => new Promise(resolve => { settle = resolve }))
    const pending = h.emit('user-questions/request', planRequest(), next) as Promise<unknown>
    let resolved = false
    void pending.then(() => { resolved = true })
    await Promise.resolve()
    expect(resolved).toBe(false)
    settle?.({ answers: [{ id: 'plan-review', selected: ['Keep planning'] }] })
    await expect(pending).resolves.toEqual({ answers: [{ id: 'plan-review', selected: ['Keep planning'] }] })
  })

  it('fails closed after disposal and clears the lifetime', async () => {
    const h = harness()
    h.disposeAll()
    await expect(h.gateway.stageApproval({
      sessionId: 'session-1',
      callId: 'call-1',
      questionId: 'plan-review',
      planHash: '0'.repeat(64),
      mode: 'keep',
      requestId: 'request-1',
    })).rejects.toThrow('PLUGIN_DISPOSED')
  })
})
