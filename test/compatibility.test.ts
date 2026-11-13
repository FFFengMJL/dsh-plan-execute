import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

interface Manifest {
  engines: { dsh: string }
  dsh: { compatibility: { dshReleases: Record<string, string> } }
  peerDependencies: Record<string, string>
  devDependencies: Record<string, string>
}

const root = fileURLToPath(new URL('..', import.meta.url))
const manifest = JSON.parse(readFileSync(`${root}package.json`, 'utf8')) as Manifest
const target = '0.2.2-rc.2'

describe('DSH compatibility metadata', () => {
  it('admits only the verified DSH release', () => {
    expect(manifest.engines.dsh).toBe(target)
    expect(manifest.dsh.compatibility.dshReleases).toEqual({ [target]: 'compatible' })
  })

  it('pins every DSH peer to the verified release', () => {
    const dshPeers = Object.entries(manifest.peerDependencies)
      .filter(([name]) => name.startsWith('@deepseek-ai/dsh'))
    expect(dshPeers.length).toBeGreaterThan(10)
    for (const [name, range] of dshPeers) expect(range, name).toBe(target)
  })

  it('pins the Cordis and Schemastery peers to the verified lines', () => {
    expect(manifest.peerDependencies['@deepseek-ai/cordis']).toBe('~4.1.0')
    expect(manifest.peerDependencies['@deepseek-ai/schemastery']).toBe('~3.19.0')
  })

  it('pins devDependencies to the verified release', () => {
    const dshDev = Object.entries(manifest.devDependencies)
      .filter(([name]) => name.startsWith('@deepseek-ai/dsh'))
    expect(dshDev.length).toBeGreaterThan(10)
    for (const [name, range] of dshDev) expect(range, name).toBe(target)
    expect(manifest.devDependencies['@deepseek-ai/cordis']).toBe('~4.1.0')
    expect(manifest.devDependencies['@deepseek-ai/schemastery']).toBe('~3.19.0')
  })
})
