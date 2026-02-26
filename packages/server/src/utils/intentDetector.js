/**
 * Intent Detector
 *
 * Lightweight keyword-based intent classification.
 * Used to intercept messages before they reach the AI agent.
 *
 * Intents:
 *   'greeting'  — hi, hello, 你好, 嗨, etc.
 *   'menu'      — explicit menu/help request
 *   'command'   — starts with /
 *   'unknown'   — everything else (let AI handle it)
 */

const GREETING_PATTERNS = [
  // Chinese
  /^(你好|您好|嗨|哈喽|hi|hello|hey|哟|喂|在吗|在不|在|早|早上好|下午好|晚上好|晚安|你好啊|哈哈|嘿|yo|sup|howdy)/i,
  // Short/vague messages (≤4 chars that aren't a command)
];

const MENU_PATTERNS = [
  /^(菜单|帮助|功能|help|menu|我能做什么|能做什么|怎么用|使用说明|指令|命令|我能干嘛|有什么功能)/i,
];

/**
 * Detect the intent of a message.
 * @param {string} text - Raw message text
 * @returns {'greeting' | 'menu' | 'command' | 'unknown'}
 */
function detectIntent(text) {
  if (!text) return 'unknown';
  const trimmed = text.trim();

  // Explicit slash commands
  if (trimmed.startsWith('/')) return 'command';

  // Explicit menu/help request
  for (const pattern of MENU_PATTERNS) {
    if (pattern.test(trimmed)) return 'menu';
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
