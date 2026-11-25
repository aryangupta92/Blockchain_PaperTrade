import { getPrisma } from '../infrastructure/database';
import { getEnv } from '../infrastructure/envConfig';
import {
  buildTotpUri,
  decryptSecret,
  encryptSecret,
  generateTotpSecret,
  hashPassword,
  signJwt,
  verifyJwt,
  verifyPassword,
  verifyTotpCode,
} from '../infrastructure/encryptionAndJwt';

const ACCESS_TTL_SEC = 60 * 30; // 30 minutes
const REFRESH_TTL_SEC = 60 * 60 * 24 * 7; // 7 days

export class AuthError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  constructor(message: string, statusCode = 400, code = 'AUTH_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function formatUserProfile(user: {
  id: string;
  email: string;
  fullName: string;
  role: string;
  totpEnabled: boolean;
  kycStatus: string;
  sebiRiskAckAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    totpEnabled: user.totpEnabled,
    kycStatus: user.kycStatus,
    sebiRiskAckAt: user.sebiRiskAckAt ? user.sebiRiskAckAt.toISOString() : null,
    createdAt: user.createdAt.toISOString(),
  };
}

function issueTokenPair(user: { id: string; email: string; role: string }) {
  const env = getEnv();
  const accessToken = signJwt(
    { sub: user.id, email: user.email, role: user.role, type: 'access' },
    env.JWT_SECRET,
    ACCESS_TTL_SEC
  );
  const refreshToken = signJwt(
    { sub: user.id, email: user.email, role: user.role, type: 'refresh' },
    env.JWT_REFRESH_SECRET,
    REFRESH_TTL_SEC
  );
  return { accessToken, refreshToken, expiresInSec: ACCESS_TTL_SEC };
}

export async function registerUser(input: {
  email: string;
  fullName: string;
  password: string;
  acceptSebiRiskDisclosure: boolean;
  ipAddress?: string;
}) {
  if (!input.acceptSebiRiskDisclosure) {
    throw new AuthError(
      'You must acknowledge the SEBI derivatives risk disclosure and demo trading disclaimer to register.',
      400,
      'RISK_DISCLOSURE_REQUIRED'
    );
  }

  const email = input.email.trim().toLowerCase();
  const prisma = getPrisma();

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new AuthError('An account with this email already exists.', 409, 'EMAIL_EXISTS');
  }

  const passwordHash = hashPassword(input.password);
  const now = new Date();

  // Atomically create User + BOTH zero-balance DEMO and REAL accounts (Section 2)
  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        fullName: input.fullName.trim(),
        passwordHash,
        role: 'USER',
        sebiRiskAckAt: now,
        accounts: {
          create: [
            { mode: 'DEMO', cashBalance: '0.00', blockedMargin: '0.00', resetEpoch: 1 },
            { mode: 'REAL', cashBalance: '0.00', blockedMargin: '0.00', resetEpoch: 1 },
          ],
        },
        watchlists: {
          create: [
            { name: 'Equities', segment: 'EQ', symbolsJson: JSON.stringify(['RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK']) },
            { name: 'Indices & F&O', segment: 'FNO', symbolsJson: JSON.stringify(['NIFTY', 'BANKNIFTY', 'SENSEX']) },
            { name: 'ETFs', segment: 'ETF', symbolsJson: JSON.stringify(['NIFTYBEES', 'GOLDBEES', 'SILVERBEES']) },
            { name: 'Commodities', segment: 'COMM', symbolsJson: JSON.stringify(['GOLD', 'SILVER', 'CRUDEOIL']) },
          ],
        },
      },
      include: { accounts: true },
    });

    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: 'USER_REGISTERED',
        entity: 'User',
        entityId: user.id,
        details: JSON.stringify({ accountsProvisioned: ['DEMO', 'REAL'], startingBalance: '0.00' }),
        ipAddress: input.ipAddress,
      },
    });

    return user;
  });

  const tokens = issueTokenPair(created);
  return {
    user: formatUserProfile(created),
    accounts: created.accounts,
    ...tokens,
  };
}

export async function loginUser(input: {
  email: string;
  password: string;
  totpCode?: string;
  ipAddress?: string;
}) {
  const email = input.email.trim().toLowerCase();
  const prisma = getPrisma();

  const user = await prisma.user.findUnique({
    where: { email },
    include: { accounts: true },
  });

  if (!user || !verifyPassword(input.password, user.passwordHash)) {
    throw new AuthError('Invalid email or password.', 401, 'INVALID_CREDENTIALS');
  }

  if (user.totpEnabled) {
    if (!input.totpCode) {
      throw new AuthError('Two-factor authentication code required.', 401, 'TOTP_REQUIRED');
    }
    if (!user.totpSecretEncrypted) {
      throw new AuthError('2FA configuration error.', 500, 'TOTP_MISCONFIGURED');
    }
    const secret = decryptSecret(user.totpSecretEncrypted, getEnv().ENCRYPTION_KEY);
    if (!verifyTotpCode(secret, input.totpCode)) {
      throw new AuthError('Invalid two-factor authentication code.', 401, 'INVALID_TOTP');
    }
  }

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'USER_LOGIN',
      entity: 'User',
      entityId: user.id,
      ipAddress: input.ipAddress,
    },
  });

  const tokens = issueTokenPair(user);
  return {
    user: formatUserProfile(user),
    accounts: user.accounts,
    ...tokens,
  };
}

export async function refreshSession(refreshToken: string) {
  const env = getEnv();
  let payload;
  try {
    payload = verifyJwt(refreshToken, env.JWT_REFRESH_SECRET, 'refresh');
  } catch {
    throw new AuthError('Refresh token invalid or expired.', 401, 'INVALID_REFRESH');
  }

  const prisma = getPrisma();
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    include: { accounts: true },
  });
  if (!user) throw new AuthError('User not found.', 401, 'USER_NOT_FOUND');

  const tokens = issueTokenPair(user);
  return {
    user: formatUserProfile(user),
    accounts: user.accounts,
    ...tokens,
  };
}

export async function getUserProfile(userId: string) {
  const prisma = getPrisma();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { accounts: true },
  });
  if (!user) throw new AuthError('User not found.', 404, 'USER_NOT_FOUND');
  return {
    user: formatUserProfile(user),
    accounts: user.accounts,
  };
}

export async function setupTotp(userId: string) {
  const prisma = getPrisma();
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AuthError('User not found.', 404, 'USER_NOT_FOUND');

  const secret = generateTotpSecret();
  const encrypted = encryptSecret(secret, getEnv().ENCRYPTION_KEY);
  await prisma.user.update({
    where: { id: userId },
    data: { totpSecretEncrypted: encrypted, totpEnabled: false },
  });

  return {
    secret,
    otpauthUri: buildTotpUri(secret, user.email),
    message: 'Scan or enter the secret in your Authenticator app, then call /auth/totp/enable with a 6-digit code.',
  };
}

export async function enableTotp(userId: string, code: string) {
  const prisma = getPrisma();
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.totpSecretEncrypted) {
    throw new AuthError('Run 2FA setup before enabling.', 400, 'TOTP_NOT_INITIALIZED');
  }

  const secret = decryptSecret(user.totpSecretEncrypted, getEnv().ENCRYPTION_KEY);
  if (!verifyTotpCode(secret, code)) {
    throw new AuthError('Invalid 6-digit verification code.', 400, 'INVALID_TOTP');
  }

  await prisma.user.update({
    where: { id: userId },
    data: { totpEnabled: true },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: 'TOTP_ENABLED',
      entity: 'User',
      entityId: userId,
    },
  });

  return { totpEnabled: true };
}
