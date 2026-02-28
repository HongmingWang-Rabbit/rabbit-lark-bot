const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const apiKeys = require('../db/apiKeys');
const { audit } = require('../db');
const logger = require('../utils/logger');
const { safeErrorMessage } = require('../utils/safeError');

/**
 * Require admin or superadmin role for all API key routes.
 */
router.use((req, res, next) => {
  const role = req.user?.role;
  if (role !== 'admin' && role !== 'superadmin') {
    return res.status(403).json({ error: 'Forbidden: admin role required' });
  }
  next();
});

/**
 * GET /api/api-keys — List all API keys
 */
router.get('/', async (req, res) => {
  try {
    const keys = await apiKeys.list();
    res.json(keys);
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err, 'Failed to list API keys') });
  }
});

/**
 * POST /api/api-keys — Create a new API key
 * Returns the raw key once; only the hash is stored.
 */
router.post('/', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Name is required' });
    }
    if (name.length > 100) {
      return res.status(400).json({ error: 'Name must be 100 characters or less' });
    }

    // Generate key: rlk_ + 32 hex chars
    const rawKey = 'rlk_' + crypto.randomBytes(16).toString('hex');
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const keyPrefix = rawKey.substring(0, 8); // "rlk_abcd"

    const createdBy = req.user?.sub || 'unknown';
    const row = await apiKeys.create(name.trim(), keyHash, keyPrefix, createdBy);

    audit.log({
      userId: createdBy,
      action: 'create_api_key',
      targetType: 'api_key',
      targetId: String(row.id),
      details: { name: name.trim(), keyPrefix },
    }).catch(() => {});

    logger.info('API key created', { id: row.id, name: name.trim(), createdBy });

    // Return raw key exactly once
    res.status(201).json({ ...row, key: rawKey });
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err, 'Failed to create API key') });
  }
});

/**
 * DELETE /api/api-keys/:id — Soft-revoke an API key
 */
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid key ID' });
    }

    const revoked = await apiKeys.revoke(id);
    if (!revoked) {
      return res.status(404).json({ error: 'Key not found or already revoked' });
    }

    const actor = req.user?.sub || 'unknown';
    audit.log({
      userId: actor,
      action: 'revoke_api_key',
      targetType: 'api_key',
      targetId: String(id),
      details: { name: revoked.name, keyPrefix: revoked.key_prefix },
    }).catch(() => {});

    logger.info('API key revoked', { id, name: revoked.name, actor });

    res.json({ success: true, revoked });
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err, 'Failed to revoke API key') });
  }
});

module.exports = router;
