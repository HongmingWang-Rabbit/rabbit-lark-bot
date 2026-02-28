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

// Mock jwt module
jest.mock('../src/utils/jwt', () => ({
  verifyJwt: jest.fn().mockReturnValue(null),
  JWT_COOKIE_NAME: 'rlk_session',
  COOKIE_OPTIONS: {},
}));

// Mock apiKeys DB
jest.mock('../src/db/apiKeys', () => ({
  findByHash: jest.fn().mockResolvedValue(null),
  touchLastUsed: jest.fn().mockResolvedValue(undefined),
}));

const { verifyFeishuSignature, sessionAuth, agentAuth, feishuWebhookAuth } = require('../src/middleware/auth');
const { verifyJwt } = require('../src/utils/jwt');
const apiKeys = require('../src/db/apiKeys');

// Legacy alias
const apiAuth = sessionAuth;

// ── helpers ──────────────────────────────────────────────────────────────────

function mockReqRes(overrides = {}) {
  const req = {
    headers: {},
    body: {},
    cookies: {},
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

// ── sessionAuth (apiAuth) ────────────────────────────────────────────────────

describe('sessionAuth', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    delete process.env.API_KEY;
    delete process.env.JWT_SECRET;
    delete process.env.NODE_ENV;
    delete process.env.REQUIRE_AUTH;
    verifyJwt.mockReturnValue(null);
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
    process.env.API_KEY = 'my-key';
    const { req, res, next } = mockReqRes();
    // No credentials provided
    await apiAuth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects all requests in production when neither JWT_SECRET nor API_KEY is set', async () => {
    process.env.NODE_ENV = 'production';
    const { req, res, next } = mockReqRes();
    await apiAuth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Server misconfigured' });
  });

  it('allows unprotected access when no auth configured in development mode', async () => {
    process.env.NODE_ENV = 'development';
    const { req, res, next } = mockReqRes();
    await apiAuth(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('allows valid JWT cookie', async () => {
    process.env.JWT_SECRET = 'test-secret';
    verifyJwt.mockReturnValue({ sub: 'user1', name: 'Test', role: 'admin' });
    const { req, res, next } = mockReqRes({
      cookies: { rlk_session: 'valid-token' },
    });
    await apiAuth(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user).toEqual({ sub: 'user1', name: 'Test', role: 'admin' });
  });

  it('falls through from invalid JWT to API key check and sets req.user', async () => {
    process.env.API_KEY = 'my-secret-key';
    verifyJwt.mockReturnValue(null);
    const { req, res, next } = mockReqRes({
      cookies: { rlk_session: 'expired-token' },
      headers: { 'x-api-key': 'my-secret-key' },
    });
    await apiAuth(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user).toEqual({ sub: 'api_key_user', name: 'API Key', role: 'superadmin' });
  });

  it('allows valid x-api-key header and sets req.user', async () => {
    process.env.API_KEY = 'my-secret-key';
    const { req, res, next } = mockReqRes({
      headers: { 'x-api-key': 'my-secret-key' },
    });
    await apiAuth(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user).toEqual({ sub: 'api_key_user', name: 'API Key', role: 'superadmin' });
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

  it('allows valid Bearer token and sets req.user', async () => {
    process.env.API_KEY = 'my-secret-key';
    const { req, res, next } = mockReqRes({
      headers: { authorization: 'Bearer my-secret-key' },
    });
    await apiAuth(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user).toEqual({ sub: 'api_key_user', name: 'API Key', role: 'superadmin' });
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

  it('returns 401 when no credentials provided and API_KEY is set', async () => {
    process.env.API_KEY = 'my-secret-key';
    const { req, res, next } = mockReqRes();
    await apiAuth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
  });
});

// ── agentAuth ────────────────────────────────────────────────────────────────

describe('agentAuth', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    delete process.env.AGENT_API_KEY;
    delete process.env.API_KEY;
    apiKeys.findByHash.mockResolvedValue(null);
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('allows valid AGENT_API_KEY', async () => {
    process.env.AGENT_API_KEY = 'agent-secret';
    const { req, res, next } = mockReqRes({
      headers: { authorization: 'Bearer agent-secret' },
    });
    await agentAuth(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('rejects invalid AGENT_API_KEY', async () => {
    process.env.AGENT_API_KEY = 'agent-secret';
    const { req, res, next } = mockReqRes({
      headers: { authorization: 'Bearer wrong-key' },
    });
    await agentAuth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('allows DB-backed API key when env var check fails', async () => {
    process.env.AGENT_API_KEY = 'env-key';
    const dbKey = { id: 1, name: 'test-key' };
    const rawKey = 'rlk_abcd1234abcd1234abcd1234abcd1234';
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    apiKeys.findByHash.mockResolvedValue(dbKey);

    const { req, res, next } = mockReqRes({
      headers: { authorization: `Bearer ${rawKey}` },
    });
    await agentAuth(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.agentKeyName).toBe('test-key');
    expect(apiKeys.touchLastUsed).toHaveBeenCalledWith(1);
  });

  it('allows unprotected access when no keys configured', async () => {
    const { req, res, next } = mockReqRes();
    await agentAuth(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('rejects when keys configured but no credentials provided', async () => {
    process.env.AGENT_API_KEY = 'agent-secret';
    const { req, res, next } = mockReqRes();
    await agentAuth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
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
