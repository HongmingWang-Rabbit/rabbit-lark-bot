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
const RABBIT_LARK_API_URL = process.env.RABBIT_LARK_API_URL || 'http://localhost:3456';
const RABBIT_LARK_API_KEY = process.env.RABBIT_LARK_API_KEY || '';

/**
 * Make API request to Rabbit Lark Server
 */
async function apiRequest(endpoint, method = 'GET', body = null) {
  const url = `${RABBIT_LARK_API_URL}${endpoint}`;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${RABBIT_LARK_API_KEY}`,
    },
  };
  
  if (body) {
    options.body = JSON.stringify(body);
  }
  
  const response = await fetch(url, options);
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API request failed: ${response.status} - ${error}`);
  }
  
  return response.json();
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
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Rabbit Lark MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
