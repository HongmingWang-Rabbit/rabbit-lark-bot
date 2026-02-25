/**
 * Database module tests
 * These tests require a running PostgreSQL instance
 * Set DATABASE_URL env or use docker-compose
 */

describe('Database Module', () => {
  // Skip if no DATABASE_URL
  const skipIfNoDb = !process.env.DATABASE_URL;

  describe('admins', () => {
    it.skipIf(skipIfNoDb)('should add and retrieve admin', async () => {
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
    it.skipIf(skipIfNoDb)('should set and get setting', async () => {
      const { settings } = require('../src/db');

      await settings.set('test_key', { foo: 'bar' }, 'Test setting');
      const value = await settings.get('test_key');

      expect(value).toEqual({ foo: 'bar' });

      // Cleanup
      await settings.delete('test_key');
    });
  });
});

// Helper for conditional skipping
if (!it.skipIf) {
  it.skipIf = (condition) => condition ? it.skip : it;
}
