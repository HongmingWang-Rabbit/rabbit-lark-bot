/**
 * One-time enrichment script: fetch name/email/phone from Feishu Contact API
 * for all users who are currently missing those fields.
 *
 * Usage:
 *   node scripts/enrich-users.js
 *
 * Requires .env to be configured (FEISHU_APP_ID, FEISHU_APP_SECRET, DATABASE_URL / DB_* vars)
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const pool = require('../packages/server/src/db/pool');
const feishu = require('../packages/server/src/feishu/client');

async function main() {
  // Find users missing name OR email
  const { rows: users } = await pool.query(`
    SELECT user_id, open_id, feishu_user_id, name, email, phone
    FROM users
    WHERE (name IS NULL OR name = '')
       OR (email IS NULL OR email = '')
    ORDER BY created_at
  `);

  if (users.length === 0) {
    console.log('✅ All users already have name and email.');
    await pool.end();
    return;
  }

  console.log(`Found ${users.length} user(s) missing name/email. Resolving...\n`);

  for (const user of users) {
    const idToTry = [
      user.feishu_user_id ? { id: user.feishu_user_id, type: 'user_id'  } : null,
      user.open_id        ? { id: user.open_id,        type: 'open_id'  } : null,
    ].filter(Boolean);

    let info = null;
    for (const { id, type } of idToTry) {
      console.log(`  → resolveUserInfo(${type}=${id})`);
      info = await feishu.resolveUserInfo(id, type).catch(() => null);
      if (info) break;
    }

    if (!info) {
      console.log(`  ❌ ${user.open_id || user.user_id}: API returned null (check permissions)\n`);
      continue;
    }

    console.log(`  ✅ Got: name="${info.name}" email="${info.email}" phone="${info.mobile}" feishuUserId="${info.feishuUserId}"`);

    // Update DB — only overwrite NULL/empty fields (COALESCE)
    await pool.query(`
      UPDATE users SET
        name           = COALESCE(NULLIF(name, ''),           $2),
        email          = COALESCE(NULLIF(email, ''),          $3),
        phone          = COALESCE(NULLIF(phone, ''),          $4),
        feishu_user_id = COALESCE(NULLIF(feishu_user_id,''), $5)
      WHERE user_id = $1
    `, [
      user.user_id,
      info.name   || null,
      info.email  || null,
      info.mobile || null,
      info.feishuUserId || null,
    ]);

    console.log(`  💾 Updated user ${user.user_id}\n`);
  }

  // Show final state
  const { rows: final } = await pool.query(
    'SELECT user_id, name, email, phone, feishu_user_id FROM users ORDER BY created_at'
  );
  console.log('─── Final user state ───────────────────────────────');
  final.forEach(u => {
    console.log(`  ${u.name || '(no name)'} | ${u.email || '(no email)'} | ${u.phone || '(no phone)'} | ${u.feishu_user_id || '(no feishu_id)'}`);
  });
  console.log('────────────────────────────────────────────────────');

  await pool.end();
}

main().catch(err => {
  console.error('Script failed:', err.message);
  process.exit(1);
});
