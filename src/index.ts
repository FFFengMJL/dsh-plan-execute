import { createHash, randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { TypertRegistry } from '@deepseek-ai/dsh-typert-registry'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CompactionEngine } from '@deepseek-ai/dsh-compaction'
import type { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { TokenMeasurement } from '@deepseek-ai/dsh-token-meter'
import type { AskUserQuestionAnswer, AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import Schema from '@deepseek-ai/schemastery'
import type {
  ExecutionMode,
  ModelChoice,
  OperationPhase,
  OperationState,
  OperationStateRequest,
  StageApprovalRequest,
  StageApprovalResult,
} from './protocol.js'
import { SERVICE_KEY } from './protocol.js'
import { compactableRangeBeforePendingBatch } from './range.js'
import { operationStateRequestSchema, stageRequestSchema, TYPERT } from './typert.js'

import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-token-meter'
import type {} from '@deepseek-ai/dsh-user-questions'

export const name = 'plan-execute'
export const inject = ['typert', 'tokenMeter', 'sessionController']

export interface PlanExecuteConfig {
  readonly minShadowedTokens: number
}

export const Config: Schema<PlanExecuteConfig> = Schema.object({
  minShadowedTokens: Schema.natural().min(1).default(2000),
})

interface ActiveReview {
  readonly key: string
  readonly sessionId: SessionId
  readonly callId: string
  readonly questionId: string
  readonly planHash: string
  readonly plan: string
  readonly approveLabel: string
  readonly agent: Agent
  readonly signal?: AbortSignal
}

interface StagedOperation {
  readonly requestId: string
  readonly payloadKey: string
  readonly id: string
  review?: ActiveReview
  readonly planHash: string
  readonly mode: ExecutionMode
  readonly selection?: ModelChoice
  phase: OperationPhase
  errorCode?: string
  updatedAt: number
}

const TERMINAL_PHASES = new Set<OperationPhase>(['released', 'failed', 'cancelled'])

function reviewKey(sessionId: string, callId: string, questionId: string): string {
  return JSON.stringify([sessionId, callId, questionId])
}

function hashPlan(plan: string): string {
  return createHash('sha256').update(plan, 'utf8').digest('hex')
}

function isPlanReview(request: AskUserQuestionRequest): ActiveReview | undefined {
  const agent = request.agent
  if (agent === undefined || request.questions.length !== 1) return undefined
  const question = request.questions[0]
  if (question === undefined || question.detail === undefined || question.multiSelect === true) return undefined
  const intent = question.intent
  if (intent?.kind !== 'plan-review' || intent.callId === undefined) return undefined
  if (!(question.options ?? []).some(option => option.label === intent.approve)) return undefined

  const sessionId = agent.session.header.id
  const callId = String(intent.callId)
  return {
    key: reviewKey(String(sessionId), callId, question.id),
    sessionId,
    callId,
    questionId: question.id,
    planHash: hashPlan(question.detail),
    plan: question.detail,
    approveLabel: intent.approve,
    agent,
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  }
}

function approved(answer: AskUserQuestionAnswer, review: ActiveReview): boolean {
  if (answer.answers.length !== 1) return false
  const [item] = answer.answers
  return item !== undefined
    && item.id === review.questionId
    && item.selected.length === 1
    && item.selected[0] === review.approveLabel
    && item.custom === undefined
}

function resolveCompaction(ctx: Context, agent: Agent): CompactionEngine | undefined {
  return ctx.agentPresets?.serviceFor(agent, 'compaction')
    ?? agent.ctx.get('compaction')
    ?? ctx.get('compaction')
}

function priceRange(session: Agent['session'], measurement: TokenMeasurement, range: { start: SessionSeq; end: SessionSeq }): number {
  const surface = session.surface.nodes
  const startIndex = surface.indexOf(range.start)
  const endIndex = surface.indexOf(range.end)
  if (startIndex < 0 || endIndex < startIndex) throw new Error('SURFACE_CHANGED')
  const priced = measurement.nodes.slice(startIndex, endIndex + 1)
  if (priced.length !== endIndex - startIndex + 1) throw new Error('METER_MISMATCH')
  for (let offset = 0; offset < priced.length; offset += 1) {
    if (priced[offset]?.seq !== surface[startIndex + offset]) throw new Error('METER_MISMATCH')
  }
  return priced.reduce((sum, node) => sum + node.tokens, 0)
}

export class PlanExecuteGateway extends TypertRemoteService {
  private readonly host: Context
  private readonly minShadowedTokens: number
  private readonly activeReviews = new Map<string, ActiveReview>()
  private readonly operations = new Map<string, StagedOperation>()
  private readonly requestIds = new Map<string, { readonly payloadKey: string; readonly operation: StagedOperation }>()
  private readonly lifetime = new AbortController()
  private disposed = false

  constructor(ctx: Context, config: PlanExecuteConfig) {
    super(ctx, SERVICE_KEY)
    this.host = ctx
    this.minShadowedTokens = config.minShadowedTokens

    ctx.effect(() => ctx.on('user-questions/request', (request, next) => this.answerWithPreparation(request, next), { prepend: true }), `${name}: plan approval gate`)
    ctx.effect(() => (ctx.typert as unknown as TypertRegistry).register(TYPERT), `${name}: remote manifest`)
    ctx.effect(() => () => {
      this.disposed = true
      this.lifetime.abort(new Error('PLUGIN_DISPOSED'))
      this.activeReviews.clear()
      this.operations.clear()
      this.requestIds.clear()
    }, `${name}: operation cleanup`)
  }

  async stageApproval(request: StageApprovalRequest, signal?: AbortSignal): Promise<StageApprovalResult> {
    signal?.throwIfAborted()
    this.lifetime.signal.throwIfAborted()
    const parsed = stageRequestSchema.parse(request)
    const review = this.activeReviews.get(reviewKey(parsed.sessionId, parsed.callId, parsed.questionId))
    if (review === undefined || review.planHash !== parsed.planHash) throw new Error('REVIEW_NOT_ACTIVE')
    review.signal?.throwIfAborted()

    const payloadKey = JSON.stringify({
      sessionId: parsed.sessionId,
      callId: parsed.callId,
      questionId: parsed.questionId,
      planHash: parsed.planHash,
      mode: parsed.mode,
      selection: parsed.selection,
    })
    const priorRequest = this.requestIds.get(parsed.requestId)
    if (priorRequest !== undefined) {
      if (priorRequest.payloadKey !== payloadKey) throw new Error('REQUEST_ID_REUSED')
      return this.toStageResult(priorRequest.operation)
    }

    const current = this.operations.get(review.key)
    if (current !== undefined && !TERMINAL_PHASES.has(current.phase) && current.phase !== 'staged') {
      throw new Error('OPERATION_IN_PROGRESS')
    }

    if (current?.phase === 'staged') this.requestIds.delete(current.requestId)
    this.trimOperations()
    if (current === undefined && this.operations.size >= 64) throw new Error('OPERATION_CAPACITY')
    const operation: StagedOperation = {
      requestId: parsed.requestId,
      payloadKey,
      id: randomUUID(),
      review,
      planHash: review.planHash,
      mode: parsed.mode,
      ...(parsed.selection === undefined ? {} : { selection: parsed.selection }),
      phase: 'staged',
      updatedAt: Date.now(),
    }
    this.operations.set(review.key, operation)
    this.requestIds.set(parsed.requestId, { payloadKey, operation })
    this.trimOperations()
    return this.toStageResult(operation)
  }

  getOperation(request: OperationStateRequest): OperationState | null {
    const parsed = operationStateRequestSchema.parse(request)
    const operation = this.operations.get(reviewKey(parsed.sessionId, parsed.callId, parsed.questionId))
    if (operation === undefined || operation.planHash !== parsed.planHash) return null
    return this.toOperationState(operation)
  }

  private async answerWithPreparation(
    request: AskUserQuestionRequest,
    next: () => Promise<AskUserQuestionAnswer>,
  ): Promise<AskUserQuestionAnswer> {
    const review = isPlanReview(request)
    if (review === undefined || this.disposed) return next()

    this.activeReviews.set(review.key, review)
    let answer: AskUserQuestionAnswer
    try {
      answer = await next()
    } catch (error) {
      const operation = this.operations.get(review.key)
      if (operation !== undefined && operation.phase === 'staged') {
        this.finish(operation, 'cancelled', 'ANSWER_CANCELLED')
        this.requestIds.delete(operation.requestId)
      }
      this.activeReviews.delete(review.key)
      throw error
    }

    if (!approved(answer, review)) {
      const operation = this.operations.get(review.key)
      if (operation !== undefined && operation.phase === 'staged') {
        this.finish(operation, 'cancelled', 'REVIEW_DECLINED')
        this.requestIds.delete(operation.requestId)
      }
      this.activeReviews.delete(review.key)
      return answer
    }

    const operation = this.operations.get(review.key)
    if (operation === undefined || operation.phase !== 'staged') {
      this.activeReviews.delete(review.key)
      return answer
    }
    if (operation.planHash !== review.planHash || operation.review?.callId !== review.callId) {
      this.finish(operation, 'failed', 'REVIEW_MISMATCH')
      this.activeReviews.delete(review.key)
      this.requestIds.delete(operation.requestId)
      throw new Error('REVIEW_MISMATCH')
    }

    try {
      await this.prepareApprovedPlan(operation)
      return answer
    } catch (error) {
      const wasCancelled = review.signal?.aborted === true || this.lifetime.signal.aborted
      this.finish(operation, wasCancelled ? 'cancelled' : 'failed', this.safeErrorCode(error))
      throw error
    } finally {
      this.activeReviews.delete(review.key)
      this.requestIds.delete(operation.requestId)
    }
  }

  private async prepareApprovedPlan(operation: StagedOperation): Promise<void> {
    const review = operation.review
    if (review === undefined) throw new Error('REVIEW_NOT_ACTIVE')
    const signal = review.signal === undefined
      ? this.lifetime.signal
      : AbortSignal.any([review.signal, this.lifetime.signal])
    signal.throwIfAborted()
    this.setPhase(operation, 'validating')

    if (operation.mode === 'compact') {
      const compaction = resolveCompaction(this.host, review.agent)
      if (compaction === undefined) throw new Error('COMPACTION_UNAVAILABLE')
      const range = compactableRangeBeforePendingBatch(review.agent.session)
      if (range === null) throw new Error('NOTHING_TO_COMPACT')
      const measurement = this.host.tokenMeter.measure(review.agent.session)
      const shadowedTokens = priceRange(review.agent.session, measurement, range)
      if (shadowedTokens < this.minShadowedTokens) throw new Error('NOTHING_TO_COMPACT')

      const beforeSurface = [...review.agent.session.surface.nodes]
      const startIndex = beforeSurface.indexOf(range.start)
      const endIndex = beforeSurface.indexOf(range.end)
      if (startIndex < 0 || endIndex < startIndex) throw new Error('SURFACE_CHANGED')
      const expectedShadowed = new Set(beforeSurface.slice(startIndex, endIndex + 1))
      const protectedTail = beforeSurface.slice(endIndex + 1)
      if (protectedTail.length === 0) throw new Error('PENDING_BATCH_MISSING')

      this.setPhase(operation, 'compacting')
      signal.throwIfAborted()
      const result = await compaction.compactRegion(range.start, range.end, review.agent, signal)
      signal.throwIfAborted()
      const actualShadowed = new Set(result.shadowedSeqs)
      if (actualShadowed.size !== expectedShadowed.size || [...expectedShadowed].some(seq => !actualShadowed.has(seq))) {
        throw new Error('COMPACTION_RANGE_CHANGED')
      }
      const afterSurface = new Set(review.agent.session.surface.nodes)
      if (protectedTail.some(seq => !afterSurface.has(seq))) throw new Error('PENDING_BATCH_MISSING')
      if (this.activeReviews.get(review.key) !== review) throw new Error('REVIEW_CHANGED')
    }

    if (operation.selection !== undefined) {
      this.setPhase(operation, 'selecting-model')
      signal.throwIfAborted()
      try {
        await this.host.sessionController.selectModel({
          sessionId: review.sessionId,
          provider: operation.selection.provider,
          model: operation.selection.model,
          ...(operation.selection.reasoningEffort === undefined ? {} : { reasoningEffort: operation.selection.reasoningEffort }),
        })
      } catch {
        throw new Error('MODEL_SELECTION_FAILED')
      }
      signal.throwIfAborted()
    }

    signal.throwIfAborted()
    this.setPhase(operation, 'released')
  }

  private setPhase(operation: StagedOperation, phase: OperationPhase): void {
    operation.phase = phase
    operation.updatedAt = Date.now()
    operation.errorCode = undefined
    if (phase === 'released') operation.review = undefined
  }

  private finish(operation: StagedOperation, phase: 'failed' | 'cancelled', errorCode: string): void {
    operation.phase = phase
    operation.errorCode = errorCode
    operation.updatedAt = Date.now()
    operation.review = undefined
  }

  private safeErrorCode(error: unknown): string {
    const message = error instanceof Error ? error.message : ''
    const known = new Set([
      'COMPACTION_UNAVAILABLE', 'NOTHING_TO_COMPACT', 'SURFACE_CHANGED', 'METER_MISMATCH',
      'MODEL_SELECTION_FAILED', 'REVIEW_NOT_ACTIVE', 'COMPACTION_RANGE_CHANGED', 'PENDING_BATCH_MISSING', 'REVIEW_CHANGED',
    ])
    if (known.has(message)) return message
    return 'PREPARATION_FAILED'
  }

  private toStageResult(operation: StagedOperation): StageApprovalResult {
    return { operationId: operation.id, phase: operation.phase }
  }

  private toOperationState(operation: StagedOperation): OperationState {
    return {
      operationId: operation.id,
      phase: operation.phase,
      mode: operation.mode,
      ...(operation.selection === undefined ? {} : { selection: operation.selection }),
      ...(operation.errorCode === undefined ? {} : { errorCode: operation.errorCode }),
      updatedAt: operation.updatedAt,
    }
  }

  private trimOperations(): void {
    const excess = Math.max(0, this.operations.size - 63)
    if (excess <= 0) return
    let removed = 0
    for (const [key, operation] of this.operations) {
      if (removed >= excess) break
      if (TERMINAL_PHASES.has(operation.phase)) {
        this.operations.delete(key)
        this.requestIds.delete(operation.requestId)
        removed += 1
      }
    }
  }
}

export function apply(ctx: Context, config: PlanExecuteConfig): void {
  new PlanExecuteGateway(ctx, config)
}
