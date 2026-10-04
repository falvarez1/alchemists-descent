import type { Plugin } from 'vite';
import { networkInterfaces } from 'node:os';
import { attachDuelServer } from './server.ts';

export function duelPlugin(): Plugin {
  let relay: ReturnType<typeof attachDuelServer> | undefined;
  return {
    name: 'duel-lan',
    apply: 'serve',
    configureServer(server) {
      if (!server.httpServer) return;
      relay = attachDuelServer(server.httpServer);
      server.middlewares.use('/__duel-addresses', (_request, response) => {
        const address = server.httpServer?.address();
        const port = typeof address === 'object' && address ? address.port : server.config.server.port;
        const scheme = server.config.server.https ? 'https' : 'http';
        const addresses = Object.values(networkInterfaces())
          .flat()
          .filter((a) => a?.family === 'IPv4' && !a.internal)
          .map((a) => `${scheme}://${a!.address}:${port}/`);
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify(addresses));
      });
    },
    closeBundle() {
      relay?.close();
      relay = undefined;
    },
  };
}
