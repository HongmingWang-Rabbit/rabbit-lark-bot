// Mock logger
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
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

  describe('formatForAgent', () => {
    it('should format Lark event to standard message format', () => {
      const event = {
        message: {
          message_id: 'om_123',
          chat_id: 'oc_456',
          chat_type: 'group',
          message_type: 'text',
          content: JSON.stringify({ text: 'Hello' }),
          create_time: '1234567890',
        },
        sender: {
          sender_id: {
            user_id: 'user_123',
            open_id: 'ou_123',
            union_id: 'on_123',
          },
          sender_type: 'user',
        },
      };

      const result = agentForwarder.formatForAgent(event, 'http://localhost:3456');

      expect(result.source.bridge).toBe('rabbit-lark-bot');
      expect(result.source.platform).toBe('lark');
      expect(result.source.version).toBe('1.0.0');
      expect(result.source.capabilities).toContain('text');

      expect(result.reply_via.mcp).toBe('rabbit-lark');
      expect(result.reply_via.api).toBe('http://localhost:3456/api/agent/send');

      expect(result.event).toBe('message');
      expect(result.message_id).toBe('om_123');
      expect(result.chat_id).toBe('oc_456');
      expect(result.chat_type).toBe('group');

      expect(result.user.id).toBe('user_123');
      expect(result.user.open_id).toBe('ou_123');
      expect(result.user.type).toBe('user');

      expect(result.content.type).toBe('text');
      expect(result.content.text).toBe('Hello');

      expect(result.timestamp).toBe(1234567890);
      expect(result._raw).toEqual(event);
    });

    it('should handle non-JSON content gracefully', () => {
      const event = {
        message: {
          message_id: 'om_123',
          content: 'plain text',
          message_type: 'text',
        },
        sender: {
          sender_id: { user_id: 'user_123' },
        },
      };

      const result = agentForwarder.formatForAgent(event, 'http://localhost:3456');

      expect(result.content.type).toBe('text');
      expect(result.content.text).toBe('plain text');
    });

    it('should handle missing fields', () => {
      const event = {
        message: {},
        sender: {},
      };

      const result = agentForwarder.formatForAgent(event, 'http://localhost:3456');

      expect(result.message_id).toBeUndefined();
      expect(result.user.id).toBeUndefined();
      expect(result.content.type).toBe('text');
    });
  });

  describe('generateSignature', () => {
    it('should generate HMAC signature', () => {
      const payload = { test: 'data' };
      const secret = 'my-secret';

      const signature = agentForwarder.generateSignature(payload, secret);

      expect(signature).toBeTruthy();
      expect(typeof signature).toBe('string');
      expect(signature.length).toBe(64); // SHA256 hex length
    });

    it('should return empty string without secret', () => {
      const payload = { test: 'data' };

      const signature = agentForwarder.generateSignature(payload, '');
      expect(signature).toBe('');

      const signatureNull = agentForwarder.generateSignature(payload, null);
      expect(signatureNull).toBe('');
    });

    it('should produce consistent signatures', () => {
      const payload = { test: 'data' };
      const secret = 'my-secret';

      const sig1 = agentForwarder.generateSignature(payload, secret);
      const sig2 = agentForwarder.generateSignature(payload, secret);

      expect(sig1).toBe(sig2);
    });

    it('should produce different signatures for different payloads', () => {
      const secret = 'my-secret';

      const sig1 = agentForwarder.generateSignature({ a: 1 }, secret);
      const sig2 = agentForwarder.generateSignature({ a: 2 }, secret);

      expect(sig1).not.toBe(sig2);
    });
  });

  describe('getAgentConfig', () => {
    it('should return null when AGENT_WEBHOOK_URL not set', () => {
      delete process.env.AGENT_WEBHOOK_URL;

      const config = agentForwarder.getAgentConfig();
      expect(config).toBeNull();
    });

    it('should return config when AGENT_WEBHOOK_URL is set', () => {
      process.env.AGENT_WEBHOOK_URL = 'http://agent.com/webhook';
      process.env.AGENT_API_KEY = 'test-key';
      process.env.AGENT_TIMEOUT_MS = '5000';

      const config = agentForwarder.getAgentConfig();

      expect(config.webhookUrl).toBe('http://agent.com/webhook');
      expect(config.apiKey).toBe('test-key');
      expect(config.timeout).toBe(5000);
    });

    it('should use default timeout when not specified', () => {
      process.env.AGENT_WEBHOOK_URL = 'http://agent.com/webhook';
      delete process.env.AGENT_TIMEOUT_MS;

      const config = agentForwarder.getAgentConfig();
      expect(config.timeout).toBe(30000);
    });
  });

  describe('isAgentConfigured', () => {
    it('should return false when not configured', () => {
      delete process.env.AGENT_WEBHOOK_URL;
      expect(agentForwarder.isAgentConfigured()).toBe(false);
    });

    it('should return true when configured', () => {
      process.env.AGENT_WEBHOOK_URL = 'http://agent.com/webhook';
      expect(agentForwarder.isAgentConfigured()).toBe(true);
    });
  });

  describe('constants', () => {
    it('should export BRIDGE_VERSION', () => {
      expect(agentForwarder.BRIDGE_VERSION).toBe('1.0.0');
    });

    it('should export CAPABILITIES', () => {
      expect(agentForwarder.CAPABILITIES).toContain('text');
      expect(agentForwarder.CAPABILITIES).toContain('reply');
      expect(agentForwarder.CAPABILITIES).toContain('reaction');
    });
  });
});
