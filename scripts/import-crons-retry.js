/**
 * Retry the 20 failed records from import-crons.js
 */
const API_BASE = 'http://localhost:3456';
const API_KEY = 'e8c1deaeb19a47762e23a69f8da77d3ff2d1643d717088ed39570def3c8a796c';
const TZ = 'America/Toronto';

const failedRecords = [
  { name: '更新菜品物料号', schedule: '0 8 5 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '新增菜品匹配每个门店的物料号', deadlineDays: 5 },
  { name: '新菜品维护给总部', schedule: '0 8 5 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '新菜品维护给总部', deadlineDays: 5 },
  { name: '门店工资计提表提交', schedule: '0 8 1 * *', assignees: ['ou_9f9b02d3d4bb3d6689dd5ddd2beeaaeb'], sop: '1-2店文员给工资计提表格；3-5店jane提交工资计提表格发给共享做账计提', deadlineDays: 5 },
  { name: '2026年加拿大片区产品爆款', schedule: '0 8 5 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '填报此表中L和M这两列销售收入数据，品类销售额按大类统计', deadlineDays: 5 },
  { name: '数据要求（存货/固定资产监盘）', schedule: '0 8 25 * *', assignees: ['ou_1c8264871e86c3e61ab96e7d365e699f', 'ou_7ac0aa0043728927da99b255917d49e0'], sop: '存货/监盘地方/固定资产监盘下个月和这个月', deadlineDays: 5 },
  { name: '催门店给工资和计提表', schedule: '0 8 20 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '催门店给工资和计提表', deadlineDays: 5 },
  { name: '数据要求（vocation工资/创新奖金）', schedule: '0 8 20 * *', assignees: ['ou_9f9b02d3d4bb3d6689dd5ddd2beeaaeb'], sop: 'vocation工资/创新奖金/', deadlineDays: 5 },
  { name: '数据要求（借款续签）', schedule: '0 8 15 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '借款续签', deadlineDays: 5 },
  { name: '电力排查', schedule: '0 8 10 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '电力排查', deadlineDays: 5 },
  { name: '酒水差异对比', schedule: '0 8 10 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '提交酒水差异表格', deadlineDays: 5 },
  { name: '银行账户开设', schedule: '0 8 1 * *', assignees: ['ou_9f9b02d3d4bb3d6689dd5ddd2beeaaeb'], sop: '根据总部资金池规划，优选花旗、汇丰、大华银行开设公司银行账户，填写开户申请表', deadlineDays: 30, enabled: false },
  { name: '门店库管文员相关业务培训', schedule: '0 8 1 * *', assignees: ['ou_9f9b02d3d4bb3d6689dd5ddd2beeaaeb', 'ou_7ac0aa0043728927da99b255917d49e0'], sop: '门店库管文员相关业务培训', deadlineDays: 30, enabled: false },
  { name: '小费约取', schedule: '0 8 1 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '收到门店发来小费约取邮件后，登记加拿大片区小费约取登记表，按提单号检查审批状态是否完成，必须在审批完毕后才可将邮件转发银行', deadlineDays: 1 },
  { name: '日常沟通及跟踪', schedule: '0 8 * * 1', assignees: ['ou_9f9b02d3d4bb3d6689dd5ddd2beeaaeb', 'ou_7ac0aa0043728927da99b255917d49e0', 'ou_1c8264871e86c3e61ab96e7d365e699f'], sop: '催办及工作及时回复', deadlineDays: 7 },
  { name: '下店检查', schedule: '0 8 1 * *', assignees: ['ou_9f9b02d3d4bb3d6689dd5ddd2beeaaeb', 'ou_7ac0aa0043728927da99b255917d49e0'], sop: '根据下店管理清单表打卡明细、固定资产盘点、备用金小费盘点下店并写下店报告', deadlineDays: 30, enabled: false },
];

async function createScheduledTask(payload) {
  const res = await fetch(`${API_BASE}/api/scheduled-tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  let created = 0, failCount = 0;
  for (const record of failedRecords) {
    for (const assigneeOpenId of record.assignees) {
      const payload = {
        name: record.name,
        title: record.name,
        targetOpenId: assigneeOpenId,
        schedule: record.schedule,
        timezone: TZ,
        deadlineDays: record.deadlineDays,
        priority: 'p1',
        note: record.sop || null,
        reminderIntervalHours: 24,
        enabled: record.enabled !== false,
      };
      try {
        const result = await createScheduledTask(payload);
        console.log(`✅ [${result.id}] ${record.name} (${assigneeOpenId.slice(-6)}) @ ${record.schedule}`);
        created++;
      } catch (err) {
        console.error(`❌ ${record.name}: ${err.message}`);
        failCount++;
      }
      await new Promise(r => setTimeout(r, 300)); // 300ms between requests
    }
  }
  console.log(`\n✅ Done: ${created} created, ${failCount} failed`);
}

main().catch(console.error);
