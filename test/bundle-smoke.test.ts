import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const bundlePath = resolve(process.cwd(), 'lib/client.js')
const loadBundle = existsSync(bundlePath) ? readFileSync(bundlePath, 'utf8') : undefined
const requireFromProject = createRequire(import.meta.url)

describe('client loader bundle', () => {
  it.skipIf(loadBundle === undefined)('registers the expected loader entry and exports apply/inject', () => {
    let loaded: { apply?: unknown; inject?: unknown } | undefined
    const window = {
      __ModuleLoader__: {
        load(record: { id: string; factory: (require: (id: string) => unknown) => { apply?: unknown; inject?: unknown } }) {
          expect(record.id).toBe('dsh-plan-execute')
          loaded = record.factory(specifier => requireFromProject(specifier))
        },
      },
    }

    runInNewContext(loadBundle!, { window })
    expect(typeof loaded?.apply).toBe('function')
    expect(loaded?.inject).toEqual(['slots', 'locale', 'remote', 'remote.session'])
  })
})
