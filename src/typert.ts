import { z } from 'zod'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry/types'
import {
  PACKAGE_NAME,
  REQUEST_SYMBOL,
  REQUEST_WIRE,
  SERVICE_KEY,
  STATE_REQUEST_SYMBOL,
  STAGE_ENDPOINT,
  STAGE_METHOD,
  STAGE_RESULT_SYMBOL,
  STATE_ENDPOINT,
  STATE_METHOD,
  STATE_RESULT_SYMBOL,
} from './protocol.js'

export const stageRequestSchema = z.object({
  sessionId: z.string().min(1).max(256),
  callId: z.string().min(1).max(256),
  questionId: z.string().min(1).max(128),
  planHash: z.string().regex(/^[0-9a-f]{64}$/),
  mode: z.enum(['compact', 'keep']),
  selection: z.object({
    provider: z.string().min(1).max(256),
    model: z.string().min(1).max(256),
    reasoningEffort: z.string().min(1).max(128).optional(),
  }).strict().optional(),
  requestId: z.string().min(1).max(128),
}).strict()

export const operationStateRequestSchema = z.object({
  sessionId: z.string().min(1).max(256),
  callId: z.string().min(1).max(256),
  questionId: z.string().min(1).max(128),
  planHash: z.string().regex(/^[0-9a-f]{64}$/),
}).strict()

const modelChoiceSchema = z.object({
  provider: z.string(),
  model: z.string(),
  reasoningEffort: z.string().optional(),
}).strict()

export const stageResultSchema = z.object({
  operationId: z.string().min(1),
  phase: z.enum(['staged', 'validating', 'compacting', 'selecting-model', 'released', 'failed', 'cancelled']),
}).strict()

export const operationStateSchema = z.object({
  operationId: z.string().min(1),
  phase: z.enum(['staged', 'validating', 'compacting', 'selecting-model', 'released', 'failed', 'cancelled']),
  mode: z.enum(['compact', 'keep']),
  selection: modelChoiceSchema.optional(),
  errorCode: z.string().optional(),
  updatedAt: z.number().int().nonnegative(),
}).strict()

function codec(typeSymbol: string, schema: z.ZodType) {
  return { mode: 'strict' as const, typeSymbol, schema, create: () => schema }
}

export const TYPERT: TypertContribution = {
  package: PACKAGE_NAME,
  face: 'host',
  schemas: [],
  invocations: [
    {
      id: STAGE_ENDPOINT,
      service: SERVICE_KEY,
      namespace: SERVICE_KEY,
      method: STAGE_METHOD,
      invocation: { kind: 'direct' },
      parameters: [{
        name: REQUEST_WIRE,
        wire: REQUEST_WIRE,
        source: 'json',
        codec: codec(REQUEST_SYMBOL, stageRequestSchema),
      }],
      cancellation: { parameter: 'signal' },
      result: codec(STAGE_RESULT_SYMBOL, stageResultSchema),
    },
    {
      id: STATE_ENDPOINT,
      service: SERVICE_KEY,
      namespace: SERVICE_KEY,
      method: STATE_METHOD,
      invocation: { kind: 'direct' },
      parameters: [{
        name: REQUEST_WIRE,
        wire: REQUEST_WIRE,
        source: 'json',
        codec: codec(STATE_REQUEST_SYMBOL, operationStateRequestSchema),
      }],
      result: codec(STATE_RESULT_SYMBOL, operationStateSchema.nullable()),
    },
  ],
  model: { services: [], events: [], objects: [] },
}
