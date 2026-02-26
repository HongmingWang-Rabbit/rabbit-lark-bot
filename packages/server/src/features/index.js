/**
 * Feature Registry + Permission System
 *
 * Every feature the bot supports is declared here with:
 *   - id: unique key used in user configs
 *   - label: human-readable name
 *   - description: what it does
 *   - defaultFor: which roles get it by default ('all' | ['admin','superadmin'] | [])
 *   - adminOnly: if true, only admins can grant this to others
 *
 * Per-user override lives in users.configs.features:
 *   { "cuiban": true, "ai_chat": false, ... }
 *
 * Resolution order (highest wins):
 *   1. User's own configs.features[featureId]  (explicit override)
 *   2. Role default from FEATURES registry
 */

const FEATURES = {
  // ── 催办 (Reminder / Task) ─────────────────────────────────────────────────
  cuiban_view: {
    id: 'cuiban_view',
    label: '查看催办任务',
    description: '查看分配给自己的催办任务',
    defaultFor: 'all',
    adminOnly: false,
  },
  cuiban_create: {
    id: 'cuiban_create',
    label: '创建催办任务',
    description: '新建催办任务并分配给他人',
    defaultFor: ['admin', 'superadmin'],
    adminOnly: false,
  },
  cuiban_complete: {
    id: 'cuiban_complete',
    label: '完成催办任务',
    description: '标记自己的任务为已完成',
    defaultFor: 'all',
    adminOnly: false,
  },

  // ── History ────────────────────────────────────────────────────────────────
  history: {
    id: 'history',
    label: '历史记录',
    description: '查询聊天历史记录',
    defaultFor: ['admin', 'superadmin'],
    adminOnly: false,
  },

  // ── Admin ─────────────────────────────────────────────────────────────────
  user_manage: {
    id: 'user_manage',
    label: '用户管理',
    description: '添加/删除用户、修改用户配置',
    defaultFor: ['admin', 'superadmin'],
    adminOnly: true,
  },
  feature_manage: {
    id: 'feature_manage',
    label: '功能权限管理',
    description: '修改其他用户的功能开关',
    defaultFor: ['superadmin'],
    adminOnly: true,
  },
  system_config: {
    id: 'system_config',
    label: '系统配置',
    description: '修改全局系统配置',
    defaultFor: ['superadmin'],
    adminOnly: true,
  },
};

/**
 * Get all registered features as an array
 */
function listFeatures() {
  return Object.values(FEATURES);
}

/**
 * Get a single feature definition by id
 */
function getFeature(featureId) {
  return FEATURES[featureId] || null;
}

/**
 * Check whether a role gets a feature by default (without per-user override).
 * @param {string} role - 'user' | 'admin' | 'superadmin'
 * @param {string} featureId
 */
function roleHasFeatureByDefault(role, featureId) {
  const feature = FEATURES[featureId];
  if (!feature) return false;
  if (feature.defaultFor === 'all') return true;
  return feature.defaultFor.includes(role);
}

/**
 * Check if a user can use a feature.
 * Resolution: user override → role default.
 *
 * @param {{ role: string, configs: object }} user - User record from DB
 * @param {string} featureId
 * @returns {boolean}
 */
function can(user, featureId) {
  if (!user) return false;

  const userFeatures = user.configs?.features ?? {};

  // Explicit per-user override
  if (typeof userFeatures[featureId] === 'boolean') {
    return userFeatures[featureId];
  }

  // Fall back to role default
  return roleHasFeatureByDefault(user.role, featureId);
}

/**
 * Get the full resolved feature map for a user
 * (useful for showing them what they can do).
 *
 * @param {{ role: string, configs: object }} user
 * @returns {Record<string, boolean>}
 */
function resolveFeatures(user) {
  const result = {};
  for (const featureId of Object.keys(FEATURES)) {
    result[featureId] = can(user, featureId);
  }
  return result;
}

/**
 * Validate a configs object — strips unknown feature keys, ensures booleans.
 * @param {object} configs
 * @returns {{ features: Record<string, boolean> }}
 */
function validateConfigs(configs) {
  const features = {};
  const incoming = configs?.features ?? {};
  for (const [key, val] of Object.entries(incoming)) {
    if (FEATURES[key] && typeof val === 'boolean') {
      features[key] = val;
    }
  }
  return { features };
}

module.exports = {
  FEATURES,
  listFeatures,
  getFeature,
  roleHasFeatureByDefault,
  can,
  resolveFeatures,
  validateConfigs,
};
