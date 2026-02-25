const feishu = require('../feishu/client');
const { audit } = require('../db');
const logger = require('../utils/logger');

// ============ 配置常量 ============
const APP_TOKEN = process.env.REMINDER_APP_TOKEN;
const TABLE_ID = process.env.REMINDER_TABLE_ID;

// 默认截止天数
const DEFAULT_DEADLINE_DAYS = parseInt(process.env.DEFAULT_DEADLINE_DAYS, 10) || 3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// 多维表格字段名（集中管理，便于修改）
const FIELDS = {
  TASK_NAME: '任务名称',
  TARGET: '催办对象',
  DEADLINE: '截止时间',
  STATUS: '状态',
  PROOF: '证明材料',
  NOTE: '备注',
  CREATED_AT: '创建时间',
};

// 状态值
const STATUS = {
  PENDING: '待办',
  IN_PROGRESS: '进行中',
  COMPLETED: '已完成',
};

// ============ 任务查询 ============

/**
 * 获取用户的待办任务
 * @param {string} userId - 飞书用户 ID
 */
async function getUserPendingTasks(userId) {
  const result = await feishu.bitable.searchRecords(APP_TOKEN, TABLE_ID, {
    conjunction: 'and',
    conditions: [{ field_name: FIELDS.STATUS, operator: 'is', value: [STATUS.PENDING] }],
  });

  // 过滤属于该用户的任务
  const tasks = (result.data?.items || []).filter((item) => {
    const target = item.fields[FIELDS.TARGET];
    return Array.isArray(target) && target[0]?.id === userId;
  });

  return tasks;
}

/**
 * 获取所有待办任务
 */
async function getAllPendingTasks() {
  const result = await feishu.bitable.searchRecords(APP_TOKEN, TABLE_ID, {
    conjunction: 'and',
    conditions: [{ field_name: FIELDS.STATUS, operator: 'is', value: [STATUS.PENDING] }],
  });
  return result.data?.items || [];
}

/**
 * 获取所有任务
 * @param {number} pageSize - 每页数量
 */
async function getAllTasks(pageSize = 100) {
  const result = await feishu.bitable.getRecords(APP_TOKEN, TABLE_ID, { pageSize });
  return result.data?.items || [];
}

// ============ 任务操作 ============

/**
 * 创建任务
 * @param {object} params
 * @param {string} params.taskName - 任务名称
 * @param {string} params.targetUserId - 目标用户 ID
 * @param {string} [params.deadline] - 截止日期 (YYYY-MM-DD)
 * @param {string} [params.note] - 备注
 * @param {string} [params.creatorId] - 创建者 ID
 */
async function createTask({ taskName, targetUserId, deadline, note, creatorId }) {
  const now = Date.now();
  const deadlineMs = deadline
    ? new Date(deadline).getTime()
    : now + DEFAULT_DEADLINE_DAYS * MS_PER_DAY;

  const result = await feishu.bitable.createRecord(APP_TOKEN, TABLE_ID, {
    [FIELDS.TASK_NAME]: taskName,
    [FIELDS.TARGET]: [{ id: targetUserId }],
    [FIELDS.DEADLINE]: deadlineMs,
    [FIELDS.STATUS]: STATUS.PENDING,
    [FIELDS.NOTE]: note || '',
    [FIELDS.CREATED_AT]: now,
  });

  const recordId = result.data?.record?.record_id;

  // 记录审计日志
  if (creatorId) {
    await audit.log({
      userId: creatorId,
      action: 'create_task',
      targetType: 'task',
      targetId: recordId,
      details: { taskName, targetUserId, deadline },
    });
  }

  logger.info('Task created', { recordId, taskName, targetUserId });
  return result.data?.record;
}

/**
 * 完成任务
 * @param {string} recordId - 记录 ID
 * @param {string} [proof] - 证明材料链接
 * @param {string} [userId] - 操作用户 ID
 */
async function completeTask(recordId, proof, userId) {
  const fields = { [FIELDS.STATUS]: STATUS.COMPLETED };

  if (proof) {
    fields[FIELDS.PROOF] = { link: proof, text: proof };
  }

  const result = await feishu.bitable.updateRecord(APP_TOKEN, TABLE_ID, recordId, fields);

  if (userId) {
    await audit.log({
      userId,
      action: 'complete_task',
      targetType: 'task',
      targetId: recordId,
      details: { proof },
    });
  }

  logger.info('Task completed', { recordId, proof: !!proof });
  return result;
}

/**
 * 删除任务
 * @param {string} recordId - 记录 ID
 * @param {string} [userId] - 操作用户 ID
 */
async function deleteTask(recordId, userId) {
  const result = await feishu.bitable.deleteRecord(APP_TOKEN, TABLE_ID, recordId);

  if (userId) {
    await audit.log({
      userId,
      action: 'delete_task',
      targetType: 'task',
      targetId: recordId,
      details: {},
    });
  }

  logger.info('Task deleted', { recordId });
  return result;
}

// ============ 工具函数 ============

/**
 * 提取字段文本值
 * 飞书多维表格字段可能返回多种格式
 * @param {any} field - 字段值
 * @returns {string}
 */
function extractFieldText(field) {
  if (field == null) return '';
  if (typeof field === 'string') return field;
  if (Array.isArray(field)) {
    const first = field[0];
    return first?.text || first?.name || first?.id || '';
  }
  if (typeof field === 'object') {
    return field.text || field.name || field.link || '';
  }
  return String(field);
}

module.exports = {
  // 查询
  getUserPendingTasks,
  getAllPendingTasks,
  getAllTasks,
  // 操作
  createTask,
  completeTask,
  deleteTask,
  // 工具
  extractFieldText,
  // 常量
  FIELDS,
  STATUS,
  DEFAULT_DEADLINE_DAYS,
};
