import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { access, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, process.argv[2] ?? '.release')
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const filename = `${manifest.name}-${manifest.version}.tgz`
const checksumFilename = `${filename}.sha256`

for (const entry of ['lib/index.js', 'lib/client.js', 'lib/protocol.js', 'lib/range.js', 'lib/typert.js']) {
  try {
    await access(join(root, entry))
  } catch {
    throw new Error(`release:pack requires a build; missing ${entry}. Run pnpm build first.`)
  }
}

await mkdir(outDir, { recursive: true })
for (const name of await readdir(outDir)) {
  if (name.endsWith('.tgz') || name.endsWith('.sha256')) await rm(join(outDir, name), { force: true })
}
execFileSync('pnpm', ['pack', '--pack-destination', outDir], {
  cwd: root,
  stdio: 'inherit',
})

const tarballs = (await readdir(outDir)).filter((name) => name.endsWith('.tgz'))
assert.deepEqual(tarballs, [filename], `expected exactly ${filename}, got ${tarballs.join(', ')}`)
const tarballPath = join(outDir, filename)
const bytes = await readFile(tarballPath)
const digest = createHash('sha256').update(bytes).digest('hex')
const checksumPath = join(outDir, checksumFilename)
await writeFile(checksumPath, `${digest}  ${filename}\n`, 'utf8')

const checksumText = await readFile(checksumPath, 'utf8')
const match = /^([a-f0-9]{64})  ([^\n]+)\n$/.exec(checksumText)
assert.ok(match, 'checksum file must contain one standard sha256sum line')
assert.equal(match[1], digest, 'checksum file digest does not match the package tarball')
assert.equal(match[2], filename, 'checksum basename does not match the package tarball')

const artifacts = (await readdir(outDir)).filter((name) => name.endsWith('.tgz') || name.endsWith('.sha256')).sort()
assert.deepEqual(artifacts, [checksumFilename, filename].sort(), 'release output must contain exactly one tarball and one checksum')
console.log(`Release artifact verified: ${filename} (${digest})`)
