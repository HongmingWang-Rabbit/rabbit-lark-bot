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

// 催办 create: /add ... or natural language like "给王鸿铭发一个催办"
const CUIBAN_CREATE_PATTERN = /^\/add(\s|$)/i;
const CUIBAN_CREATE_NL_PATTERNS = [
  // 给X发/送催办/任务
  /给(.{1,20}?)(?:发|送)(?:一?个?)?(?:催办|催一下|任务|提醒)/,
  // 催一下/催催X
  /催(?:一下|催|一催)?(.{1,20}?)(?:完成|做|交|提交|处理)?/,
  // 发催办给X
  /(?:发|送)催办给(.{1,20})/,
  // X还没有完成/提交 → create reminder
  /(.{1,20}?)还没(?:有)?(?:完成|提交|做|交)/,
];

/**
 * Detect the intent of a message.
 * @param {string} text - Raw message text
 * @returns {'greeting' | 'menu' | 'cuiban_view' | 'cuiban_complete' | 'cuiban_create' | 'command' | 'unknown'}
 */
function detectIntent(text) {
  if (!text) return 'unknown';
  const trimmed = text.trim();

  // Cuiban create (/add ...) — check before generic slash command
  if (CUIBAN_CREATE_PATTERN.test(trimmed)) return 'cuiban_create';

  // Natural language cuiban create (e.g. "给王鸿铭发一个催办")
  if (trimmed.includes('催办') || trimmed.includes('催一下') || trimmed.includes('催催')) {
    // Make sure it's not just viewing tasks
    if (!CUIBAN_VIEW_PATTERNS.some(p => p.test(trimmed))) {
      return 'cuiban_create_nl';
    }
  }

  // Explicit slash commands (catch-all)
  if (trimmed.startsWith('/')) return 'command';

  // Explicit menu/help request
  for (const pattern of MENU_PATTERNS) {
    if (pattern.test(trimmed)) return 'menu';
  }

  // Cuiban view
  for (const pattern of CUIBAN_VIEW_PATTERNS) {
    if (pattern.test(trimmed)) return 'cuiban_view';
  }

  // Cuiban complete
  for (const pattern of CUIBAN_COMPLETE_PATTERNS) {
    if (pattern.test(trimmed)) return 'cuiban_complete';
  }

  // Greeting patterns
  for (const pattern of GREETING_PATTERNS) {
    if (pattern.test(trimmed)) return 'greeting';
  }

  // Very short messages (≤6 chars, no links) are likely greetings or vague
  if (trimmed.length <= 6 && !trimmed.includes('http')) return 'greeting';

  return 'unknown';
}

module.exports = { detectIntent };
