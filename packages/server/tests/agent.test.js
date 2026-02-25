const request = require('supertest');
const express = require('express');

// Mock feishu client
jest.mock('../src/feishu/client', () => ({
  sendMessageByType: jest.fn().mockResolvedValue('msg_123'),
  replyMessage: jest.fn().mockResolvedValue('msg_456'),
  addReaction: jest.fn().mockResolvedValue({}),
  getMessageHistory: jest.fn().mockResolvedValue([]),
  getUserInfo: jest.fn().mockResolvedValue({ data: { user: { name: 'Test User' } } }),
}));

// Mock logger
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  middleware: (req, res, next) => next(),
}));

// Mock agentForwarder
jest.mock('../src/services/agentForwarder', () => ({
  isAgentConfigured: jest.fn().mockReturnValue(true),
  getAgentConfig: jest.fn().mockReturnValue({ webhookUrl: 'http://test.com/webhook' }),
  BRIDGE_VERSION: '1.0.0',
  CAPABILITIES: ['text', 'image', 'file', 'reply', 'reaction', 'interactive'],
}));

const agentRoutes = require('../src/routes/agent');
const feishu = require('../src/feishu/client');

const app = express();
app.use(express.json());
app.use('/api/agent', agentRoutes);

describe('Agent API Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/agent/send', () => {
    it('should send a text message', async () => {
      const res = await request(app)
        .post('/api/agent/send')
        .send({ chat_id: 'ou_123', content: 'Hello' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message_id).toBe('msg_123');
      expect(feishu.sendMessageByType).toHaveBeenCalledWith(
        'ou_123',
        'Hello',
        'text',
        'open_id'
      );
    });

    it('should detect chat_id type correctly', async () => {
      await request(app)
        .post('/api/agent/send')
        .send({ chat_id: 'oc_456', content: 'Group message' });

      expect(feishu.sendMessageByType).toHaveBeenCalledWith(
        'oc_456',
        'Group message',
        'text',
        'chat_id'
      );
    });

    it('should reject missing chat_id', async () => {
      const res = await request(app)
        .post('/api/agent/send')
        .send({ content: 'Hello' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('chat_id');
    });

    it('should reject missing content', async () => {
      const res = await request(app)
        .post('/api/agent/send')
        .send({ chat_id: 'ou_123' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('content');
    });
  });

  describe('POST /api/agent/reply', () => {
    it('should reply to a message', async () => {
      const res = await request(app)
        .post('/api/agent/reply')
        .send({ message_id: 'om_123', content: 'Reply text' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(feishu.replyMessage).toHaveBeenCalledWith('om_123', 'Reply text');
    });

    it('should reject missing message_id', async () => {
      const res = await request(app)
        .post('/api/agent/reply')
        .send({ content: 'Reply' });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/agent/react', () => {
    it('should add reaction to message', async () => {
      const res = await request(app)
        .post('/api/agent/react')
        .send({ message_id: 'om_123', emoji: 'thumbsup' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(feishu.addReaction).toHaveBeenCalledWith('om_123', 'thumbsup');
    });
  });

  describe('GET /api/agent/history', () => {
    it('should get message history', async () => {
      const res = await request(app)
        .get('/api/agent/history')
        .query({ chat_id: 'oc_123' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(feishu.getMessageHistory).toHaveBeenCalledWith('oc_123', 20, undefined);
    });

    it('should limit max results to 100', async () => {
      await request(app)
        .get('/api/agent/history')
        .query({ chat_id: 'oc_123', limit: '999' });

      expect(feishu.getMessageHistory).toHaveBeenCalledWith('oc_123', 100, undefined);
    });

    it('should default to 20 for invalid limit', async () => {
      await request(app)
        .get('/api/agent/history')
        .query({ chat_id: 'oc_123', limit: 'invalid' });

      expect(feishu.getMessageHistory).toHaveBeenCalledWith('oc_123', 20, undefined);
    });
  });

  describe('GET /api/agent/user/:user_id', () => {
    it('should get user info', async () => {
      const res = await request(app).get('/api/agent/user/ou_123');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(feishu.getUserInfo).toHaveBeenCalledWith('ou_123');
    });
  });

  describe('GET /api/agent/status', () => {
    it('should return agent configuration status', async () => {
      const res = await request(app).get('/api/agent/status');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.configured).toBe(true);
      expect(res.body.webhook_configured).toBe(true);
    });
  });

  describe('GET /api/agent/schema', () => {
    it('should return message schema', async () => {
      const res = await request(app).get('/api/agent/schema');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.version).toBe('1.0.0');
      expect(res.body.capabilities).toContain('text');
      expect(res.body.message_format).toHaveProperty('source');
      expect(res.body.message_format).toHaveProperty('reply_via');
    });
  });
});
