const jwt = require('jsonwebtoken');

function getSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is required in production. Set it in your environment.');
  }
  console.warn('[auth] JWT_SECRET not set — using dev-only fallback. Set JWT_SECRET in .env for any shared env.');
  return 'blocktrade_dev_only_secret_change_me';
}
const SECRET = getSecret();

module.exports = (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    const payload = jwt.verify(auth.split(' ')[1], SECRET);
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};
