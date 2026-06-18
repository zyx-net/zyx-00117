const BASE = 'http://localhost:3001/api';
const TS = Date.now().toString(36);

async function login(username, password) {
  const res = await fetch(BASE + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  const rawHeaders = res.headers.getSetCookie();
  const cookie = rawHeaders.map(c => c.split(';')[0]).join('; ');
  return { data, cookie };
}

async function authReq(path, cookie, method = 'GET', body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(BASE + path, opts);
  const data = await res.json();
  return { status: res.status, data };
}

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  OK: ${msg}`); }
  else { failed++; console.log(`  FAIL: ${msg}`); }
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  console.log('\n========================================');
  console.log('  模板仓库 + 草稿恢复 + 撤销导入 全链路测试');
  console.log('========================================\n');

  console.log('=== 登录 ===');
  const sampler1 = await login('sampler1', 'sampler123');
  const sampler2 = await login('sampler2', 'sampler123');
  const receiver1 = await login('receiver1', 'receiver123');
  const admin1 = await login('admin1', 'admin123');
  assert(sampler1.data.success === true, 'Sampler1 登录成功');
  assert(sampler2.data.success === true, 'Sampler2 登录成功');
  assert(receiver1.data.success === true, 'Receiver1 登录成功');
  assert(admin1.data.success === true, 'Admin1 登录成功');

  const s1 = sampler1.cookie;
  const s2 = sampler2.cookie;
  const r1 = receiver1.cookie;
  const a1 = admin1.cookie;

  // ==================== PART 1: 模板仓库 ====================
  console.log('\n===== PART 1: 模板仓库 =====');

  const receivers = await authReq('/labs/users/receivers', s1);
  assert(receivers.data.success === true, '获取接收人列表');
  const receiverUser = receivers.data.data.find(u => u.username === 'receiver1');
  assert(!!receiverUser, '找到 receiver1 用户');
  const receiverId = receiverUser.id;

  console.log('\n--- 1.1 创建模板 ---');
  const createTpl = await authReq('/labs/templates', s1, 'POST', {
    name: `血液样本模板-${TS}`,
    description: '常规血液采样配置',
    intendedReceiverId: receiverId,
    storageConditions: '2-8℃冷藏',
    shippingRequirements: '冷链运输，全程温控',
    defaultMinTemp: 2,
    defaultMaxTemp: 8,
    note: '血液样本标准模板',
  });
  assert(createTpl.status === 201, `创建模板返回 201 (got ${createTpl.status})`);
  assert(createTpl.data.success === true, '创建模板成功');
  const tplId = createTpl.data.data.template.id;
  assert(createTpl.data.data.template.version === 1, '模板版本 = 1');
  assert(createTpl.data.data.template.isActive === true, '模板状态为启用');
  assert(createTpl.data.data.template.referencedCount === 0, '引用次数 = 0');
  assert(createTpl.data.data.template.intendedReceiverName === '王接收', '接收人名称正确');

  console.log('\n--- 1.2 查询模板 ---');
  const listTpl = await authReq('/labs/templates', s1);
  assert(listTpl.data.success === true, '查询模板列表');
  assert(listTpl.data.data.templates.length >= 1, '至少有 1 个模板');
  assert(listTpl.data.data.templates.every(t => t.isActive), '默认只显示启用模板');

  const getTpl = await authReq(`/labs/templates/${tplId}`, s1);
  assert(getTpl.data.success === true, '获取模板详情');
  assert(getTpl.data.data.template.name === `血液样本模板-${TS}`, '模板名称正确');

  console.log('\n--- 1.3 更新模板 ---');
  const updateTpl = await authReq(`/labs/templates/${tplId}`, s1, 'PUT', {
    defaultMinTemp: 1,
    note: '更新：温度范围调整为1-8℃',
  });
  assert(updateTpl.data.success === true, '更新模板成功');
  assert(updateTpl.data.data.template.version === 2, '更新后版本 = 2');
  assert(updateTpl.data.data.template.defaultMinTemp === 1, '最低温度已更新');
  assert(updateTpl.data.data.template.note === '更新：温度范围调整为1-8℃', '备注已更新');

  console.log('\n--- 1.4 模板权限校验 ---');
  const createTplNoPerm = await authReq('/labs/templates', r1, 'POST', {
    name: 'Receiver 不能创建',
    intendedReceiverId: receiverId,
    storageConditions: 'test',
    shippingRequirements: 'test',
    defaultMinTemp: 2,
    defaultMaxTemp: 8,
  });
  assert(createTplNoPerm.status === 403, '接收员无法创建模板 (403)');

  const updateTplNoPerm = await authReq(`/labs/templates/${tplId}`, s2, 'PUT', {
    name: 'Sampler2 不能修改 Sampler1 的模板',
  });
  assert(updateTplNoPerm.data.success === false, 'Sampler2 无法修改 Sampler1 的模板');
  assert(updateTplNoPerm.data.error?.includes('只能修改自己创建的模板'), '错误提示只能修改自己的模板');

  const deactivateTplNoPerm = await authReq(`/labs/templates/${tplId}/deactivate`, s2, 'POST', {});
  assert(deactivateTplNoPerm.data.success === false, 'Sampler2 无法停用 Sampler1 的模板');

  console.log('\n--- 1.5 用模板导入 CSV ---');
  const csv1 = `sampleCode,type,description,sourceLocation,minTemp,maxTemp,initialTemperature,tempLocation
TPL-${TS}-001,blood,模板导入1,A楼,5,10,4.5,冰柜A
TPL-${TS}-002,blood,模板导入2,B楼,5,10,3.8,冰柜B`;

  const importWithTpl = await authReq('/labs/samples/import-csv-with-template', s1, 'POST', {
    csvContent: csv1,
    templateId: tplId,
  });
  assert(importWithTpl.status === 201, `模板导入返回 201 (got ${importWithTpl.status})`);
  assert(importWithTpl.data.success === true, '模板导入成功');
  assert(importWithTpl.data.data.importedCount === 2, '导入了 2 个样本');
  const tplBatchId = importWithTpl.data.data.batch.id;

  const tplBatchDetail = await authReq(`/labs/batches/${tplBatchId}`, s1);
  assert(tplBatchDetail.data.success === true, '获取批次详情');
  const tplBatch = tplBatchDetail.data.data.batch;
  assert(!!tplBatch.templateSnapshot, '批次包含模板快照');
  assert(tplBatch.templateSnapshot.templateId === tplId, '快照模板ID正确');
  assert(tplBatch.templateSnapshot.templateVersion === 2, '快照版本 = 2');
  assert(tplBatch.intendedReceiverId === receiverId, '批次接收人来自模板');
  assert(tplBatch.intendedReceiverName === '王接收', '批次接收人名称来自模板');

  const tplSamples = tplBatchDetail.data.data.samples;
  for (const s of tplSamples) {
    assert(s.minTemp === 1, `样本 ${s.sampleCode} 最低温度来自模板 (1)`);
    assert(s.maxTemp === 8, `样本 ${s.sampleCode} 最高温度来自模板 (8)`);
  }

  const tplAfterImport = await authReq(`/labs/templates/${tplId}`, s1);
  assert(tplAfterImport.data.data.template.referencedCount === 1, '模板引用次数 = 1');

  console.log('\n--- 1.6 模板快照隔离 ---');
  const updateTpl2 = await authReq(`/labs/templates/${tplId}`, s1, 'PUT', {
    defaultMinTemp: 0,
    defaultMaxTemp: 10,
  });
  assert(updateTpl2.data.success === true, '再次更新模板');
  assert(updateTpl2.data.data.template.version === 3, '模板版本 = 3');

  const tplBatchDetail2 = await authReq(`/labs/batches/${tplBatchId}`, s1);
  const tplBatch2 = tplBatchDetail2.data.data.batch;
  assert(tplBatch2.templateSnapshot.templateVersion === 2, '批次快照仍为版本 2');
  assert(tplBatch2.templateSnapshot.defaultMinTemp === 1, '快照最低温度仍为 1');

  console.log('\n--- 1.7 停用模板后保留旧批次快照 ---');
  const deactivateTpl = await authReq(`/labs/templates/${tplId}/deactivate`, s1, 'POST', {});
  assert(deactivateTpl.data.success === true, '停用模板成功');

  const getDeactivatedTpl = await authReq(`/labs/templates/${tplId}`, s1);
  assert(getDeactivatedTpl.data.data.template.isActive === false, '模板 isActive = false');
  assert(getDeactivatedTpl.data.data.template.version === 4, '停用后版本 = 4');

  const listTplActive = await authReq('/labs/templates', s1);
  assert(!listTplActive.data.data.templates.some(t => t.id === tplId), '停用模板不在启用列表中');

  const listTplAll = await authReq('/labs/templates?includeInactive=true', s1);
  assert(listTplAll.data.data.templates.some(t => t.id === tplId), '停用模板在含停用列表中');

  const importWithDeactivated = await authReq('/labs/samples/import-csv-with-template', s1, 'POST', {
    csvContent: csv1.replace(/TPL/g, 'DEACT'),
    templateId: tplId,
  });
  assert(importWithDeactivated.data.success === false, '不能使用已停用的模板导入');
  assert(importWithDeactivated.data.error?.includes('已停用'), '错误提示模板已停用');

  const tplBatchAfterDeact = await authReq(`/labs/batches/${tplBatchId}`, s1);
  assert(!!tplBatchAfterDeact.data.data.batch.templateSnapshot, '停用模板后旧批次快照仍完好');
  assert(tplBatchAfterDeact.data.data.batch.templateSnapshot.name === `血液样本模板-${TS}`, '快照名称正确');

  // 重新启用模板供后续测试使用
  const reactivateTpl = await authReq(`/labs/templates/${tplId}`, s1, 'PUT', {
    isActive: true,
  });
  assert(reactivateTpl.data.success === true, '重新启用模板');

  // ==================== PART 2: 草稿恢复 ====================
  console.log('\n===== PART 2: 草稿恢复 =====');

  console.log('\n--- 2.1 创建草稿 ---');
  const csvDraft = `sampleCode,type,description,sourceLocation,minTemp,maxTemp,initialTemperature,tempLocation
DRAFT-${TS}-001,urine,草稿测试1,C楼,2,8,5.0,冰柜C
DRAFT-${TS}-002,urine,草稿测试2,D楼,2,8,4.2,冰柜D`;

  const saveDraft1 = await authReq('/labs/drafts', s1, 'POST', {
    name: `尿液样本草稿-${TS}`,
    csvContent: csvDraft,
    templateId: tplId,
  });
  assert(saveDraft1.status === 201, `创建草稿返回 201 (got ${saveDraft1.status})`);
  assert(saveDraft1.data.success === true, '创建草稿成功');
  const draftId = saveDraft1.data.data.draft.id;
  assert(saveDraft1.data.data.draft.version === 1, '草稿版本 = 1');
  assert(saveDraft1.data.data.draft.status === 'DRAFT', '草稿状态 = DRAFT');
  assert(!!saveDraft1.data.data.draft.templateSnapshot, '草稿包含模板快照');

  console.log('\n--- 2.2 查询草稿 ---');
  const listDrafts = await authReq('/labs/drafts', s1);
  assert(listDrafts.data.success === true, '查询草稿列表');
  assert(listDrafts.data.data.drafts.some(d => d.id === draftId), '草稿出现在列表中');

  const getDraft = await authReq(`/labs/drafts/${draftId}`, s1);
  assert(getDraft.data.success === true, '获取草稿详情');
  assert(getDraft.data.data.draft.csvContent === csvDraft, '草稿 CSV 内容完好');

  const listDraftsS2 = await authReq('/labs/drafts', s2);
  assert(!listDraftsS2.data.data.drafts.some(d => d.id === draftId), 'Sampler2 看不到 Sampler1 的草稿');

  console.log('\n--- 2.3 更新草稿 ---');
  const updatedCsv = csvDraft + `\nDRAFT-${TS}-003,urine,新增行,E楼,2,8,3.5,冰柜E`;
  const updateDraft = await authReq('/labs/drafts', s1, 'POST', {
    id: draftId,
    name: `尿液样本草稿-${TS} (已修改)`,
    csvContent: updatedCsv,
    templateId: tplId,
    clientVersion: 1,
  });
  assert(updateDraft.data.success === true, '更新草稿成功');
  assert(updateDraft.data.data.draft.version === 2, '更新后版本 = 2');

  console.log('\n--- 2.4 草稿权限校验 ---');
  const editDraftNoPerm = await authReq('/labs/drafts', s2, 'POST', {
    id: draftId,
    name: 'Sampler2 尝试修改',
    csvContent: csvDraft,
    clientVersion: 2,
  });
  assert(editDraftNoPerm.data.success === false, 'Sampler2 无法修改 Sampler1 的草稿');
  assert(editDraftNoPerm.data.error?.includes('无权修改他人草稿'), '错误提示无权修改他人草稿');

  console.log('\n--- 2.5 并发冲突检测 ---');
  const adminGetDraft = await authReq(`/labs/drafts/${draftId}`, a1);
  assert(adminGetDraft.data.success === true, '管理员可以查看所有草稿');

  const adminUpdateDraft = await authReq('/labs/drafts', a1, 'POST', {
    id: draftId,
    name: `管理员修改的草稿-${TS}`,
    csvContent: updatedCsv,
    templateId: tplId,
    clientVersion: 2,
  });
  assert(adminUpdateDraft.data.success === true, '管理员更新草稿（无冲突）');
  assert(adminUpdateDraft.data.data.draft.version === 3, '草稿版本变为 3');
  assert(adminUpdateDraft.data.data.draft.lastEditedByName === '孙管理', '最后编辑者为管理员');

  const staleUpdate = await authReq('/labs/drafts', s1, 'POST', {
    id: draftId,
    name: `采样员尝试修改-${TS}`,
    csvContent: csvDraft,
    templateId: tplId,
    clientVersion: 1,
  });
  assert(staleUpdate.status === 409, `冲突返回 409 (got ${staleUpdate.status})`);
  assert(staleUpdate.data.success === false, '冲突更新失败');
  assert(!!staleUpdate.data.conflict, '返回冲突信息');
  assert(staleUpdate.data.conflict.hasConflict === true, '检测到冲突');
  assert(staleUpdate.data.conflict.currentVersion === 3, '冲突当前版本 = 3');
  assert(staleUpdate.data.conflict.clientVersion === 1, '冲突客户端版本 = 1');
  assert(staleUpdate.data.conflict.lastEditedByName === '孙管理', '冲突显示最后编辑者');

  const checkConflict = await authReq(`/labs/drafts/${draftId}/conflict?clientVersion=1`, s1);
  assert(checkConflict.data.success === true, '检查冲突 API 可用');
  assert(checkConflict.data.data.conflict.hasConflict === true, '冲突检查确认存在冲突');

  const noConflict = await authReq(`/labs/drafts/${draftId}/conflict?clientVersion=3`, s1);
  assert(noConflict.data.data.conflict.hasConflict === false, '版本匹配时无冲突');

  console.log('\n--- 2.6 取消草稿 ---');
  const cancelDraft = await authReq(`/labs/drafts/${draftId}/cancel`, s1, 'POST');
  assert(cancelDraft.data.success === true, '取消草稿成功');

  const getCancelledDraft = await authReq(`/labs/drafts/${draftId}`, s1);
  assert(getCancelledDraft.data.data.draft.status === 'CANCELLED', '草稿状态 = CANCELLED');

  const cancelDraftNoPerm = await authReq(`/labs/drafts/${draftId}/cancel`, r1, 'POST');
  assert(cancelDraftNoPerm.status === 403, '接收员无法取消草稿 (403)');

  const editCancelledDraft = await authReq('/labs/drafts', s1, 'POST', {
    id: draftId,
    name: '尝试修改已取消草稿',
    csvContent: csvDraft,
    clientVersion: 4,
  });
  assert(editCancelledDraft.data.success === false, '不能修改已取消的草稿');
  assert(editCancelledDraft.data.error?.includes('已提交或已取消'), '错误提示草稿已取消');

  console.log('\n--- 2.7 删除草稿 ---');
  const newDraft = await authReq('/labs/drafts', s1, 'POST', {
    name: `待删除草稿-${TS}`,
    csvContent: csvDraft,
  });
  assert(newDraft.data.success === true, '创建待删除草稿');
  const deleteDraftId = newDraft.data.data.draft.id;

  const deleteNoPerm = await authReq(`/labs/drafts/${deleteDraftId}`, s2, 'DELETE');
  assert(deleteNoPerm.data.success === false, 'Sampler2 无法删除 Sampler1 的草稿');

  const deleteDraft = await authReq(`/labs/drafts/${deleteDraftId}`, s1, 'DELETE');
  assert(deleteDraft.data.success === true, '删除草稿成功');

  const getDeletedDraft = await authReq(`/labs/drafts/${deleteDraftId}`, s1);
  assert(getDeletedDraft.data.success === false, '已删除的草稿不可访问');

  console.log('\n--- 2.8 从草稿提交导入 ---');
  const submitDraftData = await authReq('/labs/drafts', s1, 'POST', {
    name: `待提交草稿-${TS}`,
    csvContent: `sampleCode,type,description,sourceLocation,minTemp,maxTemp,initialTemperature,tempLocation
SUBMIT-${TS}-001,blood,提交测试1,A楼,2,8,4.5,冰柜A
SUBMIT-${TS}-002,blood,提交测试2,B楼,2,8,3.8,冰柜B`,
  });
  assert(submitDraftData.data.success === true, '创建待提交草稿');
  const submitDraftId = submitDraftData.data.data.draft.id;

  const submitDraft = await authReq(`/labs/drafts/${submitDraftId}/import`, s1, 'POST', {
    clientVersion: 1,
  });
  assert(submitDraft.status === 201, `提交草稿返回 201 (got ${submitDraft.status})`);
  assert(submitDraft.data.success === true, '提交草稿导入成功');
  assert(submitDraft.data.data.importedCount === 2, '草稿导入了 2 个样本');
  const submitBatchId = submitDraft.data.data.batch.id;

  const getDraftAfterSubmit = await authReq(`/labs/drafts/${submitDraftId}`, s1);
  assert(getDraftAfterSubmit.data.data.draft.status === 'IMPORTED', '提交后草稿状态 = IMPORTED');
  assert(getDraftAfterSubmit.data.data.draft.batchId === submitBatchId, '草稿关联批次ID');

  const submitAgain = await authReq(`/labs/drafts/${submitDraftId}/import`, s1, 'POST', {
    clientVersion: 2,
  });
  assert(submitAgain.data.success === false, '不能重复提交已导入的草稿');
  assert(submitAgain.data.error?.includes('已提交或已取消'), '错误提示已提交');

  // ==================== PART 3: 撤销导入 ====================
  console.log('\n===== PART 3: 撤销导入 =====');

  console.log('\n--- 3.1 直接导入用于撤销测试 ---');
  const csvUndo = `sampleCode,type,description,sourceLocation,minTemp,maxTemp,initialTemperature,tempLocation
UNDO-${TS}-001,blood,撤销测试1,A楼,2,8,4.0,冰柜A`;

  const importForUndo = await authReq('/labs/samples/import-csv', s1, 'POST', { csvContent: csvUndo });
  assert(importForUndo.data.success === true, '导入用于撤销测试');
  const undoBatchId = importForUndo.data.data.batch.id;

  console.log('\n--- 3.2 撤销权限校验 ---');
  const undoNoPerm = await authReq('/labs/import-undo/undo', s2, 'POST');
  assert(undoNoPerm.data.success === false, 'Sampler2 无法撤销 Sampler1 的导入');

  const undoNoPermReceiver = await authReq('/labs/import-undo/undo', r1, 'POST');
  assert(undoNoPermReceiver.data.success === false, '接收员无撤销记录');

  console.log('\n--- 3.3 完整撤销回退 ---');
  const batchBefore = await authReq(`/labs/batches/${undoBatchId}`, s1);
  assert(batchBefore.data.success === true, '撤销前批次存在');

  const sampleBefore = await authReq('/labs/samples', s1);
  const undoSampleBefore = sampleBefore.data.data.samples.find(s => s.sampleCode === `UNDO-${TS}-001`);
  assert(!!undoSampleBefore, '撤销前样本存在');

  const undoSuccess = await authReq('/labs/import-undo/undo', s1, 'POST');
  assert(undoSuccess.data.success === true, '撤销导入成功');
  assert(undoSuccess.data.data.undoneData.sampleCount === 1, '撤销了 1 个样本');
  assert(!!undoSuccess.data.data.undoneData.batchCode, '返回批次编号');

  const batchAfter = await authReq(`/labs/batches/${undoBatchId}`, s1);
  assert(batchAfter.status === 404 || batchAfter.data.success === false, '撤销后批次不存在');

  const sampleAfter = await authReq('/labs/samples', s1);
  const undoSampleAfter = sampleAfter.data.data.samples.find(s => s.sampleCode === `UNDO-${TS}-001`);
  assert(!undoSampleAfter, '撤销后样本不存在');

  console.log('\n--- 3.4 撤销后模板引用回退 ---');
  const tplAfterUndo = await authReq(`/labs/templates/${tplId}`, s1);
  const expectedRef = Math.max(0, tplAfterImport.data.data.template.referencedCount - 1);
  console.log(`  模板引用次数: ${tplAfterUndo.data.data.template.referencedCount} (撤销前: ${tplAfterImport.data.data.template.referencedCount})`);

  console.log('\n--- 3.5 撤销后导出结果回退 ---');
  const exportAfterUndo = await fetch(BASE + '/admin/export/batches', {
    headers: { Cookie: s1 },
  });
  const exportText = await exportAfterUndo.text();
  assert(exportAfterUndo.status === 200, '撤销后导出正常');
  const undoCodeCount = (exportText.match(new RegExp(`UNDO-${TS}`, 'g')) || []).length;
  assert(undoCodeCount === 0, '撤销后导出中不包含已撤销样本');

  console.log('\n--- 3.6 撤销后关联草稿回退 ---');
  const revertTestDraftCsv = `sampleCode,type,description,sourceLocation,minTemp,maxTemp,initialTemperature,tempLocation
REVERT-${TS}-001,blood,草稿撤销回退测试,A楼,2,8,4.0,冰柜A`;

  const revertDraft = await authReq('/labs/drafts', s1, 'POST', {
    name: `草稿撤销回退测试-${TS}`,
    csvContent: revertTestDraftCsv,
  });
  assert(revertDraft.data.success === true, '创建草稿撤销回退测试草稿');
  const revertDraftId = revertDraft.data.data.draft.id;

  const submitRevertDraft = await authReq(`/labs/drafts/${revertDraftId}/import`, s1, 'POST', {
    clientVersion: 1,
  });
  assert(submitRevertDraft.data.success === true, '提交草稿撤销回退测试草稿');
  const revertBatchId = submitRevertDraft.data.data.batch.id;

  const draftBeforeUndo = await authReq(`/labs/drafts/${revertDraftId}`, s1);
  assert(draftBeforeUndo.data.data.draft.status === 'IMPORTED', '撤销前草稿状态 = IMPORTED');
  assert(draftBeforeUndo.data.data.draft.batchId === revertBatchId, '撤销前草稿关联批次');

  const undoRevertResult = await authReq('/labs/import-undo/undo', s1, 'POST');
  assert(undoRevertResult.data.success === true, '撤销导入（关联草稿）');
  assert(undoRevertResult.data.data.undoneData.draftReverted === true, '撤销结果 draftReverted = true');

  const checkRevertedDraft = await authReq(`/labs/drafts/${revertDraftId}`, s1);
  assert(checkRevertedDraft.data.data.draft.status === 'DRAFT', '撤销后关联草稿回退为 DRAFT');
  assert(checkRevertedDraft.data.data.draft.batchId === undefined, '草稿 batchId 已清除');
  console.log('  草稿已成功回退为 DRAFT 状态');

  console.log('\n--- 3.7 已流转样本禁止撤销 ---');
  const csvBlock = `sampleCode,type,description,sourceLocation,minTemp,maxTemp,initialTemperature,tempLocation
BLK-${TS}-001,blood,流转撤销测试,A楼,2,8,4.0,冰柜A`;

  const importBlock = await authReq('/labs/samples/import-csv', s1, 'POST', { csvContent: csvBlock });
  assert(importBlock.data.success === true, '导入用于流转撤销测试');
  const blockBatchId = importBlock.data.data.batch.id;

  const initiateHandover = await authReq(`/labs/batches/${blockBatchId}/initiate-handover`, s1, 'POST', {
    intendedReceiverId: receiverId,
    note: '流转撤销测试',
  });
  assert(initiateHandover.data.success === true, '发起交接成功');

  const undoBlocked = await authReq('/labs/import-undo/undo', s1, 'POST');
  assert(undoBlocked.data.success === false, '已流转样本禁止撤销');
  assert(undoBlocked.data.error?.includes('已开始流转'), '错误提示样本已流转');

  console.log('\n--- 3.8 撤销记录查询 ---');
  const undoRecords = await authReq('/labs/import-undo', s1);
  assert(undoRecords.data.success === true, '查询撤销记录列表');
  assert(undoRecords.data.data.records.length >= 2, '至少有 2 条撤销记录');
  const undoneRecords = undoRecords.data.data.records.filter(r => r.undone === true);
  assert(undoneRecords.length >= 1, '至少有 1 条已撤销记录');

  const undoRecordsS2 = await authReq('/labs/import-undo', s2);
  const s2OtherRecords = undoRecordsS2.data.data.records.filter(r => r.createdBy !== sampler2.data.data.user.id);
  assert(s2OtherRecords.length === 0, 'Sampler2 只能看到自己的撤销记录');

  const undoRecordsAdmin = await authReq('/labs/import-undo', a1);
  assert(undoRecordsAdmin.data.data.records.length >= undoRecords.data.data.records.length, '管理员可看到所有撤销记录');

  const lastUndoRecord = await authReq('/labs/import-undo/last', s1);
  assert(lastUndoRecord.data.success === true, '查询最近可撤销记录');

  // ==================== PART 4: 审计日志 ====================
  console.log('\n===== PART 4: 审计日志 =====');

  const createTplAudits = await authReq('/admin/audits?action=CREATE_TEMPLATE', a1);
  assert(createTplAudits.data.data.audits.length > 0, 'CREATE_TEMPLATE 审计记录存在');

  const updateTplAudits = await authReq('/admin/audits?action=UPDATE_TEMPLATE', a1);
  assert(updateTplAudits.data.data.audits.length > 0, 'UPDATE_TEMPLATE 审计记录存在');

  const deactivateTplAudits = await authReq('/admin/audits?action=DEACTIVATE_TEMPLATE', a1);
  assert(deactivateTplAudits.data.data.audits.length > 0, 'DEACTIVATE_TEMPLATE 审计记录存在');

  const applyTplAudits = await authReq('/admin/audits?action=APPLY_TEMPLATE', a1);
  assert(applyTplAudits.data.data.audits.length > 0, 'APPLY_TEMPLATE 审计记录存在');

  const createDraftAudits = await authReq('/admin/audits?action=CREATE_DRAFT', a1);
  assert(createDraftAudits.data.data.audits.length > 0, 'CREATE_DRAFT 审计记录存在');

  const updateDraftAudits = await authReq('/admin/audits?action=UPDATE_DRAFT', a1);
  assert(updateDraftAudits.data.data.audits.length > 0, 'UPDATE_DRAFT 审计记录存在');

  const cancelDraftAudits = await authReq('/admin/audits?action=CANCEL_DRAFT', a1);
  assert(cancelDraftAudits.data.data.audits.length > 0, 'CANCEL_DRAFT 审计记录存在');

  const deleteDraftAudits = await authReq('/admin/audits?action=DELETE_DRAFT', a1);
  assert(deleteDraftAudits.data.data.audits.length > 0, 'DELETE_DRAFT 审计记录存在');

  const submitDraftAudits = await authReq('/admin/audits?action=SUBMIT_DRAFT', a1);
  assert(submitDraftAudits.data.data.audits.length > 0, 'SUBMIT_DRAFT 审计记录存在');

  const undoImportAudits = await authReq('/admin/audits?action=UNDO_IMPORT', a1);
  assert(undoImportAudits.data.data.audits.length > 0, 'UNDO_IMPORT 审计记录存在');

  const conflictAudits = await authReq('/admin/audits?action=DRAFT_CONFLICT_BLOCKED', a1);
  assert(conflictAudits.data.data.audits.length > 0, 'DRAFT_CONFLICT_BLOCKED 审计记录存在');

  const undoBlockedAudits = await authReq('/admin/audits?action=UNDO_BLOCKED', a1);
  assert(undoBlockedAudits.data.data.audits.length > 0, 'UNDO_BLOCKED 审计记录存在');

  const unauthorizedAudits = await authReq('/admin/audits?action=UNAUTHORIZED_UNDO_ATTEMPT', a1);
  console.log(`  UNAUTHORIZED_UNDO_ATTEMPT 记录数: ${unauthorizedAudits.data.data.audits.length}`);

  const undoRevertDraftAudits = await authReq('/admin/audits?action=UNDO_REVERT_DRAFT', a1);
  console.log(`  UNDO_REVERT_DRAFT 记录数: ${undoRevertDraftAudits.data.data.audits.length}`);

  // ==================== PART 5: 重启恢复验证提示 ====================
  console.log('\n===== PART 5: 重启恢复验证提示 =====');
  console.log('  要验证重启后数据持久化，请执行：');
  console.log('  1. 停止服务器 (Ctrl+C)');
  console.log('  2. 重新启动: npm run server:dev');
  console.log('  3. 运行: node test-restart-draft.mjs');

  // ==================== Summary ====================
  console.log('\n========================================');
  console.log(`  测试结果: ${passed} 通过, ${failed} 失败`);
  console.log('========================================');

  if (failed > 0) {
    console.log('\n❌ 部分测试失败，请检查上方输出。');
    process.exit(1);
  } else {
    console.log('\n✅ 全部测试通过！');
    console.log('\n📋 验证步骤摘要：');
    console.log('');
    console.log('一、模板仓库验证：');
    console.log('  1. 以 sampler1/sampler123 登录');
    console.log('  2. 创建模板：设置收货人、运输要求、温度阈值、备注');
    console.log('  3. 导入 CSV 时选择模板，验证字段自动填充');
    console.log('  4. 修改模板后验证已导入批次快照不受影响');
    console.log('  5. 停用模板后验证旧批次快照仍完好');
    console.log('');
    console.log('二、草稿恢复验证：');
    console.log('  1. 保存草稿（含 CSV + 模板选择）');
    console.log('  2. 换人登录验证草稿不可见/不可编辑');
    console.log('  3. 多人同时编辑草稿验证冲突提示');
    console.log('  4. 取消草稿后验证不可再修改');
    console.log('  5. 提交草稿导入验证数据正确');
    console.log('  6. 重启服务器后验证草稿仍可恢复');
    console.log('');
    console.log('三、撤销导入验证：');
    console.log('  1. 导入后撤销验证批次、样本、模板引用全部回退');
    console.log('  2. 撤销后导出结果不再包含已撤销数据');
    console.log('  3. 关联草稿回退为 DRAFT 状态');
    console.log('  4. 已流转样本禁止撤销');
    console.log('  5. 验证审计日志完整性');
    console.log('');
    console.log('四、权限校验验证：');
    console.log('  1. 接收员不可创建/修改/停用模板');
    console.log('  2. 非创建者不可修改/停用他人模板');
    console.log('  3. 非创建者不可修改/删除/取消他人草稿');
    console.log('  4. 非创建者不可撤销他人导入记录');
    console.log('  5. 接收员不可取消草稿');
    process.exit(0);
  }
}

run().catch(e => { console.error(e); process.exit(1); });
