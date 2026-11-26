import { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  enableTotp,
  getUserProfile,
  loginUser,
  refreshSession,
  registerUser,
  setupTotp,
} from '../services/authService';
import { formatAccount } from '../services/accountService';
import { parseCookieHeader, requireAuth } from '../infrastructure/authMiddleware';
import { getEnv } from '../infrastructure/envConfig';

const REFRESH_COOKIE_NAME = 'tb_refresh';

const RegisterBody = z.object({
  email: z.string().email(),
  fullName: z.string().min(2).max(100),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain an uppercase letter')
    .regex(/[a-z]/, 'Password must contain a lowercase letter')
    .regex(/[0-9]/, 'Password must contain a number'),
  acceptSebiRiskDisclosure: z.boolean(),
});

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totpCode: z.string().optional(),
});

const EnableTotpBody = z.object({
  code: z.string().regex(/^\d{6}$/, 'Enter a valid 6-digit authenticator code'),
});

function resolveCookiePolicy(): { sameSite: 'Lax' | 'None' | 'Strict'; secure: boolean } {
  const env = getEnv();
  const isProd = env.NODE_ENV === 'production';
  const sameSite: 'Lax' | 'None' | 'Strict' =
    env.COOKIE_SAME_SITE === 'none'
      ? 'None'
      : env.COOKIE_SAME_SITE === 'strict'
        ? 'Strict'
        : env.COOKIE_SAME_SITE === 'lax'
          ? 'Lax'
          : isProd
            ? 'None'
            : 'Lax';
  return { sameSite, secure: isProd || sameSite === 'None' };
}

function setRefreshCookie(reply: FastifyReply, refreshToken: string) {
  const { sameSite, secure } = resolveCookiePolicy();
  const attrs = [
    `${REFRESH_COOKIE_NAME}=${encodeURIComponent(refreshToken)}`,
    'HttpOnly',
    'Path=/api/v1/auth',
    `SameSite=${sameSite}`,
    `Max-Age=${60 * 60 * 24 * 7}`,
  ];
  if (secure) attrs.push('Secure');
  reply.header('Set-Cookie', attrs.join('; '));
}

function clearRefreshCookie(reply: FastifyReply) {
  const { sameSite, secure } = resolveCookiePolicy();
  const attrs = [
    `${REFRESH_COOKIE_NAME}=`,
    'HttpOnly',
    'Path=/api/v1/auth',
    `SameSite=${sameSite}`,
    'Max-Age=0',
  ];
  if (secure) attrs.push('Secure');
  reply.header('Set-Cookie', attrs.join('; '));
}

export async function authRoutes(app: FastifyInstance) {
  app.post('/register', async (req, reply) => {
    const parsed = RegisterBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: parsed.error.issues[0]?.message || 'Invalid registration data',
        details: parsed.error.issues,
      });
    }
    const res = await registerUser({
      ...parsed.data,
      ipAddress: req.ip,
    });
    setRefreshCookie(reply, res.refreshToken);
    return reply.status(201).send({
      user: res.user,
      accounts: res.accounts.map(formatAccount),
      accessToken: res.accessToken,
      expiresInSec: res.expiresInSec,
    });
  });

  app.post('/login', async (req, reply) => {
    const parsed = LoginBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Valid email and password are required' });
    }
    const res = await loginUser({
      ...parsed.data,
      ipAddress: req.ip,
    });
    setRefreshCookie(reply, res.refreshToken);
    return reply.send({
      user: res.user,
      accounts: res.accounts.map(formatAccount),
      accessToken: res.accessToken,
      expiresInSec: res.expiresInSec,
    });
  });

  app.post('/refresh', async (req, reply) => {
    const cookies = parseCookieHeader(req.headers.cookie);
    const token = cookies[REFRESH_COOKIE_NAME];
    if (!token) {
      return reply.status(401).send({ error: 'No refresh session cookie present', code: 'NO_REFRESH' });
    }
    const res = await refreshSession(token);
    setRefreshCookie(reply, res.refreshToken);
    return reply.send({
      user: res.user,
      accounts: res.accounts.map(formatAccount),
      accessToken: res.accessToken,
      expiresInSec: res.expiresInSec,
    });
  });

  app.post('/logout', async (_req, reply) => {
    clearRefreshCookie(reply);
    return reply.send({ ok: true });
  });

  app.get('/me', { preHandler: [requireAuth] }, async (req) => {
    const res = await getUserProfile(req.authUser!.id);
    return {
      user: res.user,
      accounts: res.accounts.map(formatAccount),
    };
  });

  app.post('/totp/setup', { preHandler: [requireAuth] }, async (req) => {
    return setupTotp(req.authUser!.id);
  });

  app.post('/totp/enable', { preHandler: [requireAuth] }, async (req, reply) => {
    const parsed = EnableTotpBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message || 'Invalid code' });
    }
    return enableTotp(req.authUser!.id, parsed.data.code);
  });
}
