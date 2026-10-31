const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function getSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is required in production. Set it in your environment.');
  }
  console.warn('[auth] JWT_SECRET not set — using dev-only fallback. Set JWT_SECRET in .env for any shared env.');
  return 'blocktrade_dev_only_secret_change_me';
}
const SECRET = getSecret();

// ─── REFRESH TOKEN ROTATION (HTTP-only cookie) ─────────────────────────────────
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');
const genRefreshToken = () => crypto.randomBytes(32).toString('hex');

const getRefreshTokenFromReq = (req) => {
  const header = req?.headers?.cookie;
  if (!header) return null;
  const part = header.split(';').map(s => s.trim()).find(s => s.startsWith('bt_refresh='));
  return part ? decodeURIComponent(part.slice('bt_refresh='.length)) : null;
};

const setRefreshCookie = (res, token) => {
  res.cookie('bt_refresh', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: REFRESH_TTL_MS,
  });
};

const issueRefreshToken = async (userId) => {
  const raw = genRefreshToken();
  await prisma.refreshToken.create({
    data: { userId, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + REFRESH_TTL_MS) },
  });
  return raw;
};

// ── POST /api/auth/register ───────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, phone, pan, dob } = req.body;
    if (!name || !email || !password || !phone) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const existingUser = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existingUser) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const hashedPwd = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        name,
        email: email.toLowerCase(),
        passwordHash: hashedPwd,
        planId: 'FREE',
        balance: Number(process.env.FREE_PLAN_BALANCE || 100000),
      }
    });

    const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, SECRET, { expiresIn: '7d' });
    const refreshToken = await issueRefreshToken(user.id);
    setRefreshCookie(res, refreshToken);
    const { passwordHash, ...safeUser } = user;
    res.status(201).json({ token, user: safeUser });
  } catch (err) {
    console.error('Register error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, SECRET, { expiresIn: '7d' });
    const refreshToken = await issueRefreshToken(user.id);
    setRefreshCookie(res, refreshToken);
    const { passwordHash, ...safeUser } = user;
    res.json({ token, user: safeUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', require('../middleware/auth'), async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { passwordHash, ...safeUser } = user;
    res.json(safeUser);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/auth/risk-disclosure ───────────────────────────────────────────
router.post('/risk-disclosure', require('../middleware/auth'), async (req, res) => {
  try {
    // Simulated risk disclosure acceptance
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// �"?�"? POST /api/auth/topup �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?
router.post('/topup', require('../middleware/auth'), async (req, res) => {
  try {
    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10000000) {
      return res.status(400).json({ error: 'Invalid amount' });
    }
    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { balance: { increment: amount } },
    });
    try {
      await prisma.auditLog.create({
        data: { userId: req.user.id, action: 'TOPUP', metadata: JSON.stringify({ amount }) },
      });
    } catch (_) { /* audit log optional */ }
    const { passwordHash, ...safeUser } = user;
    res.json({ balance: user.balance, user: safeUser, message: `Rs.${amount.toLocaleString('en-IN')} added` });
  } catch (err) {
    console.error('Topup error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// �?"?�?" POST /api/auth/refresh �?" rotate refresh token (httpOnly cookie) and issue new access JWT
router.post('/refresh', async (req, res) => {
  try {
    const raw = getRefreshTokenFromReq(req);
    if (!raw) return res.status(401).json({ error: 'Refresh token missing' });
    const tokenHash = hashToken(raw);
    const rt = await prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!rt || rt.revoked || rt.expiresAt < new Date()) {
      // Revoke the whole family on suspected reuse (rotation theft detection)
      if (rt?.userId) {
        await prisma.refreshToken.updateMany({ where: { userId: rt.userId, revoked: false }, data: { revoked: true } });
      }
      return res.status(401).json({ error: 'Refresh token invalid' });
    }
    await prisma.refreshToken.update({ where: { id: rt.id }, data: { revoked: true } });
    const user = await prisma.user.findUnique({ where: { id: rt.userId } });
    if (!user) return res.status(401).json({ error: 'User not found' });
    const nextRaw = await issueRefreshToken(user.id);
    setRefreshCookie(res, nextRaw);
    const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, SECRET, { expiresIn: '7d' });
    const { passwordHash, ...safeUser } = user;
    res.json({ token, user: safeUser });
  } catch (err) {
    console.error('Refresh error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// �?"?�?" POST /api/auth/logout �?" revoke refresh token + clear httpOnly cookie
router.post('/logout', async (req, res) => {
  try {
    const raw = getRefreshTokenFromReq(req);
    if (raw) {
      const tokenHash = hashToken(raw);
      await prisma.refreshToken.updateMany({ where: { tokenHash, revoked: false }, data: { revoked: true } });
    }
    res.clearCookie('bt_refresh', { path: '/api/auth' });
    res.json({ success: true });
  } catch (err) {
    console.error('Logout error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
