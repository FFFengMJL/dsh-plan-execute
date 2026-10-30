import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { AskUserQuestionAnswer, AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import { PlanExecuteGateway } from '../src/index.js'
import type { StageApprovalRequest } from '../src/protocol.js'

const compactionPlan = vi.hoisted(() => ({ value: null as { start: number; end: number } | null }))
vi.mock('../src/range.js', () => ({
  compactableRangeBeforePendingBatch: () => compactionPlan.value,
}))

const PLAN = '# Approved plan\n\n- Preserve the user-facing plan.'
const SESSION_ID = 'session-123'
const CALL_ID = 'tool-call-456'
const QUESTION_ID = 'plan-review'
const APPROVE = 'Approve plan'
const DECLINE = 'Request changes'
const hash = (value = PLAN) => createHash('sha256').update(value, 'utf8').digest('hex')

function harness() {
  const events: string[] = []
  const compactRegion = vi.fn(async () => { events.push('compact'); return { shadowedSeqs: [1, 2] } })
  const selectModel = vi.fn(async () => { events.push('select-model') })
  const host = {
    agentPresets: { serviceFor: () => ({ compactRegion }) },
    tokenMeter: {
      measure: vi.fn(() => ({
        nodes: [
          { seq: 1, tokens: 100, heuristicTokens: 100 },
          { seq: 2, tokens: 100, heuristicTokens: 100 },
          { seq: 3, tokens: 100, heuristicTokens: 100 },
        ],
      })),
    },
    sessionController: { selectModel },
    get: (key: string) => key === 'compaction' ? { compactRegion } : undefined,
  }
  const gateway = Object.create(PlanExecuteGateway.prototype) as PlanExecuteGateway
  Object.assign(gateway, {
    host,
    minShadowedTokens: 50,
    activeReviews: new Map(),
    operations: new Map(),
    requestIds: new Map(),
    lifetime: new AbortController(),
    disposed: false,
  })
  const agent = {
    session: { header: { id: SESSION_ID }, surface: { nodes: [1, 2, 3] } },
    ctx: { get: () => ({ compactRegion }) },
  } as unknown as Agent
  const request = {
    agent,
    questions: [{
      id: QUESTION_ID,
      question: 'Approve this plan?',
      detail: PLAN,
      options: [{ label: APPROVE }, { label: DECLINE }],
      intent: { kind: 'plan-review', approve: APPROVE, callId: CALL_ID },
    }],
  } as unknown as AskUserQuestionRequest
  const answer = (selected: string): AskUserQuestionAnswer => ({ answers: [{ id: QUESTION_ID, selected: [selected] }] })
  const stage = (options: Partial<StageApprovalRequest> = {}): StageApprovalRequest => ({
    sessionId: SESSION_ID,
    callId: CALL_ID,
    questionId: QUESTION_ID,
    planHash: hash(),
    mode: 'keep',
    requestId: 'request-1',
    ...options,
  })
  const gate = (next: () => Promise<AskUserQuestionAnswer>, target = request) =>
    (gateway as unknown as { answerWithPreparation: (request: AskUserQuestionRequest, next: typeof next) => Promise<AskUserQuestionAnswer> })
      .answerWithPreparation(target, next)
  return { gateway, host, events, compactRegion, selectModel, agent, request, answer, stage, gate }
}

beforeEach(() => {
  compactionPlan.value = null
})

describe('plan approval gate', () => {
  it('executes no staged work unless the exact native approval answer is returned', async () => {
    const h = harness()
    await expect(h.gate(async () => {
      await h.gateway.stageApproval(h.stage({ mode: 'compact' }))
      return h.answer(DECLINE)
    })).resolves.toEqual(h.answer(DECLINE))

    const state = (h.gateway as unknown as { operations: Map<string, { phase: string; errorCode?: string }> }).operations.get(JSON.stringify([SESSION_ID, CALL_ID, QUESTION_ID]))
    expect(state?.phase).toBe('cancelled')
    expect(h.compactRegion).not.toHaveBeenCalled()
    expect(h.selectModel).not.toHaveBeenCalled()
  })

  it('rejects multi-select, duplicate answers, and extra selected labels before any side effect', async () => {
    const h = harness()
    const malformed: AskUserQuestionAnswer = { answers: [{ id: QUESTION_ID, selected: [APPROVE, DECLINE] }] }
    await expect(h.gate(async () => {
      await h.gateway.stageApproval(h.stage({ mode: 'compact' }))
      return malformed
    })).resolves.toEqual(malformed)
    expect(h.compactRegion).not.toHaveBeenCalled()
    const state = (h.gateway as unknown as { operations: Map<string, { phase: string }> }).operations.get(JSON.stringify([SESSION_ID, CALL_ID, QUESTION_ID]))
    expect(state?.phase).toBe('cancelled')

    const h2 = harness()
    const duplicate: AskUserQuestionAnswer = { answers: [
      { id: QUESTION_ID, selected: [APPROVE] },
      { id: QUESTION_ID, selected: [DECLINE] },
    ] }
    await expect(h2.gate(async () => {
      await h2.gateway.stageApproval(h2.stage({ mode: 'compact' }))
      return duplicate
    })).resolves.toEqual(duplicate)
    expect(h2.compactRegion).not.toHaveBeenCalled()

    const h3 = harness()
    const multi = { ...h3.request, questions: [{ ...h3.request.questions[0], multiSelect: true }] } as AskUserQuestionRequest
    await expect(h3.gate(async () => h3.answer(APPROVE), multi)).resolves.toEqual(h3.answer(APPROVE))
    expect((h3.gateway as unknown as { activeReviews: Map<string, unknown> }).activeReviews.size).toBe(0)
  })

  it('cleans the active review and idempotency entry when the native answerer rejects', async () => {
    const h = harness()
    await expect(h.gate(async () => {
      await h.gateway.stageApproval(h.stage())
      throw new Error('answerer failed')
    })).rejects.toThrow('answerer failed')

    const internal = h.gateway as unknown as { activeReviews: Map<string, unknown>; requestIds: Map<string, unknown>; operations: Map<string, { phase: string }> }
    expect(internal.activeReviews.size).toBe(0)
    expect(internal.requestIds.size).toBe(0)
    expect(internal.operations.get(JSON.stringify([SESSION_ID, CALL_ID, QUESTION_ID]))?.phase).toBe('cancelled')
  })

  it('waits for the native answer before selecting a model and releases only on success', async () => {
    const h = harness()
    const events: string[] = []
    const selected = h.answer(APPROVE)
    const result = await h.gate(async () => {
      await h.gateway.stageApproval(h.stage({ selection: { provider: 'p', model: 'm', reasoningEffort: 'high' } }))
      events.push('native-answer')
      return selected
    })

    expect(result).toEqual(selected)
    expect(events).toEqual(['native-answer'])
    expect(h.selectModel).toHaveBeenCalledWith({ sessionId: SESSION_ID, provider: 'p', model: 'm', reasoningEffort: 'high' })
    expect(h.selectModel).toHaveBeenCalledTimes(1)
  })

  it('rejects stale plan hashes and reused request ids with changed settings', async () => {
    const h = harness()
    await expect(h.gate(async () => {
      await expect(h.gateway.stageApproval(h.stage({ planHash: hash('different plan') }))).rejects.toThrow('REVIEW_NOT_ACTIVE')
      await h.gateway.stageApproval(h.stage())
      await expect(h.gateway.stageApproval(h.stage({ mode: 'compact' }))).rejects.toThrow('REQUEST_ID_REUSED')
      return h.answer(APPROVE)
    })).resolves.toEqual(h.answer(APPROVE))
  })

  it('fails closed when compact mode has no safe prefix instead of approving unchanged', async () => {
    const h = harness()
    compactionPlan.value = null
    await expect(h.gate(async () => {
      await h.gateway.stageApproval(h.stage({ mode: 'compact' }))
      return h.answer(APPROVE)
    })).rejects.toThrow('NOTHING_TO_COMPACT')

    const state = (h.gateway as unknown as { operations: Map<string, { phase: string; errorCode?: string }> }).operations.get(JSON.stringify([SESSION_ID, CALL_ID, QUESTION_ID]))
    expect(state?.phase).toBe('failed')
    expect(state?.errorCode).toBe('NOTHING_TO_COMPACT')
    expect(h.compactRegion).not.toHaveBeenCalled()
  })

  it('compacts first, then selects the model, and never releases after cancellation', async () => {
    const h = harness()
    compactionPlan.value = { start: 1, end: 2 }
    const order: string[] = []
    h.compactRegion.mockImplementation(async () => { order.push('compact'); return { shadowedSeqs: [1, 2] } })
    h.selectModel.mockImplementation(async () => { order.push('select-model') })
    const selected = h.answer(APPROVE)

    await h.gate(async () => {
      await h.gateway.stageApproval(h.stage({ mode: 'compact', selection: { provider: 'p', model: 'm' } }))
      return selected
    })
    expect(order).toEqual(['compact', 'select-model'])
  })

  it('rejects a compaction result that crosses the protected pending tool batch', async () => {
    const h = harness()
    compactionPlan.value = { start: 1, end: 2 }
    h.compactRegion.mockResolvedValue({ shadowedSeqs: [1, 2, 3] })

    await expect(h.gate(async () => {
      await h.gateway.stageApproval(h.stage({ mode: 'compact', selection: { provider: 'p', model: 'm' } }))
      return h.answer(APPROVE)
    })).rejects.toThrow('COMPACTION_RANGE_CHANGED')

    expect(h.selectModel).not.toHaveBeenCalled()
    const state = (h.gateway as unknown as { operations: Map<string, { phase: string; errorCode?: string }> }).operations.get(JSON.stringify([SESSION_ID, CALL_ID, QUESTION_ID]))
    expect(state?.phase).toBe('failed')
    expect(state?.errorCode).toBe('COMPACTION_RANGE_CHANGED')
  })

  it('does not return approval after the request is aborted during compaction', async () => {
    const h = harness()
    compactionPlan.value = { start: 1, end: 2 }
    const controller = new AbortController()
    h.compactRegion.mockImplementation(async () => { controller.abort() })
    const request = { ...h.request, signal: controller.signal } as AskUserQuestionRequest

    const gate = (h.gateway as unknown as { answerWithPreparation: (request: AskUserQuestionRequest, next: () => Promise<AskUserQuestionAnswer>) => Promise<AskUserQuestionAnswer> })
      .answerWithPreparation
    await expect(gate.call(h.gateway, request, async () => {
      await h.gateway.stageApproval(h.stage({ mode: 'compact', selection: { provider: 'p', model: 'm' } }))
      return h.answer(APPROVE)
    })).rejects.toThrow()

    const state = (h.gateway as unknown as { operations: Map<string, { phase: string }> }).operations.get(JSON.stringify([SESSION_ID, CALL_ID, QUESTION_ID]))
    expect(state?.phase).toBe('cancelled')
    expect(h.selectModel).not.toHaveBeenCalled()
  })
})
