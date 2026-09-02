/**
 * `server-only` throws on import outside a React Server Component graph, which
 * is exactly what a vitest run is. Aliased to this no-op so the modules that
 * guard themselves with it can be imported and driven directly.
 */
export {}
