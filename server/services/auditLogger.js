/**
 * auditLogger.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Centralized, immutable audit logging service.
 * All important financial actions are persisted to the AuditLog table.
 * Never throws — audit logging must not break the main business flow.
 */

'use strict';

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const ACTIONS = {
  // Auth
  LOGIN:                  'LOGIN',
  LOGOUT:                 'LOGOUT',
  REGISTER:               'REGISTER',
  LOGIN_FAILED:           'LOGIN_FAILED',
  PASSWORD_CHANGED:       'PASSWORD_CHANGED',

  // Orders
  ORDER_CREATED:          'ORDER_CREATED',
  ORDER_FILLED:           'ORDER_FILLED',
  ORDER_REJECTED:         'ORDER_REJECTED',
  ORDER_CANCELLED:        'ORDER_CANCELLED',
  ORDER_MODIFIED:         'ORDER_MODIFIED',
  ORDER_FAILED:           'ORDER_FAILED',

  // Subscription
  SUBSCRIPTION_PURCHASED: 'SUBSCRIPTION_PURCHASED',
  SUBSCRIPTION_EXPIRED:   'SUBSCRIPTION_EXPIRED',

  // Risk
  RISK_LIMIT_HIT:         'RISK_LIMIT_HIT',
  RISK_OVERRIDE:          'RISK_OVERRIDE',

  // Watchlist
  WATCHLIST_CREATED:      'WATCHLIST_CREATED',
  WATCHLIST_DELETED:      'WATCHLIST_DELETED',

  // Alert
  ALERT_CREATED:          'ALERT_CREATED',
  ALERT_TRIGGERED:        'ALERT_TRIGGERED',
  ALERT_DELETED:          'ALERT_DELETED',

  // System
  SYSTEM_ERROR:           'SYSTEM_ERROR',
};

/**
 * Log an audit event. Never throws.
 *
 * @param {object} params
 * @param {string} [params.userId]
 * @param {string} params.action    - One of ACTIONS constants
 * @param {string} [params.entity]  - Model name e.g. 'Order'
 * @param {string} [params.entityId]
 * @param {string} [params.ipAddress]
 * @param {string} [params.userAgent]
 * @param {object} [params.metadata]
 */
async function log({ userId, action, entity, entityId, ipAddress, userAgent, metadata }) {
  try {
    await prisma.auditLog.create({
      data: {
        userId:    userId || null,
        action,
        entity:    entity || null,
        entityId:  entityId || null,
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
        metadata:  metadata ? JSON.stringify(metadata) : null,
      }
    });
  } catch (err) {
    // Never let audit logging crash the app
    console.error('[AuditLog] Failed to write audit log:', err.message);
  }
}

/**
 * Express middleware factory — logs any request metadata.
 */
function requestContext(req) {
  return {
    ipAddress: req.ip || req.headers['x-forwarded-for'] || null,
    userAgent: req.headers['user-agent'] || null,
    userId:    req.user?.id || null,
  };
}

module.exports = { log, requestContext, ACTIONS };
