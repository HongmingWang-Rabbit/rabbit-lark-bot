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
      limit: limit ? parseInt(limit) : 100,
      offset: offset ? parseInt(offset) : 0,
    });
    res.json({ success: true, users: list.map(formatUser) });
  } catch (err) {
    logger.error('List users failed', { error: err.message });
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

// ── Create / upsert user ────────────────────────────────────────────────────

router.post('/', async (req, res) => {
  try {
    const { userId, openId, name, email, role, configs } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const user = await users.upsert({ userId, openId, name, email, role, configs });
    logger.info('User upserted', { userId, role: user.role });
    res.json({ success: true, user: formatUser(user, true) });
  } catch (err) {
    logger.error('Upsert user failed', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// ── Update user (role and/or configs) ──────────────────────────────────────

router.patch('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { role, configs } = req.body;

    let user = await users.getById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (role) user = await users.setRole(userId, role);
    if (configs) user = await users.updateConfigs(userId, configs);

    logger.info('User updated', { userId });
    res.json({ success: true, user: formatUser(user, true) });
  } catch (err) {
    logger.error('Update user failed', { error: err.message });
    res.status(400).json({ error: err.message });
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
    res.status(400).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    name: user.name,
    email: user.email,
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
