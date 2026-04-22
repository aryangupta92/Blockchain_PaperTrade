const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const SECRET = process.env.JWT_SECRET || 'blocktrade_secret_2024';
const DB_PATH = path.join(__dirname, '../data/users.json');

function readDB() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch { return { users: [] }; }
}

function writeDB(data) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

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

    const db = readDB();
    if (db.users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const hashedPwd = await bcrypt.hash(password, 10);
    const user = {
      id: 'USR-' + Date.now(),
      name, email: email.toLowerCase(), phone,
      pan: pan || null, dob: dob || null,
      passwordHash: hashedPwd,
      kycStatus: pan ? 'pending' : 'not_started',
      createdAt: new Date().toISOString(),
      subscription: null,
      riskDisclosureAccepted: false,
      sebiRegistered: true, // simulated
    };

    db.users.push(user);
    writeDB(db);

    const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, SECRET, { expiresIn: '7d' });
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
    const db = readDB();
    const user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, SECRET, { expiresIn: '7d' });
    const { passwordHash, ...safeUser } = user;
    res.json({ token, user: safeUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', require('../middleware/auth'), (req, res) => {
  const db = readDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { passwordHash, ...safeUser } = user;
  res.json(safeUser);
});

// ── POST /api/auth/risk-disclosure ───────────────────────────────────────────
router.post('/risk-disclosure', require('../middleware/auth'), (req, res) => {
  const db = readDB();
  const idx = db.users.findIndex(u => u.id === req.user.id);
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  db.users[idx].riskDisclosureAccepted = true;
  db.users[idx].riskDisclosureAt = new Date().toISOString();
  writeDB(db);
  res.json({ success: true });
});

module.exports = router;
