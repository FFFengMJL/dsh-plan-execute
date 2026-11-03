import type { ModelCatalog, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { validateSelection, type SelectionVerdict } from './model-catalog.js'

/**
 * Profile entry id shipped by `cordis.patch.yml`. Settings namespaces are
 * profile entry ids, so the client page and the Host Config must agree on this
 * spelling. A deployment that mounts the Host half under another id simply
 * shows no saved presets; the manual execution options keep working.
 */
export const SETTINGS_ENTRY_ID = 'plan-execute'

/** Config keys owned by this plugin's settings form. */
export const COMPACT_KEY = 'compactExecution'
export const SWITCH_KEY = 'switchExecution'

/** One explicit model target saved for an approval shortcut. */
export interface ExecutionPreset {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

/** The two independent shortcut targets. `null` means "not configured". */
export interface PresetDraft {
  readonly compact: ExecutionPreset | null
  readonly switch: ExecutionPreset | null
}

/** Snapshot of the persisted plan-approval presets. */
export interface PresetView {
  readonly status: 'loading' | 'ready' | 'unavailable'
  /** Effective values: profile override, inherited layer, or absent. */
  readonly presets: PresetDraft
  /** Values that applying a clear would restore, for the settings page. */
  readonly inherited: PresetDraft
  readonly overridden: { readonly compact: boolean; readonly switch: boolean }
  readonly writable: boolean
  readonly revision: number | undefined
}

/** Shape the Host Config form decodes. */
export interface PresetFormValue {
  readonly compactExecution?: ExecutionPreset
  readonly switchExecution?: ExecutionPreset
}

const EMPTY_DRAFT: PresetDraft = { compact: null, switch: null }

const UNAVAILABLE: PresetView = {
  status: 'unavailable',
  presets: EMPTY_DRAFT,
  inherited: EMPTY_DRAFT,
  overridden: { compact: false, switch: false },
  writable: false,
  revision: undefined,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Narrow one stored preset; malformed entries are treated as unconfigured. */
export function normalizePreset(value: unknown): ExecutionPreset | null {
  if (!isRecord(value)) return null
  const provider = value.provider
  const model = value.model
  const effort = value.reasoningEffort
  if (typeof provider !== 'string' || provider === '') return null
  if (typeof model !== 'string' || model === '') return null
  return {
    provider,
    model,
    ...(typeof effort === 'string' && effort !== '' ? { reasoningEffort: effort } : {}),
  }
}

/** Narrow a whole Config section into the two presets. */
export function normalizeDraft(value: unknown): PresetDraft {
  const record = isRecord(value) ? value : {}
  return {
    compact: normalizePreset(record[COMPACT_KEY]),
    switch: normalizePreset(record[SWITCH_KEY]),
  }
}

function samePreset(left: ExecutionPreset | null, right: ExecutionPreset | null): boolean {
  if (left === null || right === null) return left === right
  return left.provider === right.provider
    && left.model === right.model
    && left.reasoningEffort === right.reasoningEffort
}

function sameDraft(left: PresetDraft, right: PresetDraft): boolean {
  return samePreset(left.compact, right.compact) && samePreset(left.switch, right.switch)
}

function sameView(left: PresetView, right: PresetView): boolean {
  return left.status === right.status
    && left.writable === right.writable
    && left.revision === right.revision
    && left.overridden.compact === right.overridden.compact
    && left.overridden.switch === right.overridden.switch
    && sameDraft(left.presets, right.presets)
    && sameDraft(left.inherited, right.inherited)
}

function project(snapshot: {
  readonly status: PresetView['status']
  readonly value: unknown
  readonly base: unknown
  readonly user: unknown
  readonly writable: boolean
  readonly revision: number | undefined
}): PresetView {
  const user = isRecord(snapshot.user) ? snapshot.user : {}
  return {
    status: snapshot.status,
    presets: normalizeDraft(snapshot.value),
    inherited: normalizeDraft(snapshot.base),
    overridden: {
      compact: Object.hasOwn(user, COMPACT_KEY),
      switch: Object.hasOwn(user, SWITCH_KEY),
    },
    writable: snapshot.writable,
    revision: snapshot.revision,
  }
}

/**
 * Stable observable consumed by the review panel (which only needs the
 * effective presets) and the settings page (which also renders inheritance).
 */
export class PresetStore {
  #snapshot: PresetView = UNAVAILABLE
  readonly #listeners = new Set<() => void>()

  readonly getSnapshot = (): PresetView => this.#snapshot

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  publish(next: PresetView): void {
    if (next === this.#snapshot) return
    this.#snapshot = next
    for (const listener of this.#listeners) listener()
  }
}

/** Result of one settings write attempt. */
export type PresetSaveOutcome = 'saved' | 'unchanged' | 'conflict' | 'failed'

/**
 * Bind one Host Config form into a {@link PresetStore} and translate the
 * staged drafts into revision-fenced settings writes.
 */
export class PresetController {
  readonly #form: ConfigForm<PresetFormValue>
  readonly #store: PresetStore
  readonly #unsubscribe: () => void
  #last: PresetView | undefined

  constructor(form: ConfigForm<PresetFormValue>, store: PresetStore) {
    this.#form = form
    this.#store = store
    this.#unsubscribe = form.subscribe(() => { this.refresh() })
    this.refresh()
  }

  get store(): PresetStore {
    return this.#store
  }

  refresh(): void {
    const next = project(this.#form.getSnapshot())
    if (this.#last !== undefined && sameView(this.#last, next)) return
    this.#last = next
    this.#store.publish(next)
  }

  /** Release this consumer's subscription; the provider still owns the form. */
  dispose(): void {
    this.#unsubscribe()
  }

  /**
   * Write only the presets that differ from the accepted values. A `null` draft
   * clears the profile override, restoring the inherited value.
   *
   * @param draft - complete next state of both shortcuts.
   * @param expectedRevision - revision read when editing began. A write fenced
   * to an older revision is refused instead of overwriting another editor.
   */
  async save(draft: PresetDraft, expectedRevision?: number): Promise<PresetSaveOutcome> {
    const view = this.#store.getSnapshot()
    if (view.status !== 'ready') return 'failed'

    const ops: SettingsPathOpView[] = []
    const add = (
      key: typeof COMPACT_KEY | typeof SWITCH_KEY,
      kind: 'compact' | 'switch',
      next: ExecutionPreset | null,
    ): void => {
      const current = view.presets[kind]
      if (next === null) {
        if (view.overridden[kind]) ops.push({ op: 'unset', path: [key] })
        return
      }
      if (samePreset(next, current)) return
      ops.push({
        op: 'set',
        path: [key],
        value: {
          provider: next.provider,
          model: next.model,
          ...(next.reasoningEffort === undefined ? {} : { reasoningEffort: next.reasoningEffort }),
        },
      })
    }
    add(COMPACT_KEY, 'compact', normalizePreset(draft.compact))
    add(SWITCH_KEY, 'switch', normalizePreset(draft.switch))

    if (ops.length === 0) return 'unchanged'
    const fence = expectedRevision ?? view.revision
    try {
      const accepted = await this.#form.mutate(ops, fence)
      this.refresh()
      return accepted ? 'saved' : 'conflict'
    } catch {
      this.refresh()
      return 'failed'
    }
  }
}

/** Validate that every configured preset still resolves in the catalog. */
export function presetVerdict(
  catalog: ModelCatalog | null,
  preset: ExecutionPreset | null,
): 'unconfigured' | SelectionVerdict {
  if (preset === null) return 'unconfigured'
  return validateSelection(catalog, preset)
}
