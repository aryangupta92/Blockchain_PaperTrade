const fs = require('fs');
const path = require('path');

function ensureServerlessDatabase() {
  const rawUrl = String(
    process.env.DATABASE_URL || process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL || ''
  )
    .trim()
    .replace(/^['"]+|['"]+$/g, '');
  if (rawUrl && /^postgres(ql)?:\/\//i.test(rawUrl)) {
    let normalizedUrl = rawUrl;
    if ((rawUrl.includes('-pooler.') || rawUrl.includes(':6543')) && !/([?&])pgbouncer=/i.test(rawUrl)) {
      normalizedUrl = `${rawUrl}${rawUrl.includes('?') ? '&' : '?'}pgbouncer=true&connection_limit=1`;
    }
    process.env.DATABASE_URL = normalizedUrl;
    return;
  }
  if (!process.env.VERCEL) {
    return;
  }
  const runtimeDbPath = '/tmp/blocktrade.db';
  if (!fs.existsSync(runtimeDbPath)) {
    const candidates = [
      path.resolve(__dirname, '../backend/prisma/template.db'),
      path.resolve(process.cwd(), 'backend/prisma/template.db'),
    ];
    const templatePath = candidates.find((p) => fs.existsSync(p));
    if (templatePath) {
      fs.copyFileSync(templatePath, runtimeDbPath);
    }
  }
  process.env.DATABASE_URL = `file:${runtimeDbPath}`;
}

function normalizeInjectUrl(rawUrl) {
  const urlObj = new URL(rawUrl || '/', 'http://localhost');
  const pathParam = urlObj.searchParams.get('__path');
  urlObj.searchParams.delete('__path');

  let pathname = urlObj.pathname;
  if (pathname === '/api/index' || pathname === '/api/index.js' || pathname === '/') {
    const suffix = (pathParam || '').replace(/^\/+/, '');
    pathname = suffix ? `/api/${suffix}` : '/api';
  } else if (pathParam && !pathname.startsWith('/api/')) {
    const suffix = pathParam.replace(/^\/+/, '');
    pathname = `/api/${suffix}`;
  }

  const search = urlObj.searchParams.toString();
  return search ? `${pathname}?${search}` : pathname;
}

async function readRawBody(req) {
  const method = (req.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') return undefined;

  if (req.rawBody !== undefined) {
    return Buffer.isBuffer(req.rawBody) ? req.rawBody : String(req.rawBody);
  }
  if (req.body !== undefined) {
    if (Buffer.isBuffer(req.body) || typeof req.body === 'string') return req.body;
    return JSON.stringify(req.body);
  }
  if (req.readableEnded) return undefined;

  return await new Promise((resolve, reject) => {
    const chunks = [];
    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => finish(chunks.length ? Buffer.concat(chunks) : undefined));
    req.on('close', () => finish(chunks.length ? Buffer.concat(chunks) : undefined));
    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

let cachedAppPromise = null;

async function getApp() {
  if (!cachedAppPromise) {
    cachedAppPromise = (async () => {
      ensureServerlessDatabase();
      const { buildApp } = require('../backend/dist/app');
      const { blockchainService } = require('../backend/dist/services/blockchainAuditService');
      await blockchainService.initialize();
      const app = await buildApp();
      await app.ready();
      return app;
    })().catch((err) => {
      cachedAppPromise = null;
      throw err;
    });
  }
  return cachedAppPromise;
}

async function handler(req, res) {
  try {
    const app = await getApp();
    const payload = await readRawBody(req);
    const headers = {};
    for (const [key, value] of Object.entries(req.headers || {})) {
      if (value === undefined) continue;
      const lower = key.toLowerCase();
      if (lower === 'content-length' || lower === 'transfer-encoding') continue;
      headers[lower] = value;
    }
    if (payload !== undefined && !headers['content-type']) {
      headers['content-type'] = 'application/json';
    }

    const response = await app.inject({
      method: req.method || 'GET',
      url: normalizeInjectUrl(req.url),
      headers,
      payload,
      remoteAddress:
        (headers['x-forwarded-for'] && String(headers['x-forwarded-for']).split(',')[0].trim()) ||
        req.socket?.remoteAddress ||
        '127.0.0.1',
    });

    res.statusCode = response.statusCode;
    for (const [key, value] of Object.entries(response.headers)) {
      if (value === undefined) continue;
      if (key.toLowerCase() === 'transfer-encoding') continue;
      res.setHeader(key, value);
    }
    res.end(response.rawPayload);
  } catch (err) {
    console.error('[api/index] Handler error:', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'API runtime error', code: 'SERVERLESS_ERROR' }));
    } else {
      res.end();
    }
  }
}

module.exports = handler;
module.exports.config = {
  api: {
    bodyParser: false,
  },
};
