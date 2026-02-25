const feishu = require('../feishu/client');
const { audit } = require('../db');

const APP_TOKEN = process.env.REMINDER_APP_TOKEN;
const TABLE_ID = process.env.REMINDER_TABLE_ID;

// 获取用户的待办任务
async function getUserPendingTasks(userId) {
  const result = await feishu.bitable.searchRecords(APP_TOKEN, TABLE_ID, {
    conjunction: 'and',
    conditions: [
      { field_name: '状态', operator: 'is', value: ['待办'] }
    ]
  });

  // 过滤属于该用户的任务
  const tasks = (result.data?.items || []).filter(item => {
    const target = item.fields['催办对象'];
    if (Array.isArray(target) && target[0]?.id === userId) return true;
    return false;
  });

  return tasks;
}

// 获取所有待办任务
async function getAllPendingTasks() {
  const result = await feishu.bitable.searchRecords(APP_TOKEN, TABLE_ID, {
    conjunction: 'and',
    conditions: [
      { field_name: '状态', operator: 'is', value: ['待办'] }
    ]
  });
  return result.data?.items || [];
}

// 获取所有任务
async function getAllTasks() {
  const result = await feishu.bitable.getRecords(APP_TOKEN, TABLE_ID, { pageSize: 100 });
  return result.data?.items || [];
}

// 创建任务
async function createTask({ taskName, targetUserId, deadline, note, creatorId }) {
  const now = Date.now();
  const deadlineMs = deadline ? new Date(deadline).getTime() : now + 3 * 24 * 60 * 60 * 1000;

  const result = await feishu.bitable.createRecord(APP_TOKEN, TABLE_ID, {
    '任务名称': taskName,
    '催办对象': [{ id: targetUserId }],
    '截止时间': deadlineMs,
    '状态': '待办',
    '备注': note || '',
    '创建时间': now
  });

  // 记录审计日志
  await audit.log({
    userId: creatorId,
    action: 'create_task',
    targetType: 'task',
    targetId: result.data?.record?.record_id,
    details: { taskName, targetUserId, deadline }
  });

  return result.data?.record;
}

// 完成任务
async function completeTask(recordId, proof, userId) {
  const fields = { '状态': '已完成' };
  if (proof) {
    fields['证明材料'] = { link: proof, text: proof };
  }

  const result = await feishu.bitable.updateRecord(APP_TOKEN, TABLE_ID, recordId, fields);

  await audit.log({
    userId,
    action: 'complete_task',
    targetType: 'task',
    targetId: recordId,
    details: { proof }
  });

  return result;
}

// 删除任务
async function deleteTask(recordId, userId) {
  const result = await feishu.bitable.deleteRecord(APP_TOKEN, TABLE_ID, recordId);

  await audit.log({
    userId,
    action: 'delete_task',
    targetType: 'task',
    targetId: recordId,
    details: {}
  });

  return result;
}

// 提取字段文本值
function extractFieldText(field) {
  if (Array.isArray(field)) {
    return field[0]?.text || field[0]?.name || field[0]?.id || '';
  }
  return field || '';
}

module.exports = {
  getUserPendingTasks,
  getAllPendingTasks,
  getAllTasks,
  createTask,
  completeTask,
  deleteTask,
  extractFieldText
};
