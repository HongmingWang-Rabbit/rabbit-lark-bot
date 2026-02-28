// Mock logger
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

// Mock DB pool
jest.mock('../src/db/index', () => ({
  pool: { query: jest.fn().mockResolvedValue({ rows: [] }) },
}));

// Mock reminder service
jest.mock('../src/services/reminder', () => ({
  getUserPendingTasks: jest.fn().mockResolvedValue([]),
  createTask: jest.fn().mockResolvedValue({ id: 1 }),
  completeTask: jest.fn().mockResolvedValue({ id: 1, status: 'completed' }),
}));

// Mock users DB
jest.mock('../src/db/users', () => ({
  findByOpenId: jest.fn().mockResolvedValue({ name: 'Test', open_id: 'ou_123' }),
  list: jest.fn().mockResolvedValue([]),
}));

// Mock feishu client
jest.mock('../src/feishu/client', () => ({
  sendMessage: jest.fn().mockResolvedValue({}),
}));

const agentForwarder = require('../src/services/agentForwarder');

describe('Agent Forwarder Service', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('isAgentConfigured', () => {
    it('should return false when ANTHROPIC_API_KEY not set', () => {
      delete process.env.ANTHROPIC_API_KEY;
      expect(agentForwarder.isAgentConfigured()).toBe(false);
    });

    it('should return true when ANTHROPIC_API_KEY is set', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
      expect(agentForwarder.isAgentConfigured()).toBe(true);
    });
  });

  describe('getAgentConfig', () => {
    it('should return null when ANTHROPIC_API_KEY not set', () => {
      delete process.env.ANTHROPIC_API_KEY;
      const config = agentForwarder.getAgentConfig();
      expect(config).toBeNull();
    });

    it('should return config when ANTHROPIC_API_KEY is set', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
      const config = agentForwarder.getAgentConfig();

      expect(config).not.toBeNull();
      expect(config.model).toBe('claude-haiku-4-5-20251001');
      expect(config.maxHistoryMessages).toBe(20);
      expect(config.maxToolRounds).toBe(5);
      expect(config.maxConcurrentAgents).toBe(10);
    });
  });

  describe('forwardToOwnerAgent', () => {
    it('should return null when ANTHROPIC_API_KEY not set', async () => {
      delete process.env.ANTHROPIC_API_KEY;

      const event = {
        message: { chat_id: 'oc_1', content: JSON.stringify({ text: 'hello' }) },
        sender: { sender_id: { open_id: 'ou_123' } },
      };

      const result = await agentForwarder.forwardToOwnerAgent(event, 'http://localhost:3456');
      expect(result).toBeNull();
    });

    it('should return null when text is empty', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';

      const event = {
        message: { chat_id: 'oc_1', content: JSON.stringify({ text: '' }) },
        sender: { sender_id: { open_id: 'ou_123' } },
      };

      const result = await agentForwarder.forwardToOwnerAgent(event, 'http://localhost:3456');
      expect(result).toBeNull();
    });

    it('should return null when chat_id is missing', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';

      const event = {
        message: { content: JSON.stringify({ text: 'hello' }) },
        sender: { sender_id: { open_id: 'ou_123' } },
      };

      const result = await agentForwarder.forwardToOwnerAgent(event, 'http://localhost:3456');
      expect(result).toBeNull();
    });
  });
});
