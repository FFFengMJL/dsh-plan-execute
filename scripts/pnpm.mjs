import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'

/** Execute pnpm's exact native/JS entry without a shell or command shim. */
export function runPnpm(args, options = {}) {
  const require = createRequire(import.meta.url)
  const entry = process.env.npm_execpath
  // pnpm 12 can expose a standalone native executable rather than a JS CLI.
  if (entry && /[\\/]pnpm(?:\.exe)?$/i.test(entry) && existsSync(entry)) {
    return execFileSync(entry, args, { ...options, shell: false, stdio: 'inherit' })
  }
  let filename = entry && /[\\/]pnpm\.(?:c?js|mjs)$/i.test(entry) && existsSync(entry) ? entry : undefined
  if (!filename) {
    try { filename = require.resolve('pnpm/bin/pnpm.cjs') } catch {
      throw new Error('Cannot resolve pnpm JavaScript entry. Run this script through pnpm.')
    }
  }
  return execFileSync(process.execPath, [filename, ...args], { ...options, shell: false, stdio: 'inherit' })
}
