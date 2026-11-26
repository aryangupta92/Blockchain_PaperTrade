import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../..');
const BACKEND_DIR = path.resolve(__dirname, '..');
const PRISMA_DIR = path.join(BACKEND_DIR, 'prisma');
const SOURCE_SCHEMA = path.join(PRISMA_DIR, 'schema.prisma');
const GENERATED_SCHEMA = path.join(PRISMA_DIR, 'schema.generated.prisma');

const args = new Set(process.argv.slice(2));
const shouldPush = args.has('--push');
const skipGenerate = args.has('--skip-generate');
const isVercel = args.has('--vercel') || Boolean(process.env.VERCEL) || Boolean(process.env.PRISMA_INCLUDE_RHEL);

function cleanEnvUrl(val) {
  return String(val || '').trim().replace(/^['"]+|['"]+$/g, '');
}

function resolvePostgresPushUrl(pooledOrDirect) {
  const explicitDirect = cleanEnvUrl(process.env.DIRECT_URL || process.env.POSTGRES_URL_NON_POOLING || '');
  if (/^postgres(ql)?:\/\//i.test(explicitDirect)) {
    return explicitDirect;
  }
  try {
    const u = new URL(pooledOrDirect);
    if (u.hostname.includes('-pooler.') && u.hostname.endsWith('neon.tech')) {
      u.hostname = u.hostname.replace('-pooler.', '.');
      u.searchParams.delete('pgbouncer');
      return u.toString();
    }
  } catch {
    // Fall through to primary DATABASE_URL
  }
  return null;
}

const rawDbUrl = cleanEnvUrl(
  process.env.DATABASE_URL || process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL || ''
);
const isPostgres = /^postgres(ql)?:\/\//i.test(rawDbUrl);

function runPrisma(prismaArgs, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  let prismaCli = null;
  try {
    const req = createRequire(path.join(BACKEND_DIR, 'package.json'));
    prismaCli = req.resolve('prisma/build/index.js');
  } catch {
    prismaCli = null;
  }

  if (prismaCli) {
    execFileSync(process.execPath, [prismaCli, ...prismaArgs], {
      cwd: BACKEND_DIR,
      env,
      stdio: 'inherit',
    });
    return;
  }

  execFileSync('npx', ['prisma', ...prismaArgs], {
    cwd: BACKEND_DIR,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

let schemaText = fs.readFileSync(SOURCE_SCHEMA, 'utf8');

if (isPostgres) {
  schemaText = schemaText.replace(/provider\s*=\s*"sqlite"/, 'provider = "postgresql"');
}

if (isVercel && !schemaText.includes('binaryTargets')) {
  schemaText = schemaText.replace(
    /(generator\s+client\s*\{[^}]*provider\s*=\s*"prisma-client-js")/,
    '$1\n  binaryTargets = ["native", "rhel-openssl-3.0.x", "debian-openssl-3.0.x"]'
  );
}

fs.writeFileSync(GENERATED_SCHEMA, schemaText, 'utf8');

const effectiveDbUrl = isPostgres
  ? rawDbUrl
  : isVercel
    ? 'file:./template.db'
    : rawDbUrl || 'file:./dev.db';

if (!isPostgres && !isVercel) {
  const filePart = effectiveDbUrl.replace(/^file:/, '').split('?')[0];
  const resolvedDbPath = path.isAbsolute(filePart) ? filePart : path.resolve(PRISMA_DIR, filePart);
  fs.mkdirSync(path.dirname(resolvedDbPath), { recursive: true });
}

console.log(
  `[prepare-prisma] target=${isPostgres ? 'postgresql' : 'sqlite'} vercel=${isVercel} push=${shouldPush} root=${path.basename(ROOT_DIR)}`
);

if (!skipGenerate) {
  runPrisma(['generate', `--schema=${GENERATED_SCHEMA}`], { DATABASE_URL: effectiveDbUrl });
}

if (shouldPush) {
  if (isPostgres) {
    const directUrl = resolvePostgresPushUrl(effectiveDbUrl);
    if (directUrl && directUrl !== effectiveDbUrl) {
      try {
        runPrisma(['db', 'push', `--schema=${GENERATED_SCHEMA}`, '--skip-generate'], {
          DATABASE_URL: directUrl,
        });
      } catch {
        console.warn('[prepare-prisma] Direct Postgres push failed, retrying with primary DATABASE_URL...');
        runPrisma(['db', 'push', `--schema=${GENERATED_SCHEMA}`, '--skip-generate'], {
          DATABASE_URL: effectiveDbUrl,
        });
      }
    } else {
      runPrisma(['db', 'push', `--schema=${GENERATED_SCHEMA}`, '--skip-generate'], {
        DATABASE_URL: effectiveDbUrl,
      });
    }
  } else {
    runPrisma(['db', 'push', `--schema=${GENERATED_SCHEMA}`, '--skip-generate'], {
      DATABASE_URL: effectiveDbUrl,
    });
  }
}
