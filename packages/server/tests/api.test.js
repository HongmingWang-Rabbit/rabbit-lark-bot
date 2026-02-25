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

// Mock feishu client
jest.mock('../src/feishu/client', () => ({
  getUserByEmail: jest.fn().mockResolvedValue({ user_id: 'test_user_id' }),
  sendMessage: jest.fn().mockResolvedValue({}),
  bitable: {
    getRecords: jest.fn().mockResolvedValue({ data: { items: [] } }),
    searchRecords: jest.fn().mockResolvedValue({ data: { items: [] } }),
  },
}));

// Mock logger
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  middleware: (req, res, next) => next(),
}));

// Mock reminder service
jest.mock('../src/services/reminder', () => ({
  getAllTasks: jest.fn().mockResolvedValue([]),
  getAllPendingTasks: jest.fn().mockResolvedValue([]),
  extractFieldText: jest.fn((f) => f),
  FIELDS: {
    TASK_NAME: '任务名称',
    TARGET: '催办对象',
    STATUS: '状态',
  },
  STATUS: {
    PENDING: '待办',
    COMPLETED: '已完成',
  },
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
