const crypto = require('crypto');

// Mock logger
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

// Mock admins DB
jest.mock('../src/db', () => ({
  admins: {
    isAdmin: jest.fn().mockResolvedValue(false),
  },
}));

const { verifyFeishuSignature, apiAuth, feishuWebhookAuth } = require('../src/middleware/auth');

// ── helpers ──────────────────────────────────────────────────────────────────

function mockReqRes(overrides = {}) {
  const req = {
    headers: {},
    body: {},
    path: '/test',
    ip: '127.0.0.1',
    ...overrides,
  };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  const next = jest.fn();
  return { req, res, next };
}

// ── verifyFeishuSignature ────────────────────────────────────────────────────

describe('verifyFeishuSignature', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('returns true when FEISHU_ENCRYPT_KEY is not set (dev mode)', () => {
    delete process.env.FEISHU_ENCRYPT_KEY;
    expect(verifyFeishuSignature('ts', 'nonce', {}, 'bad')).toBe(true);
  });

  it('returns true for a valid signature', () => {
    process.env.FEISHU_ENCRYPT_KEY = 'test-key';
    const body = { hello: 'world' };
    const ts = '1234567890';
    const nonce = 'abc';
    const content = ts + nonce + 'test-key' + JSON.stringify(body);
    const expected = crypto.createHash('sha256').update(content).digest('hex');

    expect(verifyFeishuSignature(ts, nonce, body, expected)).toBe(true);
  });

  it('returns false for an invalid signature', () => {
    process.env.FEISHU_ENCRYPT_KEY = 'test-key';
    expect(verifyFeishuSignature('ts', 'nonce', {}, 'invalid-sig')).toBe(false);
  });

  it('returns false for null/undefined signature', () => {
    process.env.FEISHU_ENCRYPT_KEY = 'test-key';
    expect(verifyFeishuSignature('ts', 'nonce', {}, null)).toBe(false);
    expect(verifyFeishuSignature('ts', 'nonce', {}, undefined)).toBe(false);
  });

  it('uses timing-safe comparison (same length required)', () => {
    process.env.FEISHU_ENCRYPT_KEY = 'test-key';
    const body = {};
    const content = 'ts' + 'nonce' + 'test-key' + JSON.stringify(body);
    const correct = crypto.createHash('sha256').update(content).digest('hex');
    // Wrong value but same length
    const wrong = 'a'.repeat(correct.length);
    expect(verifyFeishuSignature('ts', 'nonce', body, wrong)).toBe(false);
    expect(verifyFeishuSignature('ts', 'nonce', body, correct)).toBe(true);
  });
});

// ── apiAuth ──────────────────────────────────────────────────────────────────

describe('apiAuth', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    delete process.env.API_KEY;
    delete process.env.NODE_ENV;
    delete process.env.REQUIRE_AUTH;
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('skips auth in development mode without REQUIRE_AUTH', async () => {
    process.env.NODE_ENV = 'development';
    const { req, res, next } = mockReqRes();
    await apiAuth(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('does not skip auth in development mode when REQUIRE_AUTH is set', async () => {
    process.env.NODE_ENV = 'development';
    process.env.REQUIRE_AUTH = 'true';
    const { req, res, next } = mockReqRes();
    // No API_KEY set, no credentials provided — falls through to production guard
    await apiAuth(req, res, next);
    // Without API_KEY and not production, it warns and allows
    expect(next).toHaveBeenCalled();
  });

  it('rejects all requests in production when API_KEY is not set', async () => {
    process.env.NODE_ENV = 'production';
    const { req, res, next } = mockReqRes();
    await apiAuth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Server misconfigured' });
  });

  it('allows unprotected access when API_KEY is not set in development mode', async () => {
    process.env.NODE_ENV = 'development';
    const { req, res, next } = mockReqRes();
    await apiAuth(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('rejects requests when API_KEY is not set and NODE_ENV is not development', async () => {
    // NODE_ENV defaults to 'test' in Jest — should be rejected
    const { req, res, next } = mockReqRes();
    await apiAuth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('allows valid x-api-key header', async () => {
    process.env.API_KEY = 'my-secret-key';
    const { req, res, next } = mockReqRes({
      headers: { 'x-api-key': 'my-secret-key' },
    });
    await apiAuth(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('rejects invalid x-api-key header', async () => {
    process.env.API_KEY = 'my-secret-key';
    const { req, res, next } = mockReqRes({
      headers: { 'x-api-key': 'wrong-key-wrong' },
    });
    await apiAuth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects x-api-key with different length (timing-safe guard)', async () => {
    process.env.API_KEY = 'my-secret-key';
    const { req, res, next } = mockReqRes({
      headers: { 'x-api-key': 'short' },
    });
    await apiAuth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('allows valid Bearer token', async () => {
    process.env.API_KEY = 'my-secret-key';
    const { req, res, next } = mockReqRes({
      headers: { authorization: 'Bearer my-secret-key' },
    });
    await apiAuth(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('rejects invalid Bearer token', async () => {
    process.env.API_KEY = 'my-secret-key';
    const { req, res, next } = mockReqRes({
      headers: { authorization: 'Bearer wrong-key-wrong' },
    });
    await apiAuth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects Bearer token with different length', async () => {
    process.env.API_KEY = 'my-secret-key';
    const { req, res, next } = mockReqRes({
      headers: { authorization: 'Bearer x' },
    });
    await apiAuth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 when no credentials provided and API_KEY is set', async () => {
    process.env.API_KEY = 'my-secret-key';
    const { req, res, next } = mockReqRes();
    await apiAuth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
  });
});

// ── requireAdmin ─────────────────────────────────────────────────────────────

describe('requireAdmin', () => {
  const { requireAdmin } = require('../src/middleware/auth');
  const { admins } = require('../src/db');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects when no user identification headers are provided', async () => {
    const { req, res, next } = mockReqRes();
    await requireAdmin(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects non-admin users', async () => {
    admins.isAdmin.mockResolvedValue(false);
    const { req, res, next } = mockReqRes({ headers: { 'x-user-id': 'user_1' } });
    await requireAdmin(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('allows admin users and attaches adminUser to req', async () => {
    admins.isAdmin.mockResolvedValue(true);
    const { req, res, next } = mockReqRes({ headers: { 'x-user-id': 'admin_1', 'x-user-email': 'admin@test.com' } });
    await requireAdmin(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.adminUser).toEqual({ userId: 'admin_1', email: 'admin@test.com' });
  });

  it('logs deprecation warning on every call', async () => {
    const logger = require('../src/utils/logger');
    admins.isAdmin.mockResolvedValue(true);
    const { req, res, next } = mockReqRes({ headers: { 'x-user-id': 'admin_1' } });
    await requireAdmin(req, res, next);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('requireAdmin called'),
      expect.any(Object)
    );
  });
});

// ── feishuWebhookAuth ────────────────────────────────────────────────────────

describe('feishuWebhookAuth', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('passes through url_verification requests', () => {
    const { req, res, next } = mockReqRes({ body: { type: 'url_verification' } });
    feishuWebhookAuth(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('passes through encrypted payloads', () => {
    const { req, res, next } = mockReqRes({ body: { encrypt: 'some-encrypted-data' } });
    feishuWebhookAuth(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('rejects when FEISHU_ENCRYPT_KEY is set but headers are missing', () => {
    process.env.FEISHU_ENCRYPT_KEY = 'test-key';
    const { req, res, next } = mockReqRes({ body: { event: {} } });
    feishuWebhookAuth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
