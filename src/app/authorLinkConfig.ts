import { AUTHORLINK_DEFAULT_ROOM, AUTHORLINK_PATH } from '@/net/authorLinkProtocol';

/** Why a window is NOT linking, so the UI can say something more useful than "off". */
export type AuthorLinkDisabledReason =
  /** `?link=off`. */
  | 'off'
  /** A browser under automation: dev auto-link is suppressed so probes stay independent. */
  | 'automated'
  /** A player build: linking needs an explicit `?link=<room>`. */
  | 'production';

export interface AuthorLinkConfig {
  enabled: boolean;
  url: string;
  room: string;
  /** Hosted-room write token, from VITE_AUTHORLINK_TOKEN. Never from the URL. */
  token?: string;
  /** Set when `enabled` is false. */
  disabledReason?: AuthorLinkDisabledReason;
  /** Which relay this window would talk to: this dev server, or a hosted one. */
  relay: 'dev-server' | 'hosted';
  /**
   * Whether this window may write to its room. A hosted relay rejects every
   * write that lacks the room token, and says so only in a status detail — so
   * the UI has to know up front, or a tokenless window looks linked while
   * nothing it does arrives.
   */
  writable: boolean;
}

/**
 * Resolve whether this window links, and to where.
 *
 * Dev links by default — two windows syncing with no ceremony is the entire
 * feature. Production stays off unless the URL asks, because a shipped build
 * must never open a socket the player did not request.
 *
 *   ?link=off          force off (dev escape hatch)
 *   ?link=<room>       force on, named room
 *   VITE_AUTHORLINK_URL override the relay origin (two machines)
 *
 * AUTOMATED PAGES DO NOT AUTO-LINK. The repo drives a dozen headless probes
 * against one dev server, often several pages at once. With dev auto-linking,
 * every one of those pages would silently join room `local` and start applying
 * each other's tuning and terrain — turning independent probes into a shared
 * session and producing failures that look like real regressions in whatever
 * probe happened to run second. An automated page must ask for the link by
 * name; the AuthorLink probes do exactly that.
 */
export function resolveAuthorLinkConfig(
  search: string,
  isDev: boolean,
  location: { protocol: string; host: string },
  envUrl?: string,
  envToken?: string,
  isAutomated = false,
): AuthorLinkConfig {
  const params = new URLSearchParams(search);
  const link = params.get('link');
  const room = link && link !== 'off' && link !== 'on' ? link : AUTHORLINK_DEFAULT_ROOM;
  const autoLink = isDev && !isAutomated;
  const enabled = link === 'off' ? false : autoLink || Boolean(link);
  const base = envUrl && envUrl.length > 0 ? envUrl.replace(/\/$/, '') : null;
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const origin = base ?? `${scheme}//${location.host}`;
  let disabledReason: AuthorLinkDisabledReason | undefined;
  if (!enabled) disabledReason = link === 'off' ? 'off' : isDev && isAutomated ? 'automated' : 'production';
  // The relay origin and token come from BUILD-TIME env only, never from the
  // query string. A `?linkServer=` parameter would let any link pointed at a
  // deployed build stream that session's tuning and terrain to an attacker's
  // socket; the room name is the only thing safe to take from the URL.
  return {
    enabled,
    url: `${origin}${AUTHORLINK_PATH}?room=${encodeURIComponent(room)}`,
    room,
    ...(envToken ? { token: envToken } : {}),
    ...(disabledReason ? { disabledReason } : {}),
    relay: base ? 'hosted' : 'dev-server',
    writable: base ? Boolean(envToken) : true,
  };
}
