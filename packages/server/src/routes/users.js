/**
 * User Management API Routes
 *
 * GET    /api/users              list all users
 * GET    /api/users/:userId      get single user with resolved features
 * POST   /api/users              create/upsert user
 * PATCH  /api/users/:userId      update role or configs
 * PATCH  /api/users/:userId/features/:featureId   set a single feature toggle
 * DELETE /api/users/:userId      remove user
 */

const express = require('express');
const router = express.Router();
const users = require('../db/users');
const { listFeatures, resolveFeatures, getFeature } = require('../features');
const logger = require('../utils/logger');
const { safeErrorMessage } = require('../utils/safeError');

// ── List available features (must be before /:userId routes) ───────────────

router.get('/_features', (_req, res) => {
  res.json({ success: true, features: listFeatures() });
});

// ── List all users ──────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const { role, limit, offset } = req.query;
    const list = await users.list({
      role,
      limit: Math.min(parseInt(limit) || 100, 500),
      offset: Math.max(parseInt(offset) || 0, 0),
    });
    res.json({ success: true, users: list.map(u => formatUser(u, true)) });
  } catch (err) {
    logger.error('List users failed', { error: err.message });
    res.status(500).json({ error: safeErrorMessage(err) });
  }
});

// ── Get single user ─────────────────────────────────────────────────────────

router.get('/:userId', async (req, res) => {
  try {
    const user = await users.getById(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ success: true, user: formatUser(user, true) });
  } catch (err) {
    logger.error('Get user failed', { error: err.message });
    res.status(500).json({ error: safeErrorMessage(err) });
  }
});

// ── Create / upsert user ────────────────────────────────────────────────────

const VALID_ROLES = ['superadmin', 'admin', 'user'];

router.post('/', async (req, res) => {
  try {
    const { userId, openId, name, email, phone, role, configs } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    if (role && !VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: `Invalid role: ${role}. Must be one of: ${VALID_ROLES.join(', ')}` });
    }

    const user = await users.upsert({ userId, openId, name, email, phone, role, configs });
    logger.info('User upserted', { userId, role: user.role });
    res.json({ success: true, user: formatUser(user, true) });
  } catch (err) {
    logger.error('Upsert user failed', { error: err.message });
    res.status(400).json({ error: safeErrorMessage(err) });
  }
});

// ── Update user (role and/or configs) ──────────────────────────────────────

router.patch('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { role, configs, name, email, phone } = req.body;

    let user = await users.getById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (role !== undefined) user = await users.setRole(userId, role);
    if (configs) user = await users.updateConfigs(userId, configs);
    if (name !== undefined || email !== undefined || phone !== undefined) {
      user = await users.updateProfile(userId, { name, email, phone });
    }

    logger.info('User updated', { userId });
    res.json({ success: true, user: formatUser(user, true) });
  } catch (err) {
    logger.error('Update user failed', { error: err.message });
    res.status(400).json({ error: safeErrorMessage(err) });
  }
});

// ── Set a single feature toggle ─────────────────────────────────────────────

router.patch('/:userId/features/:featureId', async (req, res) => {
  try {
    const { userId, featureId } = req.params;
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean' });
    }
    if (!getFeature(featureId)) {
      return res.status(400).json({ error: `Unknown feature: ${featureId}` });
    }

    const user = await users.setFeature(userId, featureId, enabled);
    logger.info('Feature updated', { userId, featureId, enabled });
    res.json({ success: true, user: formatUser(user, true) });
  } catch (err) {
    logger.error('Set feature failed', { error: err.message });
    res.status(400).json({ error: safeErrorMessage(err) });
  }
});

// ── Delete user ─────────────────────────────────────────────────────────────

router.delete('/:userId', async (req, res) => {
  try {
    const removed = await users.remove(req.params.userId);
    if (!removed) return res.status(404).json({ error: 'User not found' });
    logger.info('User removed', { userId: req.params.userId });
    res.json({ success: true });
  } catch (err) {
    logger.error('Remove user failed', { error: err.message });
    res.status(500).json({ error: safeErrorMessage(err) });
  }
});

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Format a user row for API output.
 * If `withResolved`, include the fully resolved feature map.
 */
function formatUser(user, withResolved = false) {
  const out = {
    id: user.id,
    userId: user.user_id,
    openId: user.open_id,
    feishuUserId: user.feishu_user_id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    configs: user.configs,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
  if (withResolved) {
    out.resolvedFeatures = resolveFeatures(user);
  }
  return out;
}

module.exports = router;
