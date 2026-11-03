// @vitest-environment jsdom
import { within } from '@testing-library/dom'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelCatalog, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  PresetController,
  PresetStore,
  type ExecutionPreset,
  type PresetFormValue,
} from '../src/client/presets.js'
import { SettingsPage } from '../src/client/settings.js'

const catalog: ModelCatalog = {
  default: { provider: 'p', model: 'm1' },
  routableProviders: ['p'],
  groups: [{
    id: 'p',
    name: 'Provider P',
    models: [
      {
        id: 'm1',
        name: 'Model One',
        reasoning: {
          defaultEffort: 'medium',
          efforts: [{ id: 'low', name: 'Low' }, { id: 'medium', name: 'Medium' }, { id: 'high', name: 'High' }],
        },
      },
      { id: 'm2', name: 'Model Two' },
    ],
  }],
  failures: [],
}

const t = ((key: string) => key) as never

class FakeForm {
  snapshot: ConfigFormSnapshot<PresetFormValue>
  readonly writes: Array<{ ops: readonly SettingsPathOpView[]; revision: number | undefined }> = []
  outcome: 'accept' | 'reject' | 'throw' = 'accept'
  readonly #listeners = new Set<() => void>()

  constructor(snapshot: ConfigFormSnapshot<PresetFormValue>) {
    this.snapshot = snapshot
  }

  readonly getSnapshot = (): ConfigFormSnapshot<PresetFormValue> => this.snapshot

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  readonly mutate = async (
    ops: readonly SettingsPathOpView[],
    revision?: number,
  ): Promise<boolean> => {
    this.writes.push({ ops, revision })
    if (this.outcome === 'throw') throw new Error('transport down')
    if (this.outcome === 'reject') {
      this.publish({ revision: (this.snapshot.revision ?? 0) + 1 })
      return false
    }
    const value = { ...(this.snapshot.value ?? {}) } as Record<string, unknown>
    const user = { ...(this.snapshot.user as Record<string, unknown> | undefined) } as Record<string, unknown>
    const base = (this.snapshot.base ?? {}) as Record<string, unknown>
    for (const op of ops) {
      const key = op.path[0]!
      if (op.op === 'unset') {
        // RC5 resolves an unset against the inherited layer. If that layer
        // supplies a value, the Host writes it into the user layer instead of
        // deleting the key, so the field remains overridden.
        if (base[key] === undefined) {
          delete value[key]
          delete user[key]
        } else {
          value[key] = base[key]
          user[key] = base[key]
        }
      } else {
        value[key] = op.value
        user[key] = op.value
      }
    }
    this.publish({ value, user, revision: (this.snapshot.revision ?? 0) + 1 })
    return true
  }

  form(): ConfigForm<PresetFormValue> {
    return this as unknown as ConfigForm<PresetFormValue>
  }

  publish(patch: Partial<ConfigFormSnapshot<PresetFormValue>>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.#listeners) listener()
  }
}

function readyForm(compact: ExecutionPreset | null = null, writable = true): FakeForm {
  return new FakeForm({
    status: 'ready',
    value: compact === null ? {} : { compactExecution: compact },
    base: {},
    user: compact === null ? {} : { compactExecution: compact },
    revision: 3,
    writable,
  })
}

function mount(form: FakeForm, load: () => Promise<ModelCatalog> = async () => catalog) {
  const store = new PresetStore()
  const controller = new PresetController(form.form(), store)
  const loadCatalog = vi.fn(load)
  const view = render(
    <SettingsPage controller={controller} loadCatalog={loadCatalog} t={t} close={() => {}} />,
  )
  return { view, controller, store, loadCatalog }
}

function card(title: string): HTMLElement {
  const heading = screen.getByRole('heading', { name: title })
  const section = heading.closest('section')
  if (section === null) throw new Error('missing preset card')
  return section
}

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

