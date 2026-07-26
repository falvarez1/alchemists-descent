import { attachAuthorLink, AUTHORLINK_PATH } from './authorlink-server.mjs';

/**
 * Mounts the AuthorLink relay on the Vite dev server so `npm run dev` is the
 * only command needed for two-window authoring.
 *
 * Why a separate WebSocket instead of Vite's HMR channel: `import.meta.hot` is
 * stripped from production builds, so an HMR-based link could never graduate
 * past dev, and sharing the HMR socket entangles authoring traffic with
 * reload semantics. A private path on the same port costs nothing and the
 * client code is then identical in dev and production.
 *
 * @returns {import('vite').Plugin}
 */
export function authorLinkPlugin() {
  let relay = null;
  return {
    name: 'authorlink',
    apply: 'serve',
    configureServer(server) {
      if (!server.httpServer) return;
      server.httpServer.once('listening', () => {
        relay = attachAuthorLink(server.httpServer, {
          log: (msg) => server.config.logger.info(`[authorlink] ${msg}`),
        });
        server.config.logger.info(`  \x1b[32m➜\x1b[0m  \x1b[1mAuthorLink\x1b[0m: ${AUTHORLINK_PATH} (open a second window to sync)`);
      });
      // Vite reuses the process across restarts (config change, `r`), so the
      // old relay must let go of its `upgrade` listener or the next one
      // double-handles every socket.
      const close = () => {
        relay?.close();
        relay = null;
      };
      server.httpServer.once('close', close);
      return () => undefined;
    },
    closeBundle() {
      relay?.close();
      relay = null;
    },
  };
}
