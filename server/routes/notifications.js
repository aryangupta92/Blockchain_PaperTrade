'use strict';
/**
 * routes/notifications.js — user notification inbox (backed by Prisma Notification model).
 *
 * GET  /api/notifications         -> { notifications, unreadCount }
 * POST /api/notifications/read    -> mark all read (or { ids: [...] })
 */
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

router.get('/', authMiddleware, async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: req.user.id },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      prisma.notification.count({ where: { userId: req.user.id, isRead: false } }),
    ]);
    res.json({ notifications, unreadCount });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/read', authMiddleware, async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
    if (ids && ids.length) {
      await prisma.notification.updateMany({
        where: { userId: req.user.id, id: { in: ids } },
        data: { isRead: true },
      });
    } else {
      await prisma.notification.updateMany({
        where: { userId: req.user.id, isRead: false },
        data: { isRead: true },
      });
    }
    const unreadCount = await prisma.notification.count({
      where: { userId: req.user.id, isRead: false },
    });
    res.json({ ok: true, unreadCount });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
