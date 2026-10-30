import { beforeEach, describe, expect, it, vi } from 'vitest'

const pairing = vi.hoisted(() => ({
  before: vi.fn<(session: unknown, seq: number) => boolean>(),
  after: vi.fn<(session: unknown, seq: number) => boolean>(),
}))

vi.mock('@deepseek-ai/dsh-compaction', () => ({
  toolPairingBalancedBefore: pairing.before,
  toolPairingBalancedAfter: pairing.after,
}))

import { compactableRangeBeforePendingBatch } from '../src/range.js'

function fakeSession(nodes: number[]) {
  return {
    surface: { nodes },
    eventAt: (seq: number) => seq === 0 ? { type: 'system/message' } : { type: 'user/message' },
  }
}

describe('compactableRangeBeforePendingBatch', () => {
  beforeEach(() => {
    pairing.before.mockReset()
    pairing.after.mockReset()
    pairing.after.mockReturnValue(false)
  })

  it('keeps the unresolved tool batch and compacts only a balanced prefix', () => {
    const session = fakeSession([0, 1, 2, 3, 4])
    pairing.before.mockImplementation((_session, seq) => seq <= 2)

    const range = compactableRangeBeforePendingBatch(session as never)

    expect(range).toEqual({ start: 1, end: 1 })
    expect(range!.end).toBeLessThan(3)
  })

  it('refuses a history that has no compactable prefix', () => {
    const session = fakeSession([0, 1])
    pairing.before.mockReturnValue(false)

    expect(compactableRangeBeforePendingBatch(session as never)).toBeNull()
  })

  it('rejects when the tail is no longer a pending tool batch', () => {
    pairing.after.mockReturnValue(true)
    expect(() => compactableRangeBeforePendingBatch(fakeSession([0, 1]) as never))
      .toThrow('approval-not-pending')
  })
})
