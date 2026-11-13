import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const { satisfies } = createRequire(import.meta.url)('semver') as { satisfies: (version: string, range: string, options: { includePrerelease: boolean }) => boolean }
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
const target = '0.2.2-rc.3'
const supported = '>=0.2.2-rc.2 <0.2.3-0'

describe('DSH compatibility metadata', () => {
  it.each([
    ['0.2.2-rc.1', false], ['0.2.2-rc.2', true], ['0.2.2-rc.3', true],
    ['0.2.2-rc.99', true], ['0.2.2', true], ['0.2.3-rc.1', false], ['0.2.3', false],
  ])('checks runtime admission for %s', (version, admitted) => {
    expect(satisfies(version as string, manifest.engines.dsh, { includePrerelease: true })).toBe(admitted)
  })
  it('separates the admitted release line from verified releases', () => {
    expect(manifest.engines.dsh).toBe(supported)
    expect(manifest.dsh.compatibility.dshReleases[target]).toBe('compatible')
  })

  it('bounds every DSH peer to the supported release line', () => {
    const dshPeers = Object.entries(manifest.peerDependencies)
      .filter(([name]) => name.startsWith('@deepseek-ai/dsh'))
    expect(dshPeers.length).toBeGreaterThan(10)
    for (const [name, range] of dshPeers) expect(range, name).toBe(supported)
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
