import { FastifyReply, FastifyRequest } from 'fastify';
import { getEnv } from './envConfig';
import { JwtPayload, verifyJwt } from './encryptionAndJwt';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthenticatedUser;
  }
}

export function parseCookieHeader(cookieHeader?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const val = decodeURIComponent(part.slice(eq + 1).trim());
    out[key] = val;
  }
  return out;
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    reply.status(401).send({ error: 'Authentication required', code: 'UNAUTHORIZED' });
    return;
  }
  const token = authHeader.slice(7).trim();
  try {
    const payload: JwtPayload = verifyJwt(token, getEnv().JWT_SECRET, 'access');
    req.authUser = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
    };
  } catch {
    reply.status(401).send({ error: 'Session expired or invalid token', code: 'UNAUTHORIZED' });
    return;
  }
}

export function requireRole(...roles: string[]) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await requireAuth(req, reply);
    if (reply.sent) return;
    if (!req.authUser || !roles.includes(req.authUser.role)) {
      reply.status(403).send({ error: 'Insufficient permissions', code: 'FORBIDDEN' });
    }
  };
}