describe('plan approval preset settings', () => {
  it('loads both cards, shows the inherited preset, and saves a changed model atomically', async () => {
    const form = readyForm({ provider: 'p', model: 'm1', reasoningEffort: 'medium' })
    mount(form)
    await waitFor(() => expect(screen.getAllByRole('option', { name: 'Model Two' })).toHaveLength(2))

    const compact = card('compactTitle')
    expect(within(compact).getByText('overridden')).toBeTruthy()
    expect(within(card('switchTitle')).getByText('inherited')).toBeTruthy()

    const model = within(compact).getAllByRole('combobox')[0]!
    fireEvent.change(model, { target: { value: '["p","m2"]' } })
    expect(screen.getByText('dirty')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    await waitFor(() => expect(form.writes).toHaveLength(1))
    expect(form.writes[0]!.revision).toBe(3)
    expect(form.writes[0]!.ops).toEqual([
      { op: 'set', path: ['compactExecution'], value: { provider: 'p', model: 'm2' } },
    ])
    expect(await screen.findByText('saved')).toBeTruthy()
  })

  it('does not offer to clear a preset inherited from a lower layer', async () => {
    const inherited = { provider: 'p', model: 'm1' }
    const form = new FakeForm({
      status: 'ready',
      value: { compactExecution: inherited },
      base: { compactExecution: inherited },
      user: {},
      revision: 3,
      writable: true,
    })
    mount(form)
    await waitFor(() => expect(screen.getAllByRole('option', { name: 'Model Two' })).toHaveLength(2))

    const compact = card('compactTitle')
    expect(within(compact).getByText('inherited')).toBeTruthy()
    const modelSelect = within(compact).getAllByRole('combobox')[0]!
    expect(within(modelSelect).getAllByRole('option').some(option => (option as HTMLOptionElement).value === '')).toBe(false)
  })

  it('clears an overridden preset with unset instead of writing an empty object', async () => {
    const form = readyForm({ provider: 'p', model: 'm1' })
    mount(form)
    await waitFor(() => expect(screen.getAllByRole('option', { name: 'Model Two' })).toHaveLength(2))

    const compact = card('compactTitle')
    fireEvent.change(within(compact).getAllByRole('combobox')[0]!, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    await waitFor(() => expect(form.writes).toHaveLength(1))
    expect(form.writes[0]!.ops).toEqual([{ op: 'unset', path: ['compactExecution'] }])
  })

  it('keeps the draft after a refused write and retries with the recovered revision', async () => {
    const form = readyForm({ provider: 'p', model: 'm1' })
    form.outcome = 'reject'
    mount(form)
    await waitFor(() => expect(screen.getAllByRole('option', { name: 'Model Two' })).toHaveLength(2))

    const compact = card('compactTitle')
    fireEvent.change(within(compact).getAllByRole('combobox')[0]!, { target: { value: '["p","m2"]' } })
    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    expect(await screen.findByText('conflict')).toBeTruthy()
    expect((within(compact).getAllByRole('combobox')[0] as HTMLSelectElement).value).toBe('["p","m2"]')
    expect(form.writes[0]!.revision).toBe(3)

    form.outcome = 'accept'
    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    await waitFor(() => expect(form.writes).toHaveLength(2))
    expect(form.writes[1]!.revision).toBe(4)
  })

  it('does not overwrite an untouched preset when retrying after a conflict', async () => {
    const compact = { provider: 'p', model: 'm1' }
    const form = new FakeForm({
      status: 'ready',
      value: { compactExecution: compact, switchExecution: compact },
      base: {},
      user: { compactExecution: compact, switchExecution: compact },
      revision: 3,
      writable: true,
    })
    mount(form)
    await waitFor(() => expect(screen.getAllByRole('option', { name: 'Model Two' })).toHaveLength(2))

    const compactCard = card('compactTitle')
    fireEvent.change(within(compactCard).getAllByRole('combobox')[0]!, { target: { value: '["p","m2"]' } })
    // Another editor changes only the switch preset and advances the revision.
    form.publish({
      value: { compactExecution: compact, switchExecution: { provider: 'p', model: 'm2' } },
      user: { compactExecution: compact, switchExecution: { provider: 'p', model: 'm2' } },
      revision: 4,
    })
    form.outcome = 'reject'
    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    expect(await screen.findByText('conflict')).toBeTruthy()
    expect(form.writes[0]!.revision).toBe(3)

    form.outcome = 'accept'
    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    await waitFor(() => expect(form.writes).toHaveLength(2))
    expect(form.writes[1]!.revision).toBe(5)
    expect(form.writes[1]!.ops).toEqual([
      { op: 'set', path: ['compactExecution'], value: { provider: 'p', model: 'm2' } },
    ])
    expect((within(card('switchTitle')).getAllByRole('combobox')[0] as HTMLSelectElement).value).toBe('["p","m2"]')
  })

  it('does not block an edit because an untouched saved preset is stale', async () => {
    const stale = { provider: 'p', model: 'gone' }
    const form = new FakeForm({
      status: 'ready',
      value: { compactExecution: stale, switchExecution: { provider: 'p', model: 'm1' } },
      base: {},
      user: { compactExecution: stale, switchExecution: { provider: 'p', model: 'm1' } },
      revision: 3,
      writable: true,
    })
    mount(form)
    await waitFor(() => expect(screen.getAllByRole('option', { name: 'Model Two' })).toHaveLength(2))

    const switchCard = card('switchTitle')
    fireEvent.change(within(switchCard).getAllByRole('combobox')[0]!, { target: { value: '["p","m2"]' } })
    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    await waitFor(() => expect(form.writes).toHaveLength(1))
    expect(form.writes[0]!.ops).toEqual([
      { op: 'set', path: ['switchExecution'], value: { provider: 'p', model: 'm2' } },
    ])
    expect(await screen.findByText('saved')).toBeTruthy()
  })

  it('still allows clearing a preset while the model catalog is unavailable', async () => {
    const form = readyForm({ provider: 'p', model: 'm1' })
    mount(form, async () => { throw new Error('catalog down') })
    expect(await screen.findByText('catalogError')).toBeTruthy()

    const compact = card('compactTitle')
    fireEvent.change(within(compact).getAllByRole('combobox')[0]!, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    await waitFor(() => expect(form.writes).toHaveLength(1))
    expect(form.writes[0]!.ops).toEqual([{ op: 'unset', path: ['compactExecution'] }])
    expect(await screen.findByText('saved')).toBeTruthy()
  })

  it('pins the inherited value when clearing an override and labels the result', async () => {
    const inherited = { provider: 'p', model: 'm1' }
    const form = new FakeForm({
      status: 'ready',
      value: {
        compactExecution: { provider: 'p', model: 'm2' },
        switchExecution: { provider: 'p', model: 'm2' },
      },
      base: { compactExecution: inherited },
      user: {
        compactExecution: { provider: 'p', model: 'm2' },
        switchExecution: { provider: 'p', model: 'm2' },
      },
      revision: 3,
      writable: true,
    })
    mount(form)
    await waitFor(() => expect(screen.getAllByRole('option', { name: 'Model Two' })).toHaveLength(2))

    const compact = card('compactTitle')
    expect(within(compact).getByText('overridden')).toBeTruthy()
    const inheritedOption = within(compact).getAllByRole('option')[0] as HTMLOptionElement
    expect(inheritedOption.textContent).toBe('useInherited')
    expect(inheritedOption.disabled).toBe(false)
    fireEvent.change(within(compact).getAllByRole('combobox')[0]!, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    await waitFor(() => expect(form.writes).toHaveLength(1))
    expect(form.writes[0]!.ops).toEqual([{ op: 'unset', path: ['compactExecution'] }])
    expect(await screen.findByText('saved')).toBeTruthy()
    expect((form.snapshot.user as Record<string, unknown>).compactExecution).toEqual(inherited)
    expect(within(compact).getByText('overriddenSame')).toBeTruthy()
    expect((within(compact).getAllByRole('combobox')[0] as HTMLSelectElement).value).toBe('["p","m1"]')
    const pinnedOption = within(compact).getAllByRole('option')[0] as HTMLOptionElement
    expect(pinnedOption.textContent).toBe('pinnedInherited')
    expect(pinnedOption.disabled).toBe(true)
  })

  it('withdraws the store snapshot when the controller is disposed', () => {
    const form = readyForm({ provider: 'p', model: 'm1' })
    const { controller, store } = mount(form)
    expect(store.getSnapshot().status).toBe('ready')

    controller.dispose()
    expect(store.getSnapshot().status).toBe('unavailable')
  })

  it('disables every write control in a read-only deployment', async () => {
    const form = readyForm({ provider: 'p', model: 'm1' }, false)
    mount(form)
    await waitFor(() => expect(screen.getAllByRole('option', { name: 'Model Two' })).toHaveLength(2))

    expect(screen.getByText('readOnly')).toBeTruthy()
    for (const select of screen.getAllByRole('combobox')) expect((select as HTMLSelectElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'save' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('reports a catalog failure and retries without losing the form', async () => {
    let attempts = 0
    const form = readyForm({ provider: 'p', model: 'm1' })
    mount(form, async () => {
      attempts += 1
      if (attempts === 1) throw new Error('provider exploded')
      return catalog
    })

    expect(await screen.findByText('catalogError')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'retry' }))
    await waitFor(() => expect(screen.getAllByRole('option', { name: 'Model Two' })).toHaveLength(2))
    expect(attempts).toBe(2)
    expect(within(card('compactTitle')).getAllByRole('combobox')[0]).toBeTruthy()
  })
})
