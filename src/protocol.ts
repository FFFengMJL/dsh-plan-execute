export const PACKAGE_NAME = 'dsh-plan-execute'
export const SERVICE_KEY = 'planExecute'
export const STAGE_METHOD = 'stageApproval'
export const STATE_METHOD = 'getOperation'

export const STAGE_ENDPOINT = `${PACKAGE_NAME}#${SERVICE_KEY}/${STAGE_METHOD}`
export const STATE_ENDPOINT = `${PACKAGE_NAME}#${SERVICE_KEY}/${STATE_METHOD}`
export const REQUEST_WIRE = 'request'
export const REQUEST_SYMBOL = `${PACKAGE_NAME}#StageApprovalRequest`
export const STATE_REQUEST_SYMBOL = `${PACKAGE_NAME}#OperationStateRequest`
export const STAGE_RESULT_SYMBOL = `${PACKAGE_NAME}#StageApprovalResult`
export const STATE_RESULT_SYMBOL = `${PACKAGE_NAME}#OperationState`

export type ExecutionMode = 'compact' | 'keep'
export type OperationPhase =
  | 'staged'
  | 'validating'
  | 'compacting'
  | 'selecting-model'
  | 'released'
  | 'failed'
  | 'cancelled'

export interface ModelChoice {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

export interface StageApprovalRequest {
  readonly sessionId: string
  readonly callId: string
  readonly questionId: string
  readonly planHash: string
  readonly mode: ExecutionMode
  readonly selection?: ModelChoice
  readonly requestId: string
}

export interface StageApprovalResult {
  readonly operationId: string
  readonly phase: OperationPhase
}

export interface OperationStateRequest {
  readonly sessionId: string
  readonly callId: string
  readonly questionId: string
  readonly planHash: string
}

export interface OperationState {
  readonly operationId: string
  readonly phase: OperationPhase
  readonly mode: ExecutionMode
  readonly selection?: ModelChoice
  readonly errorCode?: string
  readonly updatedAt: number
}
