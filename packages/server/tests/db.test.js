/**
 * Database module tests
 * These tests require a running PostgreSQL instance
 * Set DATABASE_URL env or use docker-compose
 */

const skipIfNoDb = !process.env.DATABASE_URL || process.env.NODE_ENV === 'test';

describe('Database Module', () => {
  describe('admins', () => {
    // Skip integration tests if no real database
    if (skipIfNoDb) {
      it.skip('should add and retrieve admin (requires database)', () => {});
      return;
    }

    it('should add and retrieve admin', async () => {
      const { admins } = require('../src/db');

      const admin = await admins.add({
        userId: 'test_user_123',
        email: 'test@example.com',
        name: 'Test User',
        role: 'admin',
      });

      expect(admin).toHaveProperty('user_id', 'test_user_123');
      expect(admin).toHaveProperty('email', 'test@example.com');

      const isAdmin = await admins.isAdmin('test_user_123', null);
      expect(isAdmin).toBe(true);

      // Cleanup
      await admins.remove('test_user_123');
    });
  });

  describe('settings', () => {
    if (skipIfNoDb) {
      it.skip('should set and get setting (requires database)', () => {});
      return;
    }

    it('should set and get setting', async () => {
      const { settings } = require('../src/db');

      await settings.set('test_key', { foo: 'bar' }, 'Test setting');
      const value = await settings.get('test_key');

      expect(value).toEqual({ foo: 'bar' });

      // Cleanup
      await settings.delete('test_key');
    });
  });
});
