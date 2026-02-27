#!/usr/bin/env node

/**
 * Rabbit Lark MCP Server
 * 
 * Allows AI agents to send/receive messages via Lark through the Rabbit Lark Bot bridge.
 * 
 * Tools:
 * - rabbit_lark_send: Send a message to a Lark chat
 * - rabbit_lark_reply: Reply to a specific message
 * - rabbit_lark_react: React to a message with emoji
 * - rabbit_lark_get_history: Get message history from a chat
 * - rabbit_lark_get_user: Get user info by ID
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// Configuration from environment
const RABBIT_LARK_API_URL = process.env.RABBIT_LARK_API_URL;
const RABBIT_LARK_API_KEY = process.env.RABBIT_LARK_API_KEY || '';
const REQUEST_TIMEOUT_MS = parseInt(process.env.RABBIT_LARK_TIMEOUT_MS) || 30000;

// Validate required config on startup
function validateConfig() {
  if (!RABBIT_LARK_API_URL) {
    console.error('Error: RABBIT_LARK_API_URL environment variable is required');
    console.error('Example: export RABBIT_LARK_API_URL=http://localhost:3456');
    process.exit(1);
  }
}

/**
 * Make API request to Rabbit Lark Server with timeout
 */
async function apiRequest(endpoint, method = 'GET', body = null) {
  const url = `${RABBIT_LARK_API_URL}${endpoint}`;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${RABBIT_LARK_API_KEY}`,
    },
    signal: controller.signal,
  };
  
  if (body) {
    options.body = JSON.stringify(body);
  }
  
  try {
    const response = await fetch(url, options);
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API request failed: ${response.status} - ${error}`);
    }
    
    return response.json();
  } catch (err) {
    clearTimeout(timeoutId);
    
    if (err.name === 'AbortError') {
      throw new Error(`Request timeout after ${REQUEST_TIMEOUT_MS}ms: ${endpoint}`);
    }
    throw err;
  }
}

// Tool definitions
const TOOLS = [
  {
    name: 'rabbit_lark_send',
    description: 'Send a message to a Lark user or group chat',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: {
          type: 'string',
          description: 'The Lark chat ID or user ID to send the message to',
        },
        content: {
          type: 'string',
          description: 'The message content to send',
        },
        msg_type: {
          type: 'string',
          enum: ['text', 'interactive'],
          default: 'text',
          description: 'Message type (text or interactive card)',
        },
      },
      required: ['chat_id', 'content'],
    },
  },
  {
    name: 'rabbit_lark_reply',
    description: 'Reply to a specific Lark message',
    inputSchema: {
      type: 'object',
      properties: {
        message_id: {
          type: 'string',
          description: 'The message ID to reply to',
        },
        content: {
          type: 'string',
          description: 'The reply content',
        },
      },
      required: ['message_id', 'content'],
    },
  },
  {
    name: 'rabbit_lark_react',
    description: 'Add an emoji reaction to a Lark message',
    inputSchema: {
      type: 'object',
      properties: {
        message_id: {
          type: 'string',
          description: 'The message ID to react to',
        },
        emoji: {
          type: 'string',
          description: 'The emoji to react with (e.g., "thumbsup", "heart", "smile")',
        },
      },
      required: ['message_id', 'emoji'],
    },
  },
  {
    name: 'rabbit_lark_get_history',
    description: 'Get message history from a Lark chat',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: {
          type: 'string',
          description: 'The Lark chat ID to get history from',
        },
        limit: {
          type: 'number',
          default: 20,
          description: 'Maximum number of messages to retrieve (default: 20)',
        },
        before: {
          type: 'string',
          description: 'Get messages before this message ID (for pagination)',
        },
      },
      required: ['chat_id'],
    },
  },
  {
    name: 'rabbit_lark_get_user',
    description: 'Get information about a Lark user',
    inputSchema: {
      type: 'object',
      properties: {
        user_id: {
          type: 'string',
          description: 'The Lark user ID',
        },
      },
      required: ['user_id'],
    },
  },

  // ── Task management tools ─────────────────────────────────────────────────

  {
    name: 'rabbit_lark_list_tasks',
    description: 'List pending tasks assigned to a Lark user. Use this when the user asks to see their tasks or when you need to find a task by name before completing it.',
    inputSchema: {
      type: 'object',
      properties: {
        open_id: {
          type: 'string',
          description: 'The Lark open_id (ou_xxx) of the user whose tasks to list. Use the open_id from the current user context.',
        },
      },
      required: ['open_id'],
    },
  },

  {
    name: 'rabbit_lark_complete_task',
    description: 'Mark a task as completed. Use this when the user indicates they have finished a task (e.g. "test 任务完成", "完成了", "done"). First call rabbit_lark_list_tasks to find the task ID if you only have a name.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: {
          type: 'number',
          description: 'The numeric task ID to complete.',
        },
        proof: {
          type: 'string',
          description: 'Optional proof URL or description of completion.',
        },
        user_open_id: {
          type: 'string',
          description: 'The open_id of the user completing the task (for audit log).',
        },
      },
      required: ['task_id'],
    },
  },

  {
    name: 'rabbit_lark_create_task',
    description: 'Create a new reminder task and notify the assignee. Use when the user asks to create or assign a task to someone.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Task title / name.',
        },
        target_open_id: {
          type: 'string',
          description: 'The open_id (ou_xxx) of the user to assign the task to.',
        },
        reporter_open_id: {
          type: 'string',
          description: 'Optional open_id of the user to notify when the task is completed.',
        },
        deadline: {
          type: 'string',
          description: 'Optional deadline in YYYY-MM-DD format.',
        },
        note: {
          type: 'string',
          description: 'Optional additional notes.',
        },
      },
      required: ['title', 'target_open_id'],
    },
  },
];

