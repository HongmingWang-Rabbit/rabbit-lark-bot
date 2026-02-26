const {
  FEATURES,
  listFeatures,
  getFeature,
  roleHasFeatureByDefault,
  can,
  resolveFeatures,
  validateConfigs,
} = require('../src/features');

describe('Features module', () => {
  describe('listFeatures', () => {
    it('should return all features as an array', () => {
      const features = listFeatures();
      expect(Array.isArray(features)).toBe(true);
      expect(features.length).toBe(Object.keys(FEATURES).length);
      expect(features[0]).toHaveProperty('id');
      expect(features[0]).toHaveProperty('label');
    });
  });

  describe('getFeature', () => {
    it('should return a feature by id', () => {
      const feat = getFeature('cuiban_view');
      expect(feat).not.toBeNull();
      expect(feat.id).toBe('cuiban_view');
    });

    it('should return null for unknown feature', () => {
      expect(getFeature('nonexistent')).toBeNull();
    });
  });

  describe('roleHasFeatureByDefault', () => {
    it('should return true for "all" features regardless of role', () => {
      expect(roleHasFeatureByDefault('user', 'cuiban_view')).toBe(true);
      expect(roleHasFeatureByDefault('admin', 'cuiban_view')).toBe(true);
      expect(roleHasFeatureByDefault('superadmin', 'cuiban_view')).toBe(true);
    });

    it('should return true for admin-only features with admin role', () => {
      expect(roleHasFeatureByDefault('admin', 'cuiban_create')).toBe(true);
      expect(roleHasFeatureByDefault('superadmin', 'cuiban_create')).toBe(true);
    });

    it('should return false for admin-only features with user role', () => {
      expect(roleHasFeatureByDefault('user', 'cuiban_create')).toBe(false);
    });

    it('should return false for unknown feature', () => {
      expect(roleHasFeatureByDefault('admin', 'nonexistent')).toBe(false);
    });

    it('should return true for superadmin-only features with superadmin', () => {
      expect(roleHasFeatureByDefault('superadmin', 'system_config')).toBe(true);
    });

    it('should return false for superadmin-only features with admin', () => {
      expect(roleHasFeatureByDefault('admin', 'system_config')).toBe(false);
    });
  });

  describe('can', () => {
    it('should return false for null user', () => {
      expect(can(null, 'cuiban_view')).toBe(false);
    });

    it('should use role default when no override', () => {
      const user = { role: 'user', configs: {} };
      expect(can(user, 'cuiban_view')).toBe(true);     // defaultFor: 'all'
      expect(can(user, 'cuiban_create')).toBe(false);   // defaultFor: ['admin','superadmin']
    });

    it('should respect explicit per-user override (enable)', () => {
      const user = { role: 'user', configs: { features: { cuiban_create: true } } };
      expect(can(user, 'cuiban_create')).toBe(true);
    });

    it('should respect explicit per-user override (disable)', () => {
      const user = { role: 'admin', configs: { features: { cuiban_create: false } } };
      expect(can(user, 'cuiban_create')).toBe(false);
    });

    it('should handle missing configs gracefully', () => {
      const user = { role: 'user' };
      expect(can(user, 'cuiban_view')).toBe(true);
    });
  });

  describe('resolveFeatures', () => {
    it('should return a map of all features for a user', () => {
      const user = { role: 'user', configs: {} };
      const resolved = resolveFeatures(user);

      expect(typeof resolved).toBe('object');
      expect(Object.keys(resolved).length).toBe(Object.keys(FEATURES).length);

      // user role gets 'all' features but not admin/superadmin ones
      expect(resolved.cuiban_view).toBe(true);
      expect(resolved.cuiban_complete).toBe(true);
      expect(resolved.cuiban_create).toBe(false);
      expect(resolved.system_config).toBe(false);
    });

    it('should reflect admin permissions', () => {
      const user = { role: 'admin', configs: {} };
      const resolved = resolveFeatures(user);

      expect(resolved.cuiban_view).toBe(true);
      expect(resolved.cuiban_create).toBe(true);
      expect(resolved.user_manage).toBe(true);
      expect(resolved.system_config).toBe(false);  // superadmin only
    });

    it('should apply per-user overrides', () => {
      const user = { role: 'user', configs: { features: { cuiban_create: true, cuiban_view: false } } };
      const resolved = resolveFeatures(user);

      expect(resolved.cuiban_create).toBe(true);   // overridden on
      expect(resolved.cuiban_view).toBe(false);     // overridden off
    });
  });

  describe('validateConfigs', () => {
    it('should strip unknown feature keys', () => {
      const configs = { features: { cuiban_view: true, fake_feature: true } };
      const result = validateConfigs(configs);

      expect(result.features.cuiban_view).toBe(true);
      expect(result.features.fake_feature).toBeUndefined();
    });

    it('should strip non-boolean values', () => {
      const configs = { features: { cuiban_view: 'yes', cuiban_complete: true } };
      const result = validateConfigs(configs);

      expect(result.features.cuiban_view).toBeUndefined();
      expect(result.features.cuiban_complete).toBe(true);
    });

    it('should handle null/undefined configs', () => {
      expect(validateConfigs(null)).toEqual({ features: {} });
      expect(validateConfigs(undefined)).toEqual({ features: {} });
      expect(validateConfigs({})).toEqual({ features: {} });
    });

    it('should handle configs without features key', () => {
      expect(validateConfigs({ other: 'stuff' })).toEqual({ features: {} });
    });
  });
});
