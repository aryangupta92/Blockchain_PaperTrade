import { getEnv } from './infrastructure/envConfig';
import { buildApp } from './app';
import { blockchainService } from './services/blockchainAuditService';
import { marketDataService } from './services/market-data/marketDataService';
import { attachMarketWsGateway } from './services/market-data/webSocketBroadcastGateway';
import { omsTickMonitor } from './services/trading-oms/restingOrderTickMonitor';
import { startRegulatoryWatchScheduler } from './services/regulatoryWatchService';

async function main() {
  const env = getEnv();
  const chainReport = await blockchainService.initialize();
  const app = await buildApp();

  await app.listen({ port: env.PORT, host: '0.0.0.0' });

  // Attach multiplexed /ws/market fan-out gateway, daily master refresh, OMS monitor & Regulatory Watch
  attachMarketWsGateway(app.server);
  marketDataService.startDailyScheduler();
  omsTickMonitor.start();
  startRegulatoryWatchScheduler();

  console.log(
    `[API] Indian Broker Platform listening on http://localhost:${env.PORT} | WS /ws/market | Chain valid=${chainReport.valid} (${chainReport.totalBlocks} blocks)`
  );
}

main().catch((err) => {
  console.error('[API] Fatal startup error:', err.message);
  process.exit(1);
});
