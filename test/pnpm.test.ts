import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ exec: vi.fn(), exists: vi.fn(() => true) }))
vi.mock('node:child_process', () => ({ execFileSync: mocks.exec }))
vi.mock('node:fs', () => ({ existsSync: mocks.exists }))
vi.mock('node:module', () => ({ createRequire: () => ({ resolve: () => { throw new Error('missing') } }) }))
import { runPnpm } from '../scripts/pnpm.mjs'
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })
it('executes the exact native pnpm entry without a shell', () => {
  vi.stubEnv('npm_execpath', 'C:\\Program Files\\pnpm\\pnpm.exe')
  runPnpm(['pack', '--pack-destination', 'D:\\中文 path'], { cwd: 'D:\\repo' })
  expect(mocks.exec).toHaveBeenCalledWith('C:\\Program Files\\pnpm\\pnpm.exe', ['pack', '--pack-destination', 'D:\\中文 path'], { cwd: 'D:\\repo', shell: false, stdio: 'inherit' })
})
it('executes a JavaScript pnpm entry through the current Node', () => {
  vi.stubEnv('npm_execpath', '/path with spaces/pnpm.cjs')
  runPnpm(['pack'])
  expect(mocks.exec).toHaveBeenCalledWith(process.execPath, ['/path with spaces/pnpm.cjs', 'pack'], { shell: false, stdio: 'inherit' })
})
it('rejects command shims instead of enabling a shell', () => {
  vi.stubEnv('npm_execpath', 'C:\\pnpm.cmd')
  expect(() => runPnpm(['pack'])).toThrow('Cannot resolve pnpm')
  expect(mocks.exec).not.toHaveBeenCalled()
})
