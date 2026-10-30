import { describe, expect, it } from 'vitest'
import type { ModelCatalog } from '@deepseek-ai/dsh-api-remotes/client'
import {
  defaultEffort,
  effortLabel,
  effortLevels,
  findModel,
  modelKey,
  parseModelKey,
  providerName,
  selectionFor,
  supportsEffort,
  validateSelection,
} from '../src/client/model-catalog.js'

const catalog: ModelCatalog = {
  default: { provider: 'p', model: 'm1' },
  routableProviders: ['p'],
  groups: [{
    id: 'p',
    name: 'Provider P',
    models: [{
      id: 'm1',
      name: 'Model One',
      reasoning: {
        defaultEffort: 'medium',
        efforts: [
          { id: 'low', name: 'Low' },
          { id: 'medium', name: 'Medium' },
          { id: 'high', name: 'High' },
        ],
      },
    }, {
      id: 'm2',
      name: 'Model Two',
    }],
  }],
  failures: [{ id: 'q', name: 'Provider Q', message: 'offline' }],
}

describe('model catalog helpers', () => {
  it('round-trips provider/model keys and rejects malformed values', () => {
    const key = modelKey({ provider: 'p', model: 'm1' })
    expect(parseModelKey(key)).toEqual({ provider: 'p', model: 'm1' })
    expect(parseModelKey('')).toBeUndefined()
    expect(parseModelKey('not-json')).toBeUndefined()
    expect(parseModelKey('["p"]')).toBeUndefined()
  })

  it('reads models, provider names, efforts, and defaults from the catalog', () => {
    expect(findModel(catalog, 'p', 'm1')?.name).toBe('Model One')
    expect(findModel(catalog, 'p', 'missing')).toBeUndefined()
    expect(findModel(null, 'p', 'm1')).toBeUndefined()
    expect(providerName(catalog, 'p')).toBe('Provider P')
    expect(providerName(catalog, 'unknown')).toBe('unknown')
    expect(effortLevels(findModel(catalog, 'p', 'm1'))).toHaveLength(3)
    expect(effortLevels(findModel(catalog, 'p', 'm2'))).toEqual([])
    expect(defaultEffort(findModel(catalog, 'p', 'm1'))).toBe('medium')
    expect(defaultEffort(findModel(catalog, 'p', 'm2'))).toBeUndefined()
    expect(effortLabel(findModel(catalog, 'p', 'm1'), 'high')).toBe('High')
    expect(effortLabel(findModel(catalog, 'p', 'm1'), 'custom')).toBe('custom')
    expect(effortLabel(undefined, 'high')).toBeUndefined()
  })

  it('supports only advertised efforts and treats the empty effort as the default', () => {
    const model = findModel(catalog, 'p', 'm1')
    expect(supportsEffort(model, 'high')).toBe(true)
    expect(supportsEffort(model, '')).toBe(false)
    expect(supportsEffort(model, 'ultra')).toBe(false)
    expect(supportsEffort(findModel(catalog, 'p', 'm2'), 'high')).toBe(false)
  })

  it('builds a wire selection only for a concrete model', () => {
    expect(selectionFor('', '')).toBeUndefined()
    expect(selectionFor('["p","m2"]', '')).toEqual({ provider: 'p', model: 'm2' })
    expect(selectionFor('["p","m1"]', 'high')).toEqual({ provider: 'p', model: 'm1', reasoningEffort: 'high' })
  })

  it('validates model and effort availability against the latest catalog', () => {
    expect(validateSelection(catalog, { provider: 'p', model: 'm2' })).toBe('ok')
    expect(validateSelection(catalog, { provider: 'p', model: 'm1', reasoningEffort: 'high' })).toBe('ok')
    expect(validateSelection(null, { provider: 'p', model: 'm1' })).toBe('catalog-unavailable')
    expect(validateSelection(catalog, { provider: 'p', model: 'gone' })).toBe('model-unavailable')
    expect(validateSelection(catalog, { provider: 'p', model: 'm2', reasoningEffort: 'high' })).toBe('effort-unavailable')
  })
})
