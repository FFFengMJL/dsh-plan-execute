import { toolPairingBalancedAfter, toolPairingBalancedBefore } from '@deepseek-ai/dsh-compaction'
import type { Session, SessionSeq } from '@deepseek-ai/dsh-session'

export interface CompactRange {
  readonly start: SessionSeq
  readonly end: SessionSeq
}

/** Return the safe history prefix before the still-open approval tool batch. */
export function compactableRangeBeforePendingBatch(session: Session): CompactRange | null {
  const nodes = session.surface.nodes
  if (nodes.length === 0) return null

  const tail = nodes[nodes.length - 1]!
  if (toolPairingBalancedAfter(session, tail)) {
    throw new Error('approval-not-pending')
  }

  const head = session.eventAt(nodes[0]!)
  const firstIndex = head?.type === 'system/message' ? 1 : 0
  let retainedIndex = nodes.length - 1

  while (retainedIndex > firstIndex && !toolPairingBalancedBefore(session, nodes[retainedIndex]!)) {
    retainedIndex -= 1
  }
  if (retainedIndex <= firstIndex) return null

  return { start: nodes[firstIndex]!, end: nodes[retainedIndex - 1]! }
}
