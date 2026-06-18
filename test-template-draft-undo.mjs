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
  console.log('\n=== Login ===');
  const sampler1 = await login('sampler1', 'sampler123');
  const sampler2 = await login('sampler2', 'sampler123');
  const receiver1 = await login('receiver1', 'receiver123');
  const admin1 = await login('admin1', 'admin123');
  assert(sampler1.data.success === true, 'Sampler1 login');
  assert(sampler2.data.success === true, 'Sampler2 login');
  assert(receiver1.data.success === true, 'Receiver1 login');
  assert(admin1.data.success === true, 'Admin1 login');

  const s1Cookie = sampler1.cookie;
  const s2Cookie = sampler2.cookie;
  const r1Cookie = receiver1.cookie;
  const aCookie = admin1.cookie;

  // ============== Test 1: Template CRUD ==============
  console.log('\n=== Test 1: Sample Template CRUD ===');

  const receivers = await authReq('/labs/users/receivers', s1Cookie);
  assert(receivers.data.success === true, 'List receivers');
  const receiverUser = receivers.data.data.find(u => u.username === 'receiver1');
  assert(!!receiverUser, 'Found receiver1 user');
  const receiverId = receiverUser.id;

  const createTpl = await authReq('/labs/templates', s1Cookie, 'POST', {
    name: `常规血液样本模板-${TS}`,
    description: '日常血液采样的标准配置',
    intendedReceiverId: receiverId,
    storageConditions: '2-8℃冷藏，避免冷冻',
    shippingRequirements: '冷链运输，全程温度监控',
    defaultMinTemp: 2,
    defaultMaxTemp: 8,
    note: '常规血液样本使用此模板',
  });
  assert(createTpl.status === 201, `Create template returns 201 (got ${createTpl.status})`);
  assert(createTpl.data.success === true, 'Create template success');
  const templateId = createTpl.data.data.template.id;
  assert(createTpl.data.data.template.version === 1, 'Template version = 1');
  assert(createTpl.data.data.template.isActive === true, 'Template is active');
  assert(createTpl.data.data.template.referencedCount === 0, 'Template referencedCount = 0');

  const listTpl = await authReq('/labs/templates', s1Cookie);
  assert(listTpl.data.success === true, 'List templates success');
  assert(listTpl.data.data.templates.length >= 1, 'At least 1 template');

  const getTpl = await authReq(`/labs/templates/${templateId}`, s1Cookie);
  assert(getTpl.data.success === true, 'Get template detail success');
  assert(getTpl.data.data.template.name === `常规血液样本模板-${TS}`, 'Template name correct');

  const updateTpl = await authReq(`/labs/templates/${templateId}`, s1Cookie, 'PUT', {
    defaultMinTemp: 1,
    note: '更新：温度范围调整为1-8℃',
  });
  assert(updateTpl.data.success === true, 'Update template success');
  assert(updateTpl.data.data.template.version === 2, 'Template version = 2 after update');
  assert(updateTpl.data.data.template.defaultMinTemp === 1, 'Template minTemp updated to 1');
  assert(updateTpl.data.data.template.note === '更新：温度范围调整为1-8℃', 'Template note updated');

  // ============== Test 2: No permission template operations ==============
  console.log('\n=== Test 2: Template Permission Checks ===');

  const createTplNoPerm = await authReq('/labs/templates', r1Cookie, 'POST', {
    name: 'Receiver should not create',
    intendedReceiverId: receiverId,
    storageConditions: 'test',
    shippingRequirements: 'test',
    defaultMinTemp: 2,
    defaultMaxTemp: 8,
  });
  assert(createTplNoPerm.status === 403, 'Receiver cannot create template (403)');

  const updateTplNoPerm = await authReq(`/labs/templates/${templateId}`, s2Cookie, 'PUT', {
    name: 'Sampler2 cannot update sampler1 template',
  });
  assert(updateTplNoPerm.data.success === false, 'Sampler2 cannot update sampler1 template');
  assert(updateTplNoPerm.data.error?.includes('只能修改自己创建的模板'), 'Error says can only update own template');

  const deactivateTplNoPerm = await authReq(`/labs/templates/${templateId}/deactivate`, s2Cookie, 'POST', {});
  assert(deactivateTplNoPerm.data.success === false, 'Sampler2 cannot deactivate sampler1 template');

  // ============== Test 3: Import CSV with template ==============
  console.log('\n=== Test 3: Import CSV with Template ===');

  const csv1 = `sampleCode,type,description,sourceLocation,minTemp,maxTemp,initialTemperature,tempLocation
TPL-${TS}-001,blood,template import 1,Building A,5,10,4.5,Freezer A
TPL-${TS}-002,blood,template import 2,Building B,5,10,3.8,Freezer B`;

  const importWithTpl = await authReq('/labs/samples/import-csv-with-template', s1Cookie, 'POST', {
    csvContent: csv1,
    templateId,
  });
  assert(importWithTpl.status === 201, `Import with template returns 201 (got ${importWithTpl.status})`);
  assert(importWithTpl.data.success === true, 'Import with template success');
  assert(importWithTpl.data.data.importedCount === 2, 'Imported 2 samples');
  const tplBatchId = importWithTpl.data.data.batch.id;

  const tplBatchDetail = await authReq(`/labs/batches/${tplBatchId}`, s1Cookie);
  assert(tplBatchDetail.data.success === true, 'Get batch detail');
  const tplBatch = tplBatchDetail.data.data.batch;
  assert(!!tplBatch.templateSnapshot, 'Batch has templateSnapshot');
  assert(tplBatch.templateSnapshot.templateId === templateId, 'Snapshot templateId correct');
  assert(tplBatch.templateSnapshot.templateVersion === 2, 'Snapshot templateVersion = 2');
  assert(tplBatch.templateSnapshot.name === `常规血液样本模板-${TS}`, 'Snapshot name preserved');
  assert(tplBatch.intendedReceiverId === receiverId, 'Batch receiverId from template');
  assert(tplBatch.intendedReceiverName === '王接收', 'Batch receiverName from template');

  const tplSamples = tplBatchDetail.data.data.samples;
  for (const s of tplSamples) {
    assert(s.minTemp === 1, `Sample ${s.sampleCode} minTemp from template (1)`);
    assert(s.maxTemp === 8, `Sample ${s.sampleCode} maxTemp from template (8)`);
  }

  const tplAfterUpdate = await authReq(`/labs/templates/${templateId}`, s1Cookie);
  assert(tplAfterUpdate.data.data.template.referencedCount === 1, 'Template referencedCount = 1 after import');

  // ============== Test 4: Template modification does not affect existing batches ==============
  console.log('\n=== Test 4: Template Snapshot Isolation ===');

  const updateTpl2 = await authReq(`/labs/templates/${templateId}`, s1Cookie, 'PUT', {
    defaultMinTemp: 0,
    defaultMaxTemp: 10,
    intendedReceiverId: receiverId,
  });
  assert(updateTpl2.data.success === true, 'Update template again');
  assert(updateTpl2.data.data.template.version === 3, 'Template version = 3');

  const tplBatchDetail2 = await authReq(`/labs/batches/${tplBatchId}`, s1Cookie);
  const tplBatch2 = tplBatchDetail2.data.data.batch;
  assert(tplBatch2.templateSnapshot.templateVersion === 2, 'Batch snapshot still at version 2');
  assert(tplBatch2.templateSnapshot.defaultMinTemp === 1, 'Batch snapshot minTemp still 1');
  assert(tplBatch2.templateSnapshot.defaultMaxTemp === 8, 'Batch snapshot maxTemp still 8');

  const tplSamples2 = tplBatchDetail2.data.data.samples;
  for (const s of tplSamples2) {
    assert(s.minTemp === 1, `Sample ${s.sampleCode} minTemp still 1 (not affected by template update)`);
    assert(s.maxTemp === 8, `Sample ${s.sampleCode} maxTemp still 8 (not affected by template update)`);
  }

  // ============== Test 5: Import Draft Save and Restore ==============
  console.log('\n=== Test 5: Import Draft Save & Restore ===');

  const csvDraft = `sampleCode,type,description,sourceLocation,minTemp,maxTemp,initialTemperature,tempLocation
DRAFT-${TS}-001,urine,draft test 1,Building C,2,8,5.0,Freezer C
DRAFT-${TS}-002,urine,draft test 2,Building D,2,8,4.2,Freezer D`;

  const saveDraft1 = await authReq('/labs/drafts', s1Cookie, 'POST', {
    name: `尿液样本草稿-${TS}`,
    csvContent: csvDraft,
    templateId,
  });
  assert(saveDraft1.status === 201, `Save draft returns 201 (got ${saveDraft1.status})`);
  assert(saveDraft1.data.success === true, 'Save draft success');
  const draftId = saveDraft1.data.data.draft.id;
  assert(saveDraft1.data.data.draft.version === 1, 'Draft version = 1');
  assert(saveDraft1.data.data.draft.status === 'DRAFT', 'Draft status = DRAFT');
  assert(!!saveDraft1.data.data.draft.templateSnapshot, 'Draft has templateSnapshot');
  assert(saveDraft1.data.data.draft.templateSnapshot.templateVersion === 3, 'Draft snapshot uses latest template version 3');

  const listDrafts = await authReq('/labs/drafts', s1Cookie);
  assert(listDrafts.data.success === true, 'List drafts success');
  assert(listDrafts.data.data.drafts.some(d => d.id === draftId), 'Draft appears in list');

  const getDraft = await authReq(`/labs/drafts/${draftId}`, s1Cookie);
  assert(getDraft.data.success === true, 'Get draft detail');
  assert(getDraft.data.data.draft.csvContent === csvDraft, 'Draft CSV content preserved');

  const listDraftsS2 = await authReq('/labs/drafts', s2Cookie);
  assert(!listDraftsS2.data.data.drafts.some(d => d.id === draftId), 'Sampler2 cannot see sampler1 draft');

  // ============== Test 6: Concurrent Draft Conflict ==============
  console.log('\n=== Test 6: Concurrent Draft Conflict Detection ===');

  const adminGetDraft = await authReq(`/labs/drafts/${draftId}`, aCookie);
  assert(adminGetDraft.data.success === true, 'Admin can see all drafts');

  const saveDraftConflict = await authReq('/labs/drafts', aCookie, 'POST', {
    id: draftId,
    name: `管理员修改的草稿-${TS}`,
    csvContent: csvDraft + '\nDRAFT-' + TS + '-003,urine,added by admin,Building E,2,8,3.5,Freezer E',
    templateId,
    clientVersion: 1,
  });
  assert(saveDraftConflict.data.success === true, 'Admin updates draft (no conflict yet)');
  assert(saveDraftConflict.data.data.draft.version === 2, 'Draft version becomes 2');
  assert(saveDraftConflict.data.data.draft.lastEditedByName === '孙管理', 'Last editor is admin');

  const saveDraftConflict2 = await authReq('/labs/drafts', s1Cookie, 'POST', {
    id: draftId,
    name: `采样员尝试修改-${TS}`,
    csvContent: csvDraft,
    templateId,
    clientVersion: 1,
  });
  assert(saveDraftConflict2.status === 409, `Conflict returns 409 (got ${saveDraftConflict2.status})`);
  assert(saveDraftConflict2.data.success === false, 'Conflict update fails');
  assert(!!saveDraftConflict2.data.conflict, 'Conflict info returned');
  assert(saveDraftConflict2.data.conflict.hasConflict === true, 'Conflict detected');
  assert(saveDraftConflict2.data.conflict.currentVersion === 2, 'Conflict currentVersion = 2');
  assert(saveDraftConflict2.data.conflict.clientVersion === 1, 'Conflict clientVersion = 1');
  assert(saveDraftConflict2.data.conflict.lastEditedByName === '孙管理', 'Conflict shows last editor name');

  const checkConflict = await authReq(`/labs/drafts/${draftId}/conflict?clientVersion=1`, s1Cookie);
  assert(checkConflict.data.success === true, 'Check conflict API works');
  assert(checkConflict.data.data.conflict.hasConflict === true, 'Check conflict confirms conflict');

  // ============== Test 7: Undo Last Import - Authorization ==============
  console.log('\n=== Test 7: Undo Import Authorization ===');

  const csv2 = `sampleCode,type,description,sourceLocation,minTemp,maxTemp,initialTemperature,tempLocation
UNDO-${TS}-001,blood,undo test 1,Building A,2,8,4.0,Freezer A`;

  const importForUndo = await authReq('/labs/samples/import-csv', s1Cookie, 'POST', { csvContent: csv2 });
  assert(importForUndo.data.success === true, 'Import for undo test');
  const undoBatchId = importForUndo.data.data.batch.id;

  const undoNoPerm = await authReq('/labs/import-undo/undo', s2Cookie, 'POST', {});
  assert(undoNoPerm.data.success === false, 'Sampler2 cannot undo - no own records or unauthorized');
  assert(
    undoNoPerm.data.error?.includes('只能撤销自己创建的导入记录') ||
    undoNoPerm.data.error?.includes('没有可撤销的导入记录'),
    'Error says either no records or unauthorized'
  );

  const undoNoPermReceiver = await authReq('/labs/import-undo/undo', r1Cookie, 'POST', {});
  assert(undoNoPermReceiver.data.success === false, 'Receiver cannot undo import (no records to undo)');

  // ============== Test 8: Undo Last Import - Success ==============
  console.log('\n=== Test 8: Undo Last Import - Complete Rollback ===');

  const batchBeforeUndo = await authReq(`/labs/batches/${undoBatchId}`, s1Cookie);
  assert(batchBeforeUndo.data.success === true, 'Batch exists before undo');

  const sampleBeforeUndo = await authReq('/labs/samples', s1Cookie);
  const undoSampleBefore = sampleBeforeUndo.data.data.samples.find(s => s.sampleCode === `UNDO-${TS}-001`);
  assert(!!undoSampleBefore, 'Sample exists before undo');
  assert(undoSampleBefore.temperatureRecords.length > 0, 'Sample has temp records before undo');
  assert(undoSampleBefore.handoverChain.length > 0, 'Sample has handover chain before undo');

  const auditsBefore = await authReq('/admin/audits?action=CSV_IMPORT', aCookie);
  const importAuditsBefore = auditsBefore.data.data.audits.filter(a => a.afterState?.samples?.some(s => s.sampleCode === `UNDO-${TS}-001`));
  assert(importAuditsBefore.length > 0, 'CSV_IMPORT audit exists before undo');

  const undoSuccess = await authReq('/labs/import-undo/undo', s1Cookie, 'POST', {});
  assert(undoSuccess.data.success === true, 'Undo import success');
  assert(undoSuccess.data.data.undoneData.sampleCount === 1, 'Undo 1 sample');
  assert(!!undoSuccess.data.data.undoneData.batchCode, 'Undo returns batchCode');

  const batchAfterUndo = await authReq(`/labs/batches/${undoBatchId}`, s1Cookie);
  assert(batchAfterUndo.status === 404 || batchAfterUndo.data.success === false, 'Batch no longer exists after undo');

  const sampleAfterUndo = await authReq('/labs/samples', s1Cookie);
  const undoSampleAfter = sampleAfterUndo.data.data.samples.find(s => s.sampleCode === `UNDO-${TS}-001`);
  assert(!undoSampleAfter, 'Sample no longer exists after undo');

  const batchesAfterUndo = await authReq('/labs/batches', s1Cookie);
  const batchInList = batchesAfterUndo.data.data.batches.find(b => b.id === undoBatchId);
  assert(!batchInList, 'Batch not in list after undo');

  const auditsAfter = await authReq('/admin/audits?action=UNDO_IMPORT', aCookie);
  const undoAudits = auditsAfter.data.data.audits.filter(a => a.targetId === undoBatchId);
  assert(undoAudits.length > 0, 'UNDO_IMPORT audit record exists');
  assert(undoAudits[0].operatorName === '张采样', 'Undo operator correct');

  const unauthorizedAudits = await authReq('/admin/audits?action=UNAUTHORIZED_UNDO_ATTEMPT', aCookie);
  console.log(`  Note: UNAUTHORIZED_UNDO_ATTEMPT audits count: ${unauthorizedAudits.data.data.audits.length}`);
  console.log(`    (This audit is only created when a user explicitly tries to undo another's record, which requires the record to be visible to them)`);

  const conflictAudits = await authReq('/admin/audits?action=DRAFT_CONFLICT_BLOCKED', aCookie);
  assert(conflictAudits.data.data.audits.length > 0, 'DRAFT_CONFLICT_BLOCKED audit exists');

  const templateAudits = await authReq('/admin/audits?action=CREATE_TEMPLATE', aCookie);
  assert(templateAudits.data.data.audits.length > 0, 'CREATE_TEMPLATE audit exists');

  const applyTplAudits = await authReq('/admin/audits?action=APPLY_TEMPLATE', aCookie);
  assert(applyTplAudits.data.data.audits.length > 0, 'APPLY_TEMPLATE audit exists');

  // ============== Test 9: Undo Blocked for Samples in Transit ==============
  console.log('\n=== Test 9: Undo Blocked for Samples in Transit ===');

  const csv3 = `sampleCode,type,description,sourceLocation,minTemp,maxTemp,initialTemperature,tempLocation
UNDOBLOCK-${TS}-001,blood,undo block test,Building A,2,8,4.0,Freezer A`;

  const importForBlock = await authReq('/labs/samples/import-csv', s1Cookie, 'POST', { csvContent: csv3 });
  assert(importForBlock.data.success === true, 'Import for block test');
  const blockBatchId = importForBlock.data.data.batch.id;

  const initiateHandover = await authReq(`/labs/batches/${blockBatchId}/initiate-handover`, s1Cookie, 'POST', {
    intendedReceiverId: receiverId,
    note: 'For undo block test',
  });
  assert(initiateHandover.data.success === true, 'Initiate handover success');

  const undoBlocked = await authReq('/labs/import-undo/undo', s1Cookie, 'POST', {});
  assert(undoBlocked.data.success === false, 'Undo blocked for in-transit samples');
  assert(undoBlocked.data.error?.includes('已开始流转'), 'Error mentions samples in transit');

  const blockAudits = await authReq('/admin/audits?action=UNDO_BLOCKED', aCookie);
  assert(blockAudits.data.data.audits.length > 0, 'UNDO_BLOCKED audit exists');

  // ============== Test 10: Template Deactivation After Reference ==============
  console.log('\n=== Test 10: Template Deactivation After Reference ===');

  const deactivateTpl = await authReq(`/labs/templates/${templateId}/deactivate`, s1Cookie, 'POST', {});
  assert(deactivateTpl.data.success === true, 'Deactivate template success');

  const getDeactivatedTpl = await authReq(`/labs/templates/${templateId}`, s1Cookie);
  assert(getDeactivatedTpl.data.data.template.isActive === false, 'Template isActive = false');
  assert(getDeactivatedTpl.data.data.template.version === 4, 'Template version = 4 after deactivation');

  const listTplActive = await authReq('/labs/templates', s1Cookie);
  const activeTpls = listTplActive.data.data.templates;
  assert(!activeTpls.some(t => t.id === templateId), 'Deactivated template not in active list');

  const listTplAll = await authReq('/labs/templates?includeInactive=true', s1Cookie);
  const allTpls = listTplAll.data.data.templates;
  assert(allTpls.some(t => t.id === templateId), 'Deactivated template in includeInactive list');

  const csv4 = `sampleCode,type,description,sourceLocation,minTemp,maxTemp,initialTemperature,tempLocation
DEACT-${TS}-001,blood,deactivated tpl test,Building A,2,8,4.0,Freezer A`;

  const importWithDeactivatedTpl = await authReq('/labs/samples/import-csv-with-template', s1Cookie, 'POST', {
    csvContent: csv4,
    templateId,
  });
  assert(importWithDeactivatedTpl.data.success === false, 'Cannot import with deactivated template');
  assert(importWithDeactivatedTpl.data.error?.includes('已停用'), 'Error mentions template deactivated');

  const tplBatchDetail3 = await authReq(`/labs/batches/${tplBatchId}`, s1Cookie);
  const tplBatch3 = tplBatchDetail3.data.data.batch;
  assert(!!tplBatch3.templateSnapshot, 'Existing batch snapshot still intact after template deactivation');
  assert(tplBatch3.templateSnapshot.name === `常规血液样本模板-${TS}`, 'Snapshot name still correct');

  const tplAfterDeactivate = await authReq(`/labs/templates/${templateId}`, s1Cookie);
  assert(tplAfterDeactivate.data.data.template.referencedCount === 1, 'Template referencedCount still 1 after deactivation');

  // ============== Test 11: Submit Draft to Import ==============
  console.log('\n=== Test 11: Submit Draft to Import ===');

  const draftForSubmit = await authReq('/labs/drafts', s1Cookie, 'POST', {
    name: `待提交草稿-${TS}`,
    csvContent: `sampleCode,type,description,sourceLocation,minTemp,maxTemp,initialTemperature,tempLocation
SUBMIT-${TS}-001,blood,submit draft test 1,Building A,2,8,4.5,Freezer A
SUBMIT-${TS}-002,blood,submit draft test 2,Building B,2,8,3.8,Freezer B`,
  });
  assert(draftForSubmit.data.success === true, 'Create draft for submit');
  const submitDraftId = draftForSubmit.data.data.draft.id;

  const submitDraft = await authReq(`/labs/drafts/${submitDraftId}/import`, s1Cookie, 'POST', {
    clientVersion: 1,
  });
  assert(submitDraft.status === 201, `Submit draft returns 201 (got ${submitDraft.status})`);
  assert(submitDraft.data.success === true, 'Submit draft import success');
  assert(submitDraft.data.data.importedCount === 2, 'Draft imported 2 samples');

  const getDraftAfterSubmit = await authReq(`/labs/drafts/${submitDraftId}`, s1Cookie);
  assert(getDraftAfterSubmit.data.data.draft.status === 'IMPORTED', 'Draft status = IMPORTED after submit');
  assert(!!getDraftAfterSubmit.data.data.draft.batchId, 'Draft has batchId after submit');

  const submitAgain = await authReq(`/labs/drafts/${submitDraftId}/import`, s1Cookie, 'POST', {
    clientVersion: 2,
  });
  assert(submitAgain.data.success === false, 'Cannot submit imported draft again');
  assert(submitAgain.data.error?.includes('已提交或已取消'), 'Error mentions already submitted');

  const submitConflict = await authReq(`/labs/drafts/${draftId}/import`, s1Cookie, 'POST', {
    clientVersion: 1,
  });
  assert(submitConflict.status === 409, `Submit with old version returns 409 (got ${submitConflict.status})`);
  assert(!!submitConflict.data.conflict, 'Conflict info returned on submit conflict');

  // ============== Test 12: Export after Undo ==============
  console.log('\n=== Test 12: Export Consistency After Undo ===');

  const csvExportTest = `sampleCode,type,description,sourceLocation,minTemp,maxTemp,initialTemperature,tempLocation
EXPORT-${TS}-001,blood,export undo test 1,Building A,2,8,4.0,Freezer A
EXPORT-${TS}-002,blood,export undo test 2,Building B,2,8,3.5,Freezer B`;
  const importForExport = await authReq('/labs/samples/import-csv', s1Cookie, 'POST', { csvContent: csvExportTest });
  assert(importForExport.data.success === true, 'Import samples for export undo test');
  const exportTestBatchCode = importForExport.data.data.batch.batchCode;

  const exportBefore = await fetch(BASE + '/admin/export/batches', {
    headers: { Cookie: s1Cookie },
  });
  const exportTextBefore = await exportBefore.text();
  assert(exportBefore.status === 200, 'Export before undo check works');

  const countInExport = (text, code) => (text.match(new RegExp(code, 'g')) || []).length;
  const beforeCount = countInExport(exportTextBefore, `EXPORT-${TS}`);
  assert(beforeCount > 0, 'Newly imported samples appear in export before undo');
  const submitBeforeCount = countInExport(exportTextBefore, `SUBMIT-${TS}`);
  console.log(`  Info: SUBMIT samples in export before undo: ${submitBeforeCount}`);

  const undoBeforeExport = await authReq('/labs/import-undo/undo', s1Cookie, 'POST', {});
  assert(undoBeforeExport.data.success === true, 'Undo the newly imported batch');

  const exportAfter = await fetch(BASE + '/admin/export/batches', {
    headers: { Cookie: s1Cookie },
  });
  const exportTextAfter = await exportAfter.text();
  assert(exportAfter.status === 200, 'Export after undo check works');

  const afterCount = countInExport(exportTextAfter, `EXPORT-${TS}`);
  assert(afterCount === 0, 'Undone EXPORT samples do not appear in export after undo');
  const submitAfterCount = countInExport(exportTextAfter, `SUBMIT-${TS}`);
  console.log(`  Info: SUBMIT samples in export after undo: ${submitAfterCount}`);

  // ============== Test 13: Draft Delete ==============
  console.log('\n=== Test 13: Draft Delete ===');

  const deleteDraftNoPerm = await authReq(`/labs/drafts/${draftId}`, s2Cookie, 'DELETE');
  assert(deleteDraftNoPerm.data.success === false, 'Sampler2 cannot delete sampler1 draft');

  const deleteDraft = await authReq(`/labs/drafts/${draftId}`, s1Cookie, 'DELETE');
  assert(deleteDraft.data.success === true, 'Delete draft success');

  const getDeletedDraft = await authReq(`/labs/drafts/${draftId}`, s1Cookie);
  assert(getDeletedDraft.data.success === false, 'Deleted draft no longer accessible');

  // ============== Test 14: Undo Records List ==============
  console.log('\n=== Test 14: Undo Records List ===');

  const undoRecords = await authReq('/labs/import-undo', s1Cookie);
  assert(undoRecords.data.success === true, 'List undo records success');
  assert(undoRecords.data.data.records.length >= 2, 'At least 2 undo records');
  const records = undoRecords.data.data.records;
  const undoneRecords = records.filter(r => r.undone === true);
  const notUndoneRecords = records.filter(r => r.undone !== true);
  console.log(`  Info: Total records=${records.length}, undone=${undoneRecords.length}, not-undone=${notUndoneRecords.length}`);
  console.log(`    Undone batch codes: ${undoneRecords.map(r => r.batchCode).join(', ')}`);
  console.log(`    Not-undone batch codes: ${notUndoneRecords.map(r => r.batchCode).join(', ')}`);
  assert(undoneRecords.length >= 1, 'Some records marked as undone (at least 1 from successful undo)');

  const undoRecordsS2 = await authReq('/labs/import-undo', s2Cookie);
  const s2Records = undoRecordsS2.data.data.records.filter(r => r.createdBy !== sampler2.data.data.user.id);
  assert(s2Records.length === 0, 'Sampler2 only sees own undo records');

  const undoRecordsAdmin = await authReq('/labs/import-undo', aCookie);
  assert(undoRecordsAdmin.data.data.records.length >= undoRecords.data.data.records.length, 'Admin sees all undo records');

  // ============== Summary ==============
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);

  if (failed > 0) {
    console.log('\n❌ Some tests failed. Please review the output above.');
    process.exit(1);
  } else {
    console.log('\n✅ All tests passed!');
    console.log('\n📋 Next steps for manual verification:');
    console.log('  1. For cross-restart recovery:');
    console.log('     - Stop the server (Ctrl+C)');
    console.log('     - Run: npm run server:dev');
    console.log('     - Run: node test-restart-draft.mjs');
    console.log('  2. For admin undo verification:');
    console.log('     - Login as admin1/admin123');
    console.log('     - Call POST /api/labs/import-undo/undo to undo sampler1\'s import');
    console.log('     - Verify undo succeeds and records proper audit log');
    process.exit(0);
  }
}

run().catch(e => { console.error(e); process.exit(1); });
