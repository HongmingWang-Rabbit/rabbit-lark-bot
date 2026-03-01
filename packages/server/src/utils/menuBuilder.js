/**
 * Menu Builder
 *
 * Builds a personalized feature menu for a user based on their resolved features.
 * Groups features into sections and only shows what the user can actually do.
 */

const { resolveFeatures } = require('../features');

/**
 * Feature definitions for menu display.
 * Each entry maps to a feature id and shows the command + description.
 */
const MENU_SECTIONS = [
  {
    title: '📋 催办任务',
    items: [
      {
        feature: 'cuiban_view',
        command: '我的任务',
        desc: '查看分配给你的待办任务',
      },
      {
        feature: 'cuiban_complete',
        command: '完成 [任务名]',
        desc: '标记任务为已完成（可附证明链接）',
      },
      {
        feature: 'cuiban_create',
        command: '/add 任务名 邮箱 [YYYY-MM-DD]',
        desc: '创建催办任务并分配给他人，例：/add 提交报告 user@company.com 2026-03-15',
      },
    ],
  },
  {
    title: '📊 历史记录',
    items: [
      {
        feature: 'history',
        command: '历史记录',
        desc: '查看最近的聊天和任务历史',
      },
    ],
  },
  {
    title: '⚙️ 管理功能',
    items: [
      {
        feature: 'user_manage',
        command: '/users',
        desc: '查看和管理所有用户',
      },
      {
        feature: 'feature_manage',
        command: '/grant @用户 功能名',
        desc: '授予或撤销用户的功能权限',
      },
      {
        feature: 'system_config',
        command: '/config',
        desc: '查看和修改系统配置',
      },
    ],
  },
];

/**
 * Build a personalized menu message for a user.
 *
 * @param {{ role: string, configs: object, name?: string }} user - User record
 * @param {{ isGreeting?: boolean }} opts
 * @returns {string} Formatted menu message
 */
function buildMenu(user, opts = {}) {
  const features = resolveFeatures(user);
  const name = user.name ? `，${user.name}` : '';
  const roleLabel = { superadmin: '超级管理员', admin: '管理员', user: '用户' }[user.role] || '用户';

  let msg = opts.isGreeting
    ? `👋 你好${name}！（${roleLabel}）\n`
    : `📱 功能菜单（${roleLabel}）\n`;
  msg += '以下是你有权限使用的功能，请直接用自然语言描述你的需求：\n';

  let hasAnyFeature = false;

  for (const section of MENU_SECTIONS) {
    const visibleItems = section.items.filter((item) => features[item.feature]);
    if (visibleItems.length === 0) continue;

    hasAnyFeature = true;
    msg += `\n${section.title}\n`;
    for (const item of visibleItems) {
      msg += `  • ${item.command}\n    ${item.desc}\n`;
    }
  }

  if (!hasAnyFeature) {
    msg += '\n⚠️ 你目前没有任何可用功能，请联系管理员开通权限。';
    return msg;
  }

  msg += '\n💡 发送「菜单」随时查看此列表';

  return msg;
}

module.exports = { buildMenu };
