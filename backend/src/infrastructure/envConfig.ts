import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { z } from 'zod';

const ROOT_ENV_PATH = path.resolve(__dirname, '../../../.env');

// Load workspace root .env first, then local .env if present
dotenv.config({ path: ROOT_ENV_PATH });
dotenv.config();

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(5100),
  WEB_ORIGIN: z.string().default('http://localhost:5174'),
  COOKIE_SAME_SITE: z.enum(['lax', 'none', 'strict']).optional(),
  DATABASE_URL: z.string().min(1).default('file:./dev.db'),
  REDIS_URL: z.string().optional().default(''),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters').default('blocktrade_dev_jwt_secret_min_32_characters_long'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters').default('blocktrade_dev_refresh_secret_32_characters_long'),
  ENCRYPTION_KEY: z.string().min(32, 'ENCRYPTION_KEY must be at least 32 hex chars').default('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'),
  MARKET_DATA_CLIENT_ID: z.string().optional().default(''),
  MARKET_DATA_API_KEY: z.string().optional().default(''),
  MARKET_DATA_API_SECRET: z.string().optional().default(''),
  MARKET_DATA_ACCESS_TOKEN: z.string().optional().default(''),
  MARKET_DATA_PIN: z.string().optional().default(''),
  MARKET_DATA_TOTP_SECRET: z.string().optional().default(''),
  BLOCKCHAIN_POW_DIFFICULTY: z.coerce.number().int().min(1).max(4).default(2),
  EVM_RPC_URL: z.string().optional().default(''),
  EVM_CONTRACT_ADDRESS: z.string().optional().default(''),
  AI_COACH_PROVIDER: z.enum(['local-rag', 'ollama', 'gemini']).default('local-rag'),
  OLLAMA_BASE_URL: z.string().optional().default('http://127.0.0.1:11434'),
  OLLAMA_MODEL: z.string().optional().default('blocktrade-coach'),
  GEMINI_API_KEY: z.string().optional().default(''),
  GEMINI_MODEL: z.string().optional().default('gemini-2.0-flash'),
});

export type AppEnv = z.infer<typeof EnvSchema>;

let cachedEnv: AppEnv | null = null;
let cachedEnvMtimeMs = 0;

function syncRootEnvFileIfModified(): boolean {
  try {
    if (!fs.existsSync(ROOT_ENV_PATH)) return false;
    const mtime = fs.statSync(ROOT_ENV_PATH).mtimeMs;
    if (cachedEnv && mtime <= cachedEnvMtimeMs) return false;
    const parsed = dotenv.parse(fs.readFileSync(ROOT_ENV_PATH, 'utf8'));
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string') process.env[k] = v;
    }
    cachedEnvMtimeMs = mtime;
    return true;
  } catch {
    return false;
  }
}

export function getEnv(): AppEnv {
  const modified = syncRootEnvFileIfModified();
  if (cachedEnv && !modified) return cachedEnv;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Environment validation failed: ${details}`);
  }
  cachedEnv = parsed.data;
  return cachedEnv;
}

function normalizeOriginUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/**
 * Returns the writable data directory for runtime caches (uses /tmp on Vercel Serverless).
 */
export function getRuntimeDataDir(): string {
  if (process.env.DATA_DIR) return path.resolve(process.env.DATA_DIR);
  if (process.env.VERCEL) return '/tmp/blocktrade-data';
  return path.resolve(__dirname, '../../data');
}

/**
 * Parses comma-separated WEB_ORIGIN entries plus Vercel deployment hosts into normalized origin strings.
 */
export function getAllowedWebOrigins(env: AppEnv = getEnv()): string[] {
  const candidates = [
    ...env.WEB_ORIGIN.split(','),
    process.env.VERCEL_URL || '',
    process.env.VERCEL_PROJECT_PRODUCTION_URL || '',
    process.env.VERCEL_BRANCH_URL || '',
  ];
  const out = new Set<string>();
  for (const candidate of candidates) {
    const normalized = normalizeOriginUrl(candidate);
    if (normalized) out.add(normalized);
  }
  return [...out];
}
