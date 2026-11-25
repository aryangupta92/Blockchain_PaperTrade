import { Server as HttpServer } from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import { NormalizedQuote } from '@broker/shared';
import { resolveInstrument } from './instrumentMaster';
import { Depth20Update, liveFeed } from './liveWebSocketFeed';
import { marketDataService } from './marketDataService';

interface ClientState {
  socket: WebSocket;
  quoteIds: Set<string>;
  depth20Ids: Set<string>;
}

/**
 * Provider-neutral WebSocket Fan-Out Gateway (/ws/market).
 * Multiplexes ONE upstream market-data stream out to N browser clients.
 */
export function attachMarketWsGateway(httpServer: HttpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws/market' });
  const clients = new Set<ClientState>();

  const broadcastQuote = (quote: NormalizedQuote) => {
    const payload = JSON.stringify({ type: 'quote', data: quote });
    for (const c of clients) {
      if (c.socket.readyState === WebSocket.OPEN && c.quoteIds.has(quote.instrumentId)) {
        c.socket.send(payload);
      }
    }
  };

  const broadcastDepth20 = (depth: Depth20Update) => {
    const payload = JSON.stringify({ type: 'depth20', data: depth });
    for (const c of clients) {
      if (c.socket.readyState === WebSocket.OPEN && c.depth20Ids.has(depth.instrumentId)) {
        c.socket.send(payload);
      }
    }
  };

  const offQuote = liveFeed.onQuote(broadcastQuote);
  const offDepth20 = liveFeed.onDepth20(broadcastDepth20);

  wss.on('connection', (socket) => {
    const state: ClientState = {
      socket,
      quoteIds: new Set(),
      depth20Ids: new Set(),
    };
    clients.add(state);

    socket.send(JSON.stringify({ type: 'ready', timestamp: new Date().toISOString() }));

    socket.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          action?: string;
          symbols?: string[];
          symbol?: string;
        };

        if (msg.action === 'subscribe' && Array.isArray(msg.symbols)) {
          const list = msg.symbols.slice(0, 100);
          const resolved = (await Promise.all(list.map((s) => resolveInstrument(s)))).filter(
            (x): x is NonNullable<typeof x> => Boolean(x)
          );

          state.quoteIds.clear();
          resolved.forEach((inst) => state.quoteIds.add(inst.instrumentId));

          // Send instant snapshot (live WS cache or REST batch)
          const snapshots = await marketDataService.getQuotes(resolved.map((r) => r.instrumentId));
          for (const q of snapshots) {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ type: 'quote', data: q }));
            }
          }

          // Upgrade to upstream real-time tick stream (non-blocking)
          liveFeed.subscribe(resolved, 'full').catch(() => {});
        } else if (msg.action === 'subscribe_depth20' && msg.symbol) {
          const inst = await resolveInstrument(msg.symbol);
          if (inst) {
            state.depth20Ids.clear();
            state.depth20Ids.add(inst.instrumentId);
            const cached = liveFeed.getCachedDepth20(inst.instrumentId);
            if (cached && socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ type: 'depth20', data: cached }));
            }
            liveFeed.subscribeDepth20(inst).catch(() => {});
          }
        } else if (msg.action === 'unsubscribe_depth20') {
          state.depth20Ids.clear();
        }
      } catch {
        // Ignore malformed client payloads
      }
    });

    socket.on('close', () => {
      clients.delete(state);
    });
  });

  wss.on('close', () => {
    offQuote();
    offDepth20();
  });

  return wss;
}
