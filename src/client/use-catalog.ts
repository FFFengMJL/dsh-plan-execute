import { useCallback, useEffect, useState } from 'react'
import type { ModelCatalog } from '@deepseek-ai/dsh-api-remotes/client'
import { describeError } from './describe.js'
import { CATALOG_LOAD_TIMEOUT_MS, type CatalogLoad } from './model-catalog.js'

/** Catalog read state plus an explicit retry trigger. */
export interface ModelCatalogState extends CatalogLoad {
  retry(): void
}

/**
 * Load the Host model catalog once per `resetKey`, with a bounded wait and a
 * retry action. The last successful catalog stays available while a new read
 * runs, so selectors do not flicker on a review change or a manual retry.
 *
 * @param loadCatalog - Remote read supplied by the plugin shell.
 * @param resetKey - identity that restarts the read (Session id, page mount).
 * @returns the current phase, catalog, error, and retry callback.
 */
export function useModelCatalog(
  loadCatalog: () => Promise<ModelCatalog>,
  resetKey: unknown,
): ModelCatalogState {
  const [load, setLoad] = useState<CatalogLoad>({ phase: 'loading', catalog: null, error: null })
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let live = true
    let settled = false
    setLoad(previous => ({ phase: 'loading', catalog: previous.catalog, error: null }))
    const timer = window.setTimeout(() => {
      if (!live || settled) return
      settled = true
      setLoad(previous => ({ phase: 'timeout', catalog: previous.catalog, error: null }))
    }, CATALOG_LOAD_TIMEOUT_MS)
    void loadCatalog().then(value => {
      if (!live || settled) return
      settled = true
      window.clearTimeout(timer)
      setLoad({ phase: 'ready', catalog: value, error: null })
    }).catch((cause: unknown) => {
      if (!live || settled) return
      settled = true
      window.clearTimeout(timer)
      setLoad(previous => ({ phase: 'error', catalog: previous.catalog, error: describeError(cause) }))
    })
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [loadCatalog, reload, resetKey])

  const retry = useCallback(() => { setReload(value => value + 1) }, [])
  return { ...load, retry }
}
