import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { Session } from '@deepseek-ai/dsh-session'
import type { AskUserQuestionAnswer, AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import { PlanExecuteGateway } from '../src/index.js'
import type { StageApprovalRequest } from '../src/protocol.js'

const PLAN = '# Scenario plan\n\n- Compact before executing.'
const SESSION_ID = 'scenario-session'
const CALL_ID = 'scenario-call'
const QUESTION_ID = 'plan-review'
const APPROVE = 'Approve'
const DECLINE = 'Keep planning'
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')

let seed = 0
function message(role: string, content: unknown[], source: unknown, extra: Record<string, unknown> = {}) {
  seed += 1
  return { id: `scenario-m${seed}`, role, content, source, ...extra }
}

function append(session: Session, type: string, data: unknown, intent?: Record<string, unknown>): number {
  const event = (session.append as unknown as (type: string, data: unknown, intent?: unknown) => { seq: number })(
    type,
    data,
    intent ?? { surfaceOp: 'append' },
  )
  return event.seq
}

function sessionWithPendingPlan(): Session {
  const session = Session.create(SESSION_ID)
  append(session, 'system/message', {
    turn: 1, step: 1, message: message('system', [{ type: 'text', text: 'system' }], { kind: 'system-prompt' }),
  })
  append(session, 'user/message', {
    turn: 1, step: 1, message: message('user', [{ type: 'text', text: 'please plan' }], { kind: 'user' }),
  })
  append(session, 'assistant/message', {
    turn: 1,
    step: 1,
    message: message('assistant', [{ type: 'tool-call', id: 'read-1', name: 'read', arguments: '{}' }], {
      kind: 'model', provider: 'p', model: 'm',
    }),
  })
  append(session, 'tool/result', {
    turn: 1, step: 1, message: message('tool', [{ type: 'text', text: 'ok' }], { kind: 'tool', callId: 'read-1' }, { toolCallId: 'read-1' }),
  })
  append(session, 'assistant/message', {
    turn: 1,
    step: 1,
    message: message('assistant', [{ type: 'tool-call', id: CALL_ID, name: 'exit_plan_mode', arguments: '{}' }], {
      kind: 'model', provider: 'p', model: 'm',
    }),
  })
  return session
}

function requestFor(session: Session): AskUserQuestionRequest {
  return {
    agent: { session, ctx: { get: () => undefined } },
    questions: [{
      id: QUESTION_ID,
      question: 'Approve this plan?',
      detail: PLAN,
      options: [{ label: APPROVE }, { label: DECLINE }],
      intent: { kind: 'plan-review', approve: APPROVE, callId: CALL_ID },
    }],
  } as unknown as AskUserQuestionRequest
}

function answer(selected: string): AskUserQuestionAnswer {
  return { answers: [{ id: QUESTION_ID, selected: [selected] }] }
}

function harness(session: Session) {
  const selectModel = vi.fn(async () => {})
  const compactRegion = vi.fn(async (start: number, end: number) => {
    const shadowed = session.surface.nodes.filter(seq => seq >= start && seq <= end)
    const replacement = append(session, 'user/message', {
      turn: 2,
      step: 1,
      message: message('user', [{ type: 'text', text: 'summary' }], { kind: 'user' }),
    }, {
      surfaceOp: { op: 'replace', startSeq: start, endSeq: end },
      sourceEventSeqs: shadowed,
    })
    return { shadowedSeqs: shadowed, replacementSeq: replacement }
  })
  const effects: Array<() => void> = []
  const listeners = new Map<string, (request: AskUserQuestionRequest, next: () => Promise<AskUserQuestionAnswer>) => Promise<AskUserQuestionAnswer>>()
  const ctx = {
    reflect: { provide: () => {} },
    effect: (factory: () => unknown) => {
      const dispose = factory()
      if (typeof dispose === 'function') effects.push(dispose as () => void)
      return dispose
    },
    on: (event: string, listener: never, _options: unknown) => {
      listeners.set(event, listener)
      return () => {}
    },
    get: (key: string) => key === 'compaction' ? { compactRegion } : undefined,
    typert: { register: () => {} },
    tokenMeter: {
      measure: () => ({
        nodes: session.surface.nodes.map(seq => ({ seq, tokens: 100, heuristicTokens: 100 })),
      }),
    },
    sessionController: { selectModel },
    agentPresets: { serviceFor: () => ({ compactRegion }) },
  }
  const gateway = new PlanExecuteGateway(ctx as unknown as Context, { minShadowedTokens: 50 })
  const run = async (next: () => Promise<AskUserQuestionAnswer>) => {
    const listener = listeners.get('user-questions/request')
    if (listener === undefined) throw new Error('gateway listener missing')
    return listener(requestFor(session), next)
  }
  return { gateway, run, selectModel, compactRegion, session }
}

describe('approval scenario over a real Session', () => {
  it('compacts the balanced prefix, selects the requested model and effort, then releases', async () => {
    const session = sessionWithPendingPlan()
    const h = harness(session)
    const before = [...session.surface.nodes]
    expect(before).toHaveLength(5)

    const result = await h.run(async () => {
      const request: StageApprovalRequest = {
        sessionId: SESSION_ID,
        callId: CALL_ID,
        questionId: QUESTION_ID,
        planHash: hash(PLAN),
        mode: 'compact',
        selection: { provider: 'p', model: 'm', reasoningEffort: 'high' },
        requestId: 'scenario-request',
      }
      await h.gateway.stageApproval(request)
      return answer(APPROVE)
    })

    expect(result).toEqual(answer(APPROVE))
    expect(h.compactRegion).toHaveBeenCalledTimes(1)
    expect(h.compactRegion.mock.calls[0]!.slice(0, 2)).toEqual([1, 3])
    expect(h.selectModel).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      provider: 'p',
      model: 'm',
      reasoningEffort: 'high',
    })
    // A replacement inserts the summary at the compacted span's position, so
    // the surviving surface is intentionally non-monotonic: [0, summary, pending].
    expect(session.surface.nodes).toHaveLength(3)
    expect(session.surface.nodes[0]).toBe(0)
    expect(session.surface.nodes[1]).toBeGreaterThan(before[4]!)
    expect(session.surface.nodes[2]).toBe(before[4])
    expect(h.gateway.getOperation({
      sessionId: SESSION_ID, callId: CALL_ID, questionId: QUESTION_ID, planHash: hash(PLAN),
    })?.phase).toBe('released')
  })

  it('performs no compaction or model change when the native review is declined', async () => {
    const session = sessionWithPendingPlan()
    const h = harness(session)
    const before = [...session.surface.nodes]

    const result = await h.run(async () => {
      await h.gateway.stageApproval({
        sessionId: SESSION_ID,
        callId: CALL_ID,
        questionId: QUESTION_ID,
        planHash: hash(PLAN),
        mode: 'compact',
        selection: { provider: 'p', model: 'm' },
        requestId: 'scenario-decline',
      })
      return answer(DECLINE)
    })

    expect(result).toEqual(answer(DECLINE))
    expect(h.compactRegion).not.toHaveBeenCalled()
    expect(h.selectModel).not.toHaveBeenCalled()
    expect(session.surface.nodes).toEqual(before)
    expect(h.gateway.getOperation({
      sessionId: SESSION_ID, callId: CALL_ID, questionId: QUESTION_ID, planHash: hash(PLAN),
    })?.phase).toBe('cancelled')
  })
})
