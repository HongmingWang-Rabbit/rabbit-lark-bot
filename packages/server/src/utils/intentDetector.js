/**
 * Intent Detector
 *
 * Lightweight keyword-based intent classification.
 * Used to intercept messages before they reach the AI agent.
 *
 * Intents:
 *   'greeting'         — hi, hello, 你好, 嗨, etc.
 *   'menu'             — explicit menu/help request
 *   'cuiban_view'      — 我的任务, 任务列表, /list, /tasks
 *   'cuiban_complete'  — 完成 [...], done, /done
 *   'cuiban_create'    — /add ...
 *   'command'          — other slash commands
 *   'unknown'          — everything else (let AI handle it)
 */

const GREETING_PATTERNS = [
  // Chinese
  /^(你好|您好|嗨|哈喽|hi|hello|hey|哟|喂|在吗|在不|在|早|早上好|下午好|晚上好|晚安|你好啊|哈哈|嘿|yo|sup|howdy)/i,
  // Short/vague messages (≤4 chars that aren't a command)
];

const MENU_PATTERNS = [
  /^(菜单|帮助|功能|help|menu|我能做什么|能做什么|怎么用|使用说明|指令|命令|我能干嘛|有什么功能)/i,
];

// 催办 view: 我的任务 / 任务列表 / 待办
const CUIBAN_VIEW_PATTERNS = [
  /^(我的任务|任务列表|我的待办|待办任务|查看任务|\/list|\/tasks)$/i,
];

// 催办 complete: 完成... / done / /done / /complete
// Also matches natural language like "test 任务完成" / "报告完成了"
const CUIBAN_COMPLETE_PATTERNS = [
  /^(完成|done|\/done|\/complete)(\s.*)?$/i,
  /^.{1,100}\s*(任务完成|完成了|已完成|done了)(\s+https?:\/\/\S+)?$/i,
];

// 催办 create: /add ... (natural language variants go to AI agent)
const CUIBAN_CREATE_PATTERN = /^\/add(\s|$)/i;

/**
 * Detect the intent of a message.
 * @param {string} text - Raw message text
 * @returns {'greeting' | 'menu' | 'cuiban_view' | 'cuiban_complete' | 'cuiban_create' | 'command' | 'unknown'}
 */
// NOTE: The check order below is load-bearing. The short-message greeting fallback
// at the bottom must come AFTER all command/cuiban patterns, because short strings
// like "完成" (2 chars) or "我的任务" (4 chars) would be mis-classified as greetings
// if the greeting fallback ran first. Do not reorder without a full audit.
function detectIntent(text) {
  if (!text) return 'unknown';
  const trimmed = text.trim();

  // Cuiban create (/add ...) — check before generic slash command catch-all
  if (CUIBAN_CREATE_PATTERN.test(trimmed)) return 'cuiban_create';

  // Explicit slash commands (catch-all for any other /command)
  if (trimmed.startsWith('/')) return 'command';

  // Explicit menu/help request
  for (const pattern of MENU_PATTERNS) {
    if (pattern.test(trimmed)) return 'menu';
  }

  // Cuiban view
  for (const pattern of CUIBAN_VIEW_PATTERNS) {
    if (pattern.test(trimmed)) return 'cuiban_view';
  }

  // Cuiban complete — must come before greeting fallback (e.g. "完成" is 2 chars)
  for (const pattern of CUIBAN_COMPLETE_PATTERNS) {
    if (pattern.test(trimmed)) return 'cuiban_complete';
  }

  // Greeting patterns
  for (const pattern of GREETING_PATTERNS) {
    if (pattern.test(trimmed)) return 'greeting';
  }

  // Very short messages (≤6 chars, no links) are likely greetings or vague chatter.
  // All actionable short commands (完成, 我的任务, etc.) were already matched above.
  if (trimmed.length <= 6 && !trimmed.includes('http')) return 'greeting';

  return 'unknown';
}

module.exports = { detectIntent };
