const request = require('supertest');
const express = require('express');

// Mock database
jest.mock('../src/db', () => ({
  pool: { query: jest.fn() },
  admins: {
    list: jest.fn().mockResolvedValue([]),
    isAdmin: jest.fn().mockResolvedValue(false),
    add: jest.fn().mockResolvedValue({ id: 1, email: 'test@test.com' }),
    remove: jest.fn().mockResolvedValue({ id: 1 }),
  },
  settings: {
    getAll: jest.fn().mockResolvedValue([]),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(null),
  },
  audit: {
    list: jest.fn().mockResolvedValue([]),
    log: jest.fn().mockResolvedValue(null),
  },
}));

// Mock users DB (separate module from ../src/db)
jest.mock('../src/db/users', () => ({
  list: jest.fn().mockResolvedValue([]),
  findByEmail: jest.fn().mockResolvedValue(null),
  findByOpenId: jest.fn().mockResolvedValue(null),
  findByFeishuUserId: jest.fn().mockResolvedValue(null),
  getById: jest.fn().mockResolvedValue(null),
  upsert: jest.fn().mockResolvedValue({ user_id: 'test', role: 'user', configs: {} }),
  autoProvision: jest.fn().mockResolvedValue({ user_id: 'test', role: 'user', configs: {} }),
  setRole: jest.fn().mockResolvedValue({ user_id: 'test', role: 'admin', configs: {} }),
  updateConfigs: jest.fn().mockResolvedValue({ user_id: 'test', role: 'user', configs: {} }),
  updateProfile: jest.fn().mockResolvedValue({ user_id: 'test', role: 'user', configs: {} }),
  setFeature: jest.fn().mockResolvedValue({ user_id: 'test', role: 'user', configs: {} }),
  deleteUser: jest.fn().mockResolvedValue({ user_id: 'test' }),
}));

// Mock feishu client
jest.mock('../src/feishu/client', () => ({
  getUserByEmail: jest.fn().mockResolvedValue({ user_id: 'test_user_id' }),
  sendMessage: jest.fn().mockResolvedValue({}),
  resolveUserInfo: jest.fn().mockResolvedValue(null),
}));

// Mock logger
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  middleware: (req, res, next) => next(),
}));

// Mock reminder service (Postgres-backed, plain DB rows)
jest.mock('../src/services/reminder', () => ({
  getAllTasks: jest.fn().mockResolvedValue([]),
  getAllPendingTasks: jest.fn().mockResolvedValue([]),
  getUserPendingTasks: jest.fn().mockResolvedValue([]),
  createTask: jest.fn().mockResolvedValue({ id: 1, title: 'Test', status: 'pending' }),
  completeTask: jest.fn().mockResolvedValue({ id: 1, status: 'completed' }),
  deleteTask: jest.fn().mockResolvedValue({ id: 1 }),
  DEFAULT_DEADLINE_DAYS: 3,
}));

const apiRoutes = require('../src/routes/api');

const app = express();
app.use(express.json());
app.use('/api', apiRoutes);

describe('API Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/dashboard', () => {
    it('should return dashboard stats', async () => {
      const res = await request(app).get('/api/dashboard');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('stats');
      expect(res.body.stats).toHaveProperty('totalTasks');
      expect(res.body.stats).toHaveProperty('pendingTasks');
      expect(res.body.stats).toHaveProperty('adminCount');
    });
  });

  describe('GET /api/admins', () => {
    it('should return admin list', async () => {
      const res = await request(app).get('/api/admins');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('POST /api/admins', () => {
    it('should add admin with email', async () => {
      const res = await request(app)
        .post('/api/admins')
        .send({ email: 'test@test.com', name: 'Test' });

      expect(res.status).toBe(200);
    });

    it('should reject without email or userId', async () => {
      const res = await request(app).post('/api/admins').send({ name: 'Test' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('GET /api/tasks', () => {
    it('should return task list', async () => {
      const res = await request(app).get('/api/tasks');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('GET /api/settings', () => {
    it('should return settings', async () => {
      const res = await request(app).get('/api/settings');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('GET /api/audit', () => {
    it('should return audit logs', async () => {
      const res = await request(app).get('/api/audit');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('should accept query params', async () => {
      const res = await request(app).get('/api/audit?limit=10&offset=0');

      expect(res.status).toBe(200);
    });
  });
});
