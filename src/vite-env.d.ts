/// <reference types="vite/client" />

/** Commit hash + build time, baked in by vite.config's `define`. */
declare const __BUILD_STAMP__: string;

/**
 * AuthorLink relay configuration. BUILD-TIME only, never read from the URL:
 * a `?linkServer=` parameter would let any link pointed at a deployed build
 * stream that session's tuning and terrain to an attacker's socket.
 */
interface ImportMetaEnv {
  /** Relay origin, e.g. `wss://authorlink.example.workers.dev`. */
  readonly VITE_AUTHORLINK_URL?: string;
  /** Write token for a hosted room that requires one. */
  readonly VITE_AUTHORLINK_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
