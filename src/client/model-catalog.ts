import type {
  ModelCatalog,
  ModelCatalogModel,
  ModelReasoningEffort,
  ModelSelection,
} from '@deepseek-ai/dsh-api-remotes/client'

/** How far the execution-options form got loading the Host model catalog. */
export type CatalogPhase = 'loading' | 'ready' | 'error' | 'timeout'

/** One catalog read attempt plus the last catalog that was successfully loaded. */
export interface CatalogLoad {
  readonly phase: CatalogPhase
  readonly catalog: ModelCatalog | null
  readonly error: string | null
}

/** Stop waiting for a catalog response and let the user retry. */
export const CATALOG_LOAD_TIMEOUT_MS = 15_000

/** Verdict for a candidate model selection against the latest catalog. */
export type SelectionVerdict = 'ok' | 'model-unavailable' | 'effort-unavailable' | 'catalog-unavailable'

/** Stable key for one provider/model pair, also used by the wire request. */
export function modelKey(choice: { readonly provider: string; readonly model: string }): string {
  return JSON.stringify([choice.provider, choice.model])
}

/** Parse a value produced by {@link modelKey}; `''` means "keep the current model". */
export function parseModelKey(value: string): { readonly provider: string; readonly model: string } | undefined {
  if (value === '') return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed) || typeof parsed[0] !== 'string' || typeof parsed[1] !== 'string') return undefined
    return { provider: parsed[0], model: parsed[1] }
  } catch {
    return undefined
  }
}

/** Find one model in its provider group; provider ids are the catalog group ids. */
export function findModel(
  catalog: ModelCatalog | null,
  provider: string,
  model: string,
): ModelCatalogModel | undefined {
  return catalog?.groups.find(group => group.id === provider)?.models.find(entry => entry.id === model)
}

/** Display name of the provider that owns `provider`, falling back to the raw id. */
export function providerName(catalog: ModelCatalog | null, provider: string): string {
  return catalog?.groups.find(group => group.id === provider)?.name ?? provider
}

/** Reasoning levels a model advertises; empty when it has no adjustable effort. */
export function effortLevels(model: ModelCatalogModel | undefined): readonly ModelReasoningEffort[] {
  return model?.reasoning?.efforts ?? []
}

/** Whether `effort` is one of the model's advertised levels. `''` is the model default. */
export function supportsEffort(model: ModelCatalogModel | undefined, effort: string): boolean {
  if (effort === '') return false
  return effortLevels(model).some(level => level.id === effort)
}

/** Effort applied when the caller does not pin one. */
export function defaultEffort(model: ModelCatalogModel | undefined): string | undefined {
  return model?.reasoning?.defaultEffort
}

/** Build the wire selection for the form values; `''` model means "keep current". */
export function selectionFor(modelValue: string, effortValue: string): ModelSelection | undefined {
  const choice = parseModelKey(modelValue)
  if (choice === undefined) return undefined
  return effortValue === '' ? choice : { ...choice, reasoningEffort: effortValue }
}

/** Validate a candidate selection against the latest successfully loaded catalog. */
export function validateSelection(
  catalog: ModelCatalog | null,
  selection: ModelSelection,
): SelectionVerdict {
  if (catalog === null) return 'catalog-unavailable'
  const model = findModel(catalog, selection.provider, selection.model)
  if (model === undefined) return 'model-unavailable'
  if (selection.reasoningEffort !== undefined && !supportsEffort(model, selection.reasoningEffort)) {
    return 'effort-unavailable'
  }
  return 'ok'
}

/** Human-readable effort label, including the effective model default. */
export function effortLabel(model: ModelCatalogModel | undefined, effort: string | undefined): string | undefined {
  if (effort === undefined || model === undefined) return undefined
  return effortLevels(model).find(level => level.id === effort)?.name ?? effort
}