// Tool handlers
const toolHandlers = {
  async rabbit_lark_send({ chat_id, content, msg_type = 'text' }) {
    const result = await apiRequest('/api/agent/send', 'POST', {
      chat_id,
      content,
      msg_type,
    });
    return { success: true, message_id: result.message_id };
  },

  async rabbit_lark_reply({ message_id, content }) {
    const result = await apiRequest('/api/agent/reply', 'POST', {
      message_id,
      content,
    });
    return { success: true, message_id: result.message_id };
  },

  async rabbit_lark_react({ message_id, emoji }) {
    const result = await apiRequest('/api/agent/react', 'POST', {
      message_id,
      emoji,
    });
    return { success: true };
  },

  async rabbit_lark_get_history({ chat_id, limit = 20, before }) {
    const params = new URLSearchParams({ chat_id, limit: String(limit) });
    if (before) params.append('before', before);
    
    const result = await apiRequest(`/api/agent/history?${params}`);
    return result;
  },

  async rabbit_lark_get_user({ user_id }) {
    const result = await apiRequest(`/api/agent/user/${user_id}`);
    return result;
  },

  async rabbit_lark_list_tasks({ open_id }) {
    const result = await apiRequest(`/api/agent/tasks?open_id=${encodeURIComponent(open_id)}`);
    return result;
  },

  async rabbit_lark_complete_task({ task_id, proof, user_open_id }) {
    const result = await apiRequest(`/api/agent/tasks/${task_id}/complete`, 'POST', {
      proof: proof || '',
      user_open_id: user_open_id || '',
    });
    return result;
  },

  async rabbit_lark_create_task({ title, target_open_id, reporter_open_id, deadline, note }) {
    const result = await apiRequest('/api/agent/tasks', 'POST', {
      title,
      target_open_id,
      reporter_open_id: reporter_open_id || null,
      deadline: deadline || null,
      note: note || null,
    });
    return result;
  },
};

// Create and configure server
const server = new Server(
  {
    name: 'rabbit-lark-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register tool list handler
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

// Register tool call handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  const handler = toolHandlers[name];
  if (!handler) {
    throw new Error(`Unknown tool: ${name}`);
  }
  
  try {
    const result = await handler(args);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  validateConfig();
  
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Rabbit Lark MCP Server running on stdio');
  console.error(`API URL: ${RABBIT_LARK_API_URL}`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
