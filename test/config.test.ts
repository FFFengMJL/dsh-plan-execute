import { describe, expect, it } from 'vitest'
import { Config } from '../src/index.js'

describe('plan execute configuration', () => {
  it('starts with no presets and the default compaction threshold', () => {
    const config = Config({})
    expect(config.minShadowedTokens).toBe(2000)
    expect(config.compactExecution?.get()).toBeUndefined()
    expect(config.switchExecution?.get()).toBeUndefined()
  })

  it('keeps both presets independent and exposes live references', () => {
    const config = Config({
      compactExecution: { provider: 'p', model: 'm1', reasoningEffort: 'high' },
      switchExecution: { provider: 'q', model: 'm2' },
      minShadowedTokens: 50,
    })
    expect(config.minShadowedTokens).toBe(50)
    expect(config.compactExecution?.get()).toEqual({ provider: 'p', model: 'm1', reasoningEffort: 'high' })
    expect(config.switchExecution?.get()).toEqual({ provider: 'q', model: 'm2' })
  })

  it('rejects a preset without a provider or model', () => {
    expect(() => Config({ compactExecution: { provider: 'p' } })).toThrow()
    expect(() => Config({ switchExecution: { model: 'm1' } })).toThrow()
    expect(() => Config({ compactExecution: { provider: '', model: 'm1' } })).toThrow()
    expect(() => Config({ switchExecution: { provider: 'p', model: '' } })).toThrow()
  })
})
