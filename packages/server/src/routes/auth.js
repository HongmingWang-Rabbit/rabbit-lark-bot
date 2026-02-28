const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const logger = require('../utils/logger');
const { signJwt, verifyJwt, JWT_COOKIE_NAME, COOKIE_OPTIONS } = require('../utils/jwt');
const usersDb = require('../db/users');
const feishu = require('../feishu/client');
const { safeErrorMessage } = require('../utils/safeError');
const { rateLimit } = require('../middleware/rateLimit');

// Strict rate limit for password login: 5 attempts per IP per minute
const passwordRateLimit = rateLimit({ maxRequests: 5, windowMs: 60 * 1000 });

const OAUTH_FETCH_TIMEOUT_MS = 10_000;

// ============ Feishu OAuth ============

/**
 * GET /api/auth/feishu — Redirect to Feishu OAuth authorize page
 */
router.get('/feishu', (req, res) => {
  const appId = process.env.FEISHU_APP_ID;
  const redirectUri = process.env.FEISHU_OAUTH_REDIRECT_URI;

  if (!appId || !redirectUri) {
    return res.status(500).json({ error: 'Feishu OAuth not configured' });
  }

  // CSRF state token — stored in a short-lived cookie
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie('rlk_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 5 * 60 * 1000, // 5 minutes
  });

  const params = new URLSearchParams({
    app_id: appId,
    redirect_uri: redirectUri,
    state,
  });

  res.redirect(`https://open.feishu.cn/open-apis/authen/v1/authorize?${params}`);
});

/**
 * GET /api/auth/feishu/callback — OAuth callback
 * Exchange authorization code for user info, provision user, set JWT cookie.
 */
router.get('/feishu/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    const savedState = req.cookies?.rlk_oauth_state;

    // Verify CSRF state (constant-time comparison)
    if (!state || !savedState
        || state.length !== savedState.length
        || !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(savedState))) {
      logger.warn('OAuth callback: state mismatch');
      return res.status(400).send('Invalid OAuth state. Please try again.');
    }
    // Clear the state cookie
    res.clearCookie('rlk_oauth_state');

    if (!code) {
      return res.status(400).send('Missing authorization code.');
    }

    // Exchange code for user access token
    const appToken = await feishu.getToken();
    const tokenResp = await fetch('https://open.feishu.cn/open-apis/authen/v1/oidc/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${appToken}`,
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
      }),
      signal: AbortSignal.timeout(OAUTH_FETCH_TIMEOUT_MS),
    });
    const tokenData = await tokenResp.json();

    if (tokenData.code !== 0) {
      logger.error('OAuth token exchange failed', { code: tokenData.code, msg: tokenData.msg });
      return res.status(400).send('OAuth token exchange failed. Please try again.');
    }

    const { access_token } = tokenData.data;

    // Get user info
    const userResp = await fetch('https://open.feishu.cn/open-apis/authen/v1/user_info', {
      headers: { 'Authorization': `Bearer ${access_token}` },
      signal: AbortSignal.timeout(OAUTH_FETCH_TIMEOUT_MS),
    });
    const userData = await userResp.json();

    if (userData.code !== 0) {
      logger.error('OAuth user info failed', { code: userData.code, msg: userData.msg });
      return res.status(400).send('Failed to get user info. Please try again.');
    }

    const { open_id, user_id: feishuUserId, name, email, avatar_url, mobile } = userData.data;

    // Auto-provision user (creates or updates)
    const user = await usersDb.autoProvision({
      openId: open_id,
      email: email || null,
      phone: mobile || null,
      name: name || null,
      feishuUserId: feishuUserId || null,
    });

    // Update avatar_url if available
    if (avatar_url && user) {
      try {
        await usersDb.updateAvatar(user.user_id, avatar_url);
      } catch (err) {
        logger.warn('Failed to update avatar_url', { error: err.message });
      }
    }

    // Sign JWT — note: role/name/avatar are embedded and remain stale for
    // the token's 7-day lifetime. Role changes require re-login to take effect.
    const token = signJwt({
      sub: user.user_id,
      name: user.name || name,
      email: user.email || email,
      role: user.role,
      avatarUrl: avatar_url || null,
    });

    res.cookie(JWT_COOKIE_NAME, token, COOKIE_OPTIONS);
    res.redirect('/');
  } catch (err) {
    logger.error('OAuth callback error', { error: err.message });
    res.status(500).send('Authentication failed. Please try again.');
  }
});

// ============ Password Login ============

/**
 * POST /api/auth/password — Validate password, set JWT cookie
 */
router.post('/password', passwordRateLimit, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ error: 'Password required' });
    }

    const expectedPassword = process.env.ADMIN_PASSWORD;
    if (!expectedPassword) {
      return res.status(500).json({ error: 'Password login not configured' });
    }

    // Constant-time comparison via SHA-256
    const expectedHash = crypto.createHash('sha256').update(expectedPassword).digest();
    const providedHash = crypto.createHash('sha256').update(password).digest();

    if (!crypto.timingSafeEqual(expectedHash, providedHash)) {
      logger.warn('Password login: invalid password', { ip: req.ip });
      return res.status(401).json({ error: '密码错误' });
    }

    // Upsert a password_admin superadmin user
    const userId = 'password_admin';
    let user;
    try {
      user = await usersDb.getById(userId);
      if (!user) {
        user = await usersDb.upsert({
          userId,
          name: '管理员',
          role: 'superadmin',
        });
      }
    } catch (dbErr) {
      // If DB fails, still allow login with basic info
      logger.warn('Password login: DB user lookup failed, using fallback', { error: dbErr.message });
      user = { user_id: userId, name: '管理员', role: 'superadmin' };
    }

    const token = signJwt({
      sub: user.user_id,
      name: user.name || '管理员',
      role: user.role || 'superadmin',
    });

    res.cookie(JWT_COOKIE_NAME, token, COOKIE_OPTIONS);
    res.json({ success: true, user: { userId: user.user_id, name: user.name, role: user.role } });
  } catch (err) {
    logger.error('Password login error', { error: err.message });
    res.status(500).json({ error: safeErrorMessage(err, 'Login failed') });
  }
});

// ============ Session ============

/**
 * GET /api/auth/me — Check current session
 */
router.get('/me', (req, res) => {
  const token = req.cookies?.[JWT_COOKIE_NAME];
  if (!token) {
    return res.json({ authed: false });
  }

  const payload = verifyJwt(token);
  if (!payload) {
    return res.json({ authed: false });
  }

  res.json({
    authed: true,
    user: {
      userId: payload.sub,
      name: payload.name,
      email: payload.email || null,
      role: payload.role,
      avatarUrl: payload.avatarUrl || null,
    },
  });
});

/**
 * POST /api/auth/logout — Clear JWT cookie
 */
router.post('/logout', (_req, res) => {
  res.clearCookie(JWT_COOKIE_NAME, { path: '/' });
  res.json({ success: true });
});

module.exports = router;
