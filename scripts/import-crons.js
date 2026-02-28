/**
 * Bulk import scheduled tasks from Feishu Bitable records.
 * Run with: node scripts/import-crons.js
 */
const API_BASE = 'http://localhost:3456';
const API_KEY = 'e8c1deaeb19a47762e23a69f8da77d3ff2d1643d717088ed39570def3c8a796c';
const TZ = 'America/Toronto';

// Bitable records (already fetched)
const records = [
  // ========== 每日任务 (Daily) ==========
  { name: '提交资金日报表', freq: '每日任务', assignees: ['ou_1c8264871e86c3e61ab96e7d365e699f'], sop: '下午16:00前完成资金余额填写并上传至飞书云盘；线下付款登记、支票登记每日登记；每日银行明细下载，标注用途并发放到共享群' },
  { name: '冲单、回单', freq: '每日任务', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '冲单审批每日批复，银行回单索取' },
  { name: '经营日报', freq: '每日任务', assignees: ['ou_1c8264871e86c3e61ab96e7d365e699f'], sop: '每日9点半点前完成，同比，环比表格' },
  { name: '维护税率', freq: '每日任务', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '海豹系统维护新菜品的税率' },
  { name: '提交付款申请', freq: '每日任务', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '每天下班前提交第二天需要支付内部转款、bill payment、信用卡还款、新超海的付款申请明细至hwfksq邮箱' },
  { name: '营销活动审批', freq: '每日任务', assignees: ['ou_9f9b02d3d4bb3d6689dd5ddd2beeaaeb'], sop: '营销活动审批' },

  // ========== 每周任务 (Weekly) ==========
  { name: '周一发放外卖和个时间段同比差异', freq: '每周任务', cronOverride: '0 8 * * 1', assignees: ['ou_1c8264871e86c3e61ab96e7d365e699f'], sop: '周一发放外卖和个时间段同比差异' },
  { name: '周一发放免单清单、分时段/外卖收入/报送', freq: '每周任务', cronOverride: '0 8 * * 1', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '周一发放免单清单、分时段/外卖收入/报送' },
  { name: '周报', freq: '每周任务', cronOverride: '0 8 * * 0', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '每月月初不用写周报有月报会，中间星期每周周日做好发出来' },
  { name: '信用卡（周报表）', freq: '每周任务', cronOverride: '0 8 * * 1', assignees: ['ou_1c8264871e86c3e61ab96e7d365e699f'], sop: '信用卡每周一发放明细，每月发放月结单到门店及职能部门' },

  // ========== 月初/月末任务 ==========
  // Month-start tasks (1st)
  { name: 'zfi0187新增物料维护上传', freq: '月初/月末任务', cronOverride: '0 8 1 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '对比找出新增物料，发总部财务维护zfi0187', deadlineDays: 3 },
  { name: 'hi bowl/总仓开发票', freq: '月初/月末任务', cronOverride: '0 8 1 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '开发票', deadlineDays: 3 },
  { name: '银行明细上传', freq: '月初/月末任务', cronOverride: '0 8 1 * *', assignees: ['ou_1c8264871e86c3e61ab96e7d365e699f'], sop: '上传银行明细/银行对账单/支票登记。线下登记表', deadlineDays: 3 },
  { name: '信用卡提报', freq: '月初/月末任务', cronOverride: '0 8 1 * *', assignees: ['ou_1c8264871e86c3e61ab96e7d365e699f', 'ou_7ac0aa0043728927da99b255917d49e0'], sop: '提醒文员报销信用卡(每周催一下)', deadlineDays: 30 },
  { name: '新增门店工资分摊', freq: '月初/月末任务', cronOverride: '0 8 1 * *', assignees: ['ou_9f9b02d3d4bb3d6689dd5ddd2beeaaeb'], sop: '门店工资分摊', deadlineDays: 5 },
  // Month-end tasks (28th safe last-of-month approx)
  { name: '员工餐盘点', freq: '月初/月末任务', cronOverride: '0 8 28 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '检查员工餐是否出完/库管的提交盘点表', deadlineDays: 3 },
  { name: 'KSB1账务检查（月末）', freq: '月初/月末任务', cronOverride: '0 8 28 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '水电气有需要计提未计提，保险房租、洗碗费用每月正常应该入费用的有没有入；做账做错成本中心', deadlineDays: 3 },
  { name: '检查备用金额盘点情况', freq: '月初/月末任务', cronOverride: '0 8 28 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '每月最后一天中午12点前，文员需将自家门店备用金情况盘点后在报销系统中提单，12点后检查提单情况，还未提单的及时提醒', deadlineDays: 3 },
  { name: '入库检查', freq: '月初/月末任务', cronOverride: '0 8 28 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '检查库管是否入库完毕', deadlineDays: 3 },
  { name: '门店盘点财务监盘', freq: '月初/月末任务', cronOverride: '0 8 28 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0', 'ou_1c8264871e86c3e61ab96e7d365e699f'], sop: '每月最后一天，财务要选择区域1家门店进行监盘', deadlineDays: 3 },

  // ========== 临时专项任务 mapped to monthly date ==========
  // Day 1
  { name: '银行明细对账单上传', freq: '临时专项任务', cronOverride: '0 8 1 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '每月1日上传云盘银行明细对账单', deadlineDays: 3 },
  { name: '红火台账单导出', freq: '临时专项任务', cronOverride: '0 8 1 * *', assignees: ['ou_1c8264871e86c3e61ab96e7d365e699f'], sop: '导出红火台账单流水、菜品明细、营业汇总明细留存', deadlineDays: 5 },
  { name: 'hi bowl报表', freq: '临时专项任务', cronOverride: '0 8 1 * *', assignees: ['ou_1c8264871e86c3e61ab96e7d365e699f'], sop: '1号营收表', deadlineDays: 3 },
  { name: '工时对比', freq: '临时专项任务', cronOverride: '0 8 1 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '每期工资发放后，对比实发工资工时与用工跟踪表填报的数据差异', deadlineDays: 5 },
  { name: '工资核对、用工跟踪表与实发工资工时对比', freq: '临时专项任务', cronOverride: '0 8 1 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '每月工资分两期发放，每期工资发完后，对工资明细与银行出账进行核对，按门店。部门、工资各项目分类统计', deadlineDays: 5 },
  { name: '更新经营底表', freq: '临时专项任务', cronOverride: '0 8 1 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0', 'ou_1c8264871e86c3e61ab96e7d365e699f'], sop: '根据报表数据，重新更新一版上月实际数和第一次预测数据，并填报滚动更新表', deadlineDays: 5 },
  // Day 2
  { name: '外卖收入环比', freq: '临时专项任务', cronOverride: '0 8 2 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '3号之前导出外卖收入环比', deadlineDays: 1 },
  { name: '信用卡对账单下载', freq: '临时专项任务', cronOverride: '0 8 2 * *', assignees: ['ou_1c8264871e86c3e61ab96e7d365e699f'], sop: '每月2号下载BMO/RBC信用卡对账单，并发给相关部门及门店', deadlineDays: 1 },
  // Day 3
  { name: '盘点', freq: '临时专项任务', cronOverride: '0 8 3 * *', assignees: ['ou_1c8264871e86c3e61ab96e7d365e699f', 'ou_7ac0aa0043728927da99b255917d49e0', 'ou_9f9b02d3d4bb3d6689dd5ddd2beeaaeb'], sop: '完成盘点表编辑发库管确认，与库管核实无误后，财务进系统复核，sap(zfi0186)过账，把盘点签字表PDF版本上传网盘留存', deadlineDays: 5 },
  { name: '盘点对比', freq: '临时专项任务', cronOverride: '0 8 3 * *', assignees: ['ou_1c8264871e86c3e61ab96e7d365e699f', 'ou_7ac0aa0043728927da99b255917d49e0', 'ou_9f9b02d3d4bb3d6689dd5ddd2beeaaeb'], sop: '门店环比盘点差异正负2%查找原因（毛利率差异）', deadlineDays: 5 },
  { name: '人事厨政月度数据提供', freq: '临时专项任务', cronOverride: '0 8 3 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '人事、厨政月度数据提供', deadlineDays: 5 },
  // Day 4 (月初 general)
  { name: '确认管理报表', freq: '临时专项任务', cronOverride: '0 8 4 * *', assignees: ['ou_9f9b02d3d4bb3d6689dd5ddd2beeaaeb'], sop: '晚上跟共享确认', deadlineDays: 2 },
  { name: '核对总部报表', freq: '临时专项任务', cronOverride: '0 8 4 * *', assignees: ['ou_9f9b02d3d4bb3d6689dd5ddd2beeaaeb'], sop: '管理报表群发出报表核对', deadlineDays: 2 },
  // Day 5
  { name: '损益对比', freq: '临时专项任务', cronOverride: '0 8 5 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0', 'ou_9f9b02d3d4bb3d6689dd5ddd2beeaaeb'], sop: '早上12点前完成各门店损益对比', deadlineDays: 2 },
  { name: '映射表更新', freq: '临时专项任务', cronOverride: '0 8 5 * *', assignees: ['ou_1c8264871e86c3e61ab96e7d365e699f'], sop: '提供每月映射表更新内容给张莹', deadlineDays: 3 },
  // Day 6
  { name: '出具报表分析', freq: '临时专项任务', cronOverride: '0 8 6 * *', assignees: ['ou_9f9b02d3d4bb3d6689dd5ddd2beeaaeb', 'ou_7ac0aa0043728927da99b255917d49e0', 'ou_1c8264871e86c3e61ab96e7d365e699f'], sop: '出具报表分析，8日下班前提交至hwcwb邮箱', deadlineDays: 2 },
  { name: '分析附表毛利率', freq: '临时专项任务', cronOverride: '0 8 6 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0', 'ou_1c8264871e86c3e61ab96e7d365e699f'], sop: '做附表3毛利率，写分析报告毛利率部分', deadlineDays: 2 },
  { name: '营销活动复盘（月初）', freq: '临时专项任务', cronOverride: '0 8 6 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '每半月-20号/整月核对一次活动-出报表的营销活动报告出次月6号', deadlineDays: 2 },
  // Day 7
  { name: '做分析附表', freq: '临时专项任务', cronOverride: '0 8 7 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0', 'ou_1c8264871e86c3e61ab96e7d365e699f'], sop: '做附表2收入、附表3毛利率、维护毛利率用基础数据、附表4人工成本、贴工资', deadlineDays: 2 },
  // Day 8 (out by day 8)
  { name: '出具本月管理报表', freq: '临时专项任务', cronOverride: '0 8 3 * *', assignees: ['ou_9f9b02d3d4bb3d6689dd5ddd2beeaaeb'], sop: '从系统导出本月管理报表', deadlineDays: 5 },
  { name: '店经理报表', freq: '临时专项任务', cronOverride: '0 8 7 * *', assignees: ['ou_9f9b02d3d4bb3d6689dd5ddd2beeaaeb'], sop: '贴店经理报表、片区报表发送各个店经理及大区经理', deadlineDays: 2 },
  { name: '手工做账明细发给杨晶哥', freq: '临时专项任务', cronOverride: '0 8 7 * *', assignees: ['ou_9f9b02d3d4bb3d6689dd5ddd2beeaaeb'], sop: '手工做账明细发给杨晶哥', deadlineDays: 2 },
  // Day 10
  { name: '报表浮动指标原因回复', freq: '临时专项任务', cronOverride: '0 8 10 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0', 'ou_1c8264871e86c3e61ab96e7d365e699f', 'ou_9f9b02d3d4bb3d6689dd5ddd2beeaaeb'], sop: '每月回复总部关于报表中异常浮动指标的环比同比变动原因', deadlineDays: 5 },
  { name: '调拨记录', freq: '临时专项任务', cronOverride: '0 8 10 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '每月把各门店间调拨记录导出，生成PDF文件，发门店确认签字回传，上传网盘留存', deadlineDays: 7 },
  { name: '报表分析会（月报ppt）', freq: '临时专项任务', cronOverride: '0 8 10 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '月报会ppt制作', deadlineDays: 5 },
  // Day 15
  { name: '检查借款合同续签', freq: '临时专项任务', cronOverride: '0 8 15 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '每月中检查与金融公司的合同，是否有到期的，如果有操作续签流程', deadlineDays: 5 },
  { name: '银行余额核对', freq: '临时专项任务', cronOverride: '0 8 15 * *', assignees: ['ou_1c8264871e86c3e61ab96e7d365e699f'], sop: 'zfi0032和银行对账单核对', deadlineDays: 5 },
  { name: 'KSB1账务复核（月中）', freq: '临时专项任务', cronOverride: '0 8 15 * *', assignees: ['ou_1c8264871e86c3e61ab96e7d365e699f', 'ou_7ac0aa0043728927da99b255917d49e0', 'ou_9f9b02d3d4bb3d6689dd5ddd2beeaaeb'], sop: '最后一天检查出来的问题是否改完，水电气有需要计提未计提；做账做错成本中心', deadlineDays: 5 },
  { name: '检查出入库业务', freq: '临时专项任务', cronOverride: '0 8 15 * *', assignees: ['ou_1c8264871e86c3e61ab96e7d365e699f', 'ou_7ac0aa0043728927da99b255917d49e0'], sop: 's_alr_87012013. 看一下物料有没有入错，固定资产是不是入到了费用里，工程门店、总仓不应该有成本；KSB1', deadlineDays: 5 },
  { name: '经营预测-第一次', freq: '临时专项任务', cronOverride: '0 8 15 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0', 'ou_9f9b02d3d4bb3d6689dd5ddd2beeaaeb'], sop: '邮件转发提供当年或者当月经营预测；数据要发店经理大区经理确认', deadlineDays: 5 },
  // Day 17
  { name: '营销活动复盘（月中）', freq: '临时专项任务', cronOverride: '0 8 17 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '每半月/整月核对一次活动（17号之后待1-15号营业数据出来后复盘）', deadlineDays: 5 },
  // Day 20
  { name: '关注银行余额是否够发工资（20日）', freq: '临时专项任务', cronOverride: '0 8 20 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0', 'ou_1c8264871e86c3e61ab96e7d365e699f'], sop: '每月20日关注银行余额是否够发工资，BMO3817账户余额不少于80万，BMO其余账户余额不少于25万', deadlineDays: 3 },
  { name: '经营预测-第二次', freq: '临时专项任务', cronOverride: '0 8 20 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0', 'ou_9f9b02d3d4bb3d6689dd5ddd2beeaaeb'], sop: '邮件转发提供当年或者当月经营预测（第二次）；数据要发店经理大区经理确认', deadlineDays: 5 },
  // Day 25
  { name: '检查RBC5401余额是否够交税', freq: '临时专项任务', cronOverride: '0 8 25 * *', assignees: ['ou_1c8264871e86c3e61ab96e7d365e699f', 'ou_7ac0aa0043728927da99b255917d49e0'], sop: '每月25日检查RBC5401余额是否够交税，如不足，及时补充', deadlineDays: 3 },
  { name: '收下个月预测', freq: '临时专项任务', cronOverride: '0 8 25 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '发送给店经理收集下个月的预测数据根据报表数据，重新更新一版第一次预测数据，并填报滚动更新表', deadlineDays: 5 },
  { name: '经营预测-第三次', freq: '临时专项任务', cronOverride: '0 8 25 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0', 'ou_9f9b02d3d4bb3d6689dd5ddd2beeaaeb'], sop: '邮件转发提供当年或者当月经营预测（第三次）；数据要发店经理大区经理确认', deadlineDays: 5 },
  // Day 28-29 (end of month proxy)
  { name: '关注银行余额是否够发工资（30日）', freq: '临时专项任务', cronOverride: '0 8 29 * *', assignees: ['ou_1c8264871e86c3e61ab96e7d365e699f', 'ou_7ac0aa0043728927da99b255917d49e0'], sop: '每月30日关注银行余额是否够发工资，BMO3817账户余额不少于80万，BMO其余各账户余额不少于25万', deadlineDays: 2 },
  { name: '备用金盘点', freq: '临时专项任务', cronOverride: '0 8 29 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '每月30号提交费用报销系统（门店文员、部门专员）完成 hi bowl也要看9451、8店的备用金6000加币', deadlineDays: 2 },
  // Quarterly (every 3/6/9/12 months)
  { name: '固定资产盘点', freq: '临时专项任务', cronOverride: '0 8 1 3,6,9,12 *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '每年3月、6月、9月、12月根据各分店资产明细进行盘点，23日提供资产误差数量给分店经理，按照公司《固定资产管理办法》处理，28日将处理结果提交至hwcwb邮箱', deadlineDays: 27 },
  // Various monthly (1st is fine)
  { name: '纳税申报', freq: '临时专项任务', cronOverride: '0 8 15 * *', assignees: ['ou_9f9b02d3d4bb3d6689dd5ddd2beeaaeb', 'ou_7ac0aa0043728927da99b255917d49e0'], sop: '在费用报销系统中提报withholding tax/gst/pst/qst提单，并在银行中支付；付款信息、workpaper提交到hwcwb邮箱', deadlineDays: 5 },
  { name: '信用卡还款统计', freq: '临时专项任务', cronOverride: '0 8 5 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0', 'ou_1c8264871e86c3e61ab96e7d365e699f'], sop: 'hongming通知cindy信用卡欠款金额; cindy操作还款，提交申请给资金', deadlineDays: 3 },
  { name: '工作总结', freq: '临时专项任务', cronOverride: '0 8 28 * *', assignees: ['ou_1c8264871e86c3e61ab96e7d365e699f', 'ou_7ac0aa0043728927da99b255917d49e0'], sop: '提交工作总结', deadlineDays: 3 },
  { name: '回复KPMG税务申报问题', freq: '临时专项任务', cronOverride: '0 8 1 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '以收到邮件时间为准，每月回复KPMG关于税务申报相关问题，提供相关发票', deadlineDays: 5 },
  { name: '更新租赁台账', freq: '临时专项任务', cronOverride: '0 8 1 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '以收到邮件时间为准，每月更新工程、租赁台账', deadlineDays: 5 },
  { name: '损耗大的菜品与各门店库管沟通', freq: '临时专项任务', cronOverride: '0 8 10 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '每月把附表3中损耗较大的菜品与库管沟通，查找原因', deadlineDays: 5 },
  { name: '检查5个网盘记录', freq: '临时专项任务', cronOverride: '0 8 5 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '检查加拿大、美国、印尼的5个网盘记录是否上传及时', deadlineDays: 3 },
  { name: '七个不放过', freq: '临时专项任务', cronOverride: '0 8 5 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '提交七个不放过', deadlineDays: 5 },
  { name: '七个不放过总部会议', freq: '临时专项任务', cronOverride: '0 8 10 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '七个不放过总部会议/七个不放过总部复盘会', deadlineDays: 5 },
  { name: '数据需求（离职人数）', freq: '临时专项任务', cronOverride: '0 8 1 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '离职人数jack，附表4里面的人数', deadlineDays: 5 },
  { name: '表格统计提交（盘点问题）', freq: '临时专项任务', cronOverride: '0 8 10 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '提交门店盘点问题表格', deadlineDays: 5 },
  { name: 'zmm0051入库差异', freq: '临时专项任务', cronOverride: '0 8 5 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '从SAP中导出入库差异，发门店确认原因，是否需要冲销', deadlineDays: 5 },
  { name: 'hi bowl的报告', freq: '临时专项任务', cronOverride: '0 8 1 * *', assignees: ['ou_1c8264871e86c3e61ab96e7d365e699f'], sop: 'hi bowl的报告', deadlineDays: 5 },
  { name: '新增菜品分类确认', freq: '临时专项任务', cronOverride: '0 8 5 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '以收到总部邮件时间为准，把每月新增菜品进行分类，网上填报', deadlineDays: 5 },
  { name: '更新菜品物料号', freq: '临时专项任务', cronOverride: '0 8 5 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '新增菜品匹配每个门店的物料号', deadlineDays: 5 },
  { name: '新菜品维护给总部', freq: '临时专项任务', cronOverride: '0 8 5 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '新菜品维护给总部', deadlineDays: 5 },
  { name: '门店工资计提表提交', freq: '临时专项任务', cronOverride: '0 8 1 * *', assignees: ['ou_9f9b02d3d4bb3d6689dd5ddd2beeaaeb'], sop: '1-2店文员给工资计提表格；3-5店jane提交工资计提表格发给共享做账计提', deadlineDays: 5 },
  { name: '2026年加拿大片区产品爆款', freq: '临时专项任务', cronOverride: '0 8 5 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '填报此表中L和M这两列销售收入数据，品类销售额按大类统计', deadlineDays: 5 },
  { name: '数据要求（存货/固定资产监盘）', freq: '临时专项任务', cronOverride: '0 8 25 * *', assignees: ['ou_1c8264871e86c3e61ab96e7d365e699f', 'ou_7ac0aa0043728927da99b255917d49e0'], sop: '存货/监盘地方/固定资产监盘下个月和这个月', deadlineDays: 5 },
  { name: '催门店给工资和计提表', freq: '临时专项任务', cronOverride: '0 8 20 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '催门店给工资和计提表', deadlineDays: 5 },
  { name: '数据要求（vocation工资/创新奖金）', freq: '临时专项任务', cronOverride: '0 8 20 * *', assignees: ['ou_9f9b02d3d4bb3d6689dd5ddd2beeaaeb'], sop: 'vocation工资/创新奖金/', deadlineDays: 5 },
  { name: '数据要求（借款续签）', freq: '临时专项任务', cronOverride: '0 8 15 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '借款续签', deadlineDays: 5 },
  { name: '电力排查', freq: '临时专项任务', cronOverride: '0 8 10 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '电力排查', deadlineDays: 5 },
  { name: '酒水差异对比', freq: '临时专项任务', cronOverride: '0 8 10 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '提交酒水差异表格', deadlineDays: 5 },
  { name: '银行账户开设', freq: '临时专项任务', cronOverride: '0 8 1 * *', assignees: ['ou_9f9b02d3d4bb3d6689dd5ddd2beeaaeb'], sop: '根据总部资金池规划，优选花旗、汇丰、大华银行开设公司银行账户，填写开户申请表', deadlineDays: 30, enabled: false },
  { name: '门店库管文员相关业务培训', freq: '临时专项任务', cronOverride: '0 8 1 * *', assignees: ['ou_9f9b02d3d4bb3d6689dd5ddd2beeaaeb', 'ou_7ac0aa0043728927da99b255917d49e0'], sop: '门店库管文员相关业务培训', deadlineDays: 30, enabled: false },
  { name: '小费约取', freq: '临时专项任务', cronOverride: '0 8 1 * *', assignees: ['ou_7ac0aa0043728927da99b255917d49e0'], sop: '收到门店发来小费约取邮件后，登记加拿大片区小费约取登记表，按提单号检查审批状态是否完成，必须在审批完毕后才可将邮件转发银行', deadlineDays: 1 },
  { name: '日常沟通及跟踪', freq: '临时专项任务', cronOverride: '0 8 * * 1', assignees: ['ou_9f9b02d3d4bb3d6689dd5ddd2beeaaeb', 'ou_7ac0aa0043728927da99b255917d49e0', 'ou_1c8264871e86c3e61ab96e7d365e699f'], sop: '催办及工作及时回复', deadlineDays: 7 },
  { name: '下店检查', freq: '临时专项任务', cronOverride: '0 8 1 * *', assignees: ['ou_9f9b02d3d4bb3d6689dd5ddd2beeaaeb', 'ou_7ac0aa0043728927da99b255917d49e0'], sop: '根据下店管理清单表打卡明细、固定资产盘点、备用金小费盘点下店并写下店报告', deadlineDays: 30, enabled: false },
];

// Cron schedule per frequency
function getSchedule(record) {
  if (record.cronOverride) return record.cronOverride;
  switch (record.freq) {
    case '每日任务': return '0 8 * * *';
    case '每周任务': return '0 8 * * 1'; // Monday default
    case '月初/月末任务': return '0 8 1 * *';
    case '临时专项任务': return '0 8 1 * *';
    default: return '0 8 1 * *';
  }
}

function getDeadlineDays(record) {
  if (record.deadlineDays !== undefined) return record.deadlineDays;
  switch (record.freq) {
    case '每日任务': return 1;
    case '每周任务': return 7;
    case '月初/月末任务': return 3;
    case '临时专项任务': return 5;
    default: return 3;
  }
}

async function createScheduledTask(payload) {
  const res = await fetch(`${API_BASE}/api/scheduled-tasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  let created = 0;
  let failed = 0;

  for (const record of records) {
    const schedule = getSchedule(record);
    const deadlineDays = getDeadlineDays(record);
    const enabled = record.enabled !== false; // default true

    for (const assigneeOpenId of record.assignees) {
      const payload = {
        name: record.name,
        title: record.name,
        targetOpenId: assigneeOpenId,
        schedule,
        timezone: TZ,
        deadlineDays,
        priority: 'p1',
        note: record.sop || null,
        reminderIntervalHours: 24,
        enabled,
      };

      try {
        const result = await createScheduledTask(payload);
        console.log(`✅ Created [${result.id}] ${record.name} (${assigneeOpenId.slice(-6)}) @ ${schedule}`);
        created++;
      } catch (err) {
        console.error(`❌ Failed ${record.name} (${assigneeOpenId.slice(-6)}): ${err.message}`);
        failed++;
      }

      // Tiny delay to avoid hammering the API
      await new Promise(r => setTimeout(r, 50));
    }
  }

  console.log(`\n🎉 Done: ${created} created, ${failed} failed`);
}

main().catch(console.error);
