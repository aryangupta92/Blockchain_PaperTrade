import { FastifyInstance } from 'fastify';
import {
  getCommodityContracts,
  getEtfCatalog,
  getMarketAnalytics,
} from '../services/market-data/etfsAndCommoditiesService';

export async function segmentRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { category?: string; quotes?: string } }>('/etfs', async (req) => {
    const includeQuotes = req.query.quotes !== 'false';
    return getEtfCatalog(req.query.category, includeQuotes);
  });

  app.get<{ Querystring: { group?: string; kind?: string; quotes?: string } }>('/commodities', async (req) => {
    const includeQuotes = req.query.quotes !== 'false';
    return getCommodityContracts({
      group: req.query.group,
      kind: req.query.kind,
      includeQuotes,
    });
  });

  app.get('/analytics', async () => {
    return getMarketAnalytics();
  });
}
