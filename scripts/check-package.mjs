import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const filename = `${manifest.name}-${manifest.version}.tgz`
const scratch = await mkdtemp(join(tmpdir(), 'dsh-plan-execute-package-'))
const packDir = join(scratch, 'artifacts')

try {
  await mkdir(packDir)
  execFileSync('pnpm', ['pack', '--pack-destination', packDir], {
    cwd: root,
    stdio: 'inherit',
  })

  const generated = (await readdir(packDir)).filter((name) => name.endsWith('.tgz'))
  assert.deepEqual(generated, [filename], `expected exactly ${filename}, got ${generated.join(', ')}`)
  execFileSync('tar', ['-xzf', join(packDir, filename), '-C', scratch], { stdio: 'inherit' })

  const packageRoot = join(scratch, 'package')
  const packedManifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
  assert.equal(packedManifest.name, manifest.name, 'packed name must match package.json')
  assert.equal(packedManifest.version, manifest.version, 'packed version must match package.json')
  assert.equal(packedManifest.private, true, 'keep npm publishing disabled for the GitHub-only release')
  assert.equal(packedManifest.license, 'MIT', 'package metadata must declare the repository license')
  assert.equal(packedManifest.main, 'lib/index.js', 'unexpected Host entry point')
  assert.equal(packedManifest.types, 'lib/types/index.d.ts', 'unexpected Host type entry point')
  assert.deepEqual(packedManifest.exports['.'], {
    types: './lib/types/index.d.ts',
    default: './lib/index.js',
  }, 'unexpected Host exports')
  assert.deepEqual(packedManifest.exports['./client'], {
    types: './lib/types/client/index.d.ts',
    default: './lib/client.js',
  }, 'unexpected client exports')
  assert.equal(packedManifest.dsh.bundle.patch, './cordis.patch.yml', 'unexpected DSH bundle patch')

  const files = new Set(await listFiles(packageRoot))
  const expectedFiles = [
    'package.json',
    'README.md',
    'LICENSE',
    'cordis.patch.yml',
    'lib/client.js',
    'lib/client.js.map',
    'lib/client/index.js',
    'lib/index.js',
    'lib/protocol.js',
    'lib/range.js',
    'lib/typert.js',
    'lib/types/client/index.d.ts',
    'lib/types/index.d.ts',
    'lib/types/protocol.d.ts',
    'lib/types/range.d.ts',
    'lib/types/typert.d.ts',
  ].sort()
  assert.deepEqual([...files].sort(), expectedFiles, 'unexpected package file set; review intentional additions/removals')

  const forbiddenFiles = ['AGENTS.md', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']
  for (const file of forbiddenFiles) assert.ok(!files.has(file), `maintainer file leaked into the tarball: ${file}`)
  for (const file of files) {
    assert.ok(!file.startsWith('.github/'), `workflow file leaked into the tarball: ${file}`)
    assert.ok(!file.startsWith('scripts/'), `maintainer script leaked into the tarball: ${file}`)
    assert.ok(!file.startsWith('node_modules/'), `dependency leaked into the tarball: ${file}`)
    assert.ok(!file.startsWith('src/'), `source file leaked into the tarball: ${file}`)
    assert.ok(!file.startsWith('test/'), `test file leaked into the tarball: ${file}`)
  }

  console.log(`Packed tarball verified: ${filename} (${files.size} files)`)
} finally {
  await rm(scratch, { recursive: true, force: true })
}

async function listFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name)
    if (entry.isDirectory()) {
      for (const child of await listFiles(fullPath)) files.push(`${entry.name}/${child}`)
    } else {
      assert.ok(entry.isFile(), `non-regular entry in package tarball: ${fullPath}`)
      files.push(entry.name)
    }
  }
  return files
}
