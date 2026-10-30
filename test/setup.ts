import { webcrypto } from 'node:crypto'

// jsdom exposes a Web Crypto implementation without subtle digests on some
// Node versions; the client hashes review plans with SHA-256.
if (globalThis.crypto?.subtle === undefined) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
    writable: true,
  })
}
