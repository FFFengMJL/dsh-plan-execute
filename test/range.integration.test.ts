import { describe, expect, it } from 'vitest'
import { Session } from '@deepseek-ai/dsh-session'
import { toolPairingBalancedAfter, toolPairingBalancedBefore } from '@deepseek-ai/dsh-compaction'
import { compactableRangeBeforePendingBatch } from '../src/range.js'

/*
 * These cases exercise the real RC5 Session log and the real Compaction
 * tool-pairing helpers. They intentionally avoid message constructors from
 * `@deepseek-ai/dsh-llm`: the persisted message shape is the contract the
 * helpers read, and `Session.append` validates it at the boundary.
 */

let messageSeed = 0
function message(role: string, content: unknown[], source: unknown, extra: Record<string, unknown> = {}) {
  messageSeed += 1
  return { id: `m${messageSeed}`, role, content, source, ...extra }
}

function append(session: Session, type: string, data: unknown): void {
  ;(session.append as unknown as (type: string, data: unknown, intent: { surfaceOp: 'append' }) => unknown)(
    type,
    data,
    { surfaceOp: 'append' },
  )
}

function appendToolCall(session: Session, id: string): void {
  append(session, 'assistant/message', {
    turn: 1,
    step: 1,
    message: message('assistant', [{ type: 'tool-call', id, name: 'exit_plan_mode', arguments: '{}' }], {
      kind: 'model',
      provider: 'p',
      model: 'm',
    }),
  })
}

function appendToolResult(session: Session, id: string): void {
  append(session, 'tool/result', {
    turn: 1,
    step: 1,
    message: message('tool', [{ type: 'text', text: 'ok' }], { kind: 'tool', callId: id }, { toolCallId: id }),
  })
}

function baseSession(): Session {
  const session = Session.create('session-range')
  append(session, 'system/message', {
    turn: 1,
    step: 1,
    message: message('system', [], { kind: 'system-prompt' }),
  })
  append(session, 'user/message', {
    turn: 1,
    step: 1,
    message: message('user', [{ type: 'text', text: 'hello' }], { kind: 'user' }),
  })
  return session
}

describe('compactable range over a real Session', () => {
  it('stops before the pending approval batch and keeps every completed pair', () => {
    const session = baseSession()
    appendToolCall(session, 'call-1')
    appendToolResult(session, 'call-1')
    appendToolCall(session, 'call-2')

    const range = compactableRangeBeforePendingBatch(session)
    expect(range).not.toBeNull()
    expect(session.surface.nodes.slice(0, session.surface.nodes.indexOf(range!.end) + 1)).toEqual([0, 1, 2, 3])
    expect(range).toEqual({ start: 1, end: 3 })

    expect(toolPairingBalancedBefore(session, range!.start)).toBe(true)
    expect(toolPairingBalancedAfter(session, range!.end)).toBe(true)
    expect(toolPairingBalancedAfter(session, session.surface.nodes.at(-1)!)).toBe(false)
  })

  it('keeps a parallel batch together', () => {
    const session = baseSession()
    append(session, 'assistant/message', {
      turn: 1,
      step: 1,
      message: message('assistant', [
        { type: 'tool-call', id: 'a', name: 'read', arguments: '{}' },
        { type: 'tool-call', id: 'b', name: 'read', arguments: '{}' },
      ], { kind: 'model', provider: 'p', model: 'm' }),
    })
    appendToolResult(session, 'a')
    appendToolResult(session, 'b')
    appendToolCall(session, 'pending')

    const range = compactableRangeBeforePendingBatch(session)
    expect(range).not.toBeNull()
    expect(range!.end).toBe(4)
    expect(toolPairingBalancedAfter(session, range!.end)).toBe(true)
  })

  it('returns null when only the system message precedes the pending batch', () => {
    const session = Session.create('session-empty')
    append(session, 'system/message', {
      turn: 1,
      step: 1,
      message: message('system', [], { kind: 'system-prompt' }),
    })
    appendToolCall(session, 'pending')
    expect(compactableRangeBeforePendingBatch(session)).toBeNull()
  })

  it('rejects a surface whose tail is already balanced', () => {
    const session = baseSession()
    appendToolCall(session, 'call-1')
    appendToolResult(session, 'call-1')
    expect(() => compactableRangeBeforePendingBatch(session)).toThrow('approval-not-pending')
  })
})
