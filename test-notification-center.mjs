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

  // ============== Test 1: Notification Permission Isolation ====
  console.log('\n=== Test 1: Notification Permission Isolation ===');

  const csv1 = `sampleCode,type,description,sourceLocation,minTemp,maxTemp,initialTemperature,tempLocation
NOTIF-${TS}-001,blood,notification test 1,Building A,2,8,4.5,Freezer A
NOTIF-${TS}-002,blood,notification test 2,Building B,2,8,3.8,Freezer B`;

  const import1 = await authReq('/labs/samples/import-csv', s1Cookie, 'POST', { csvContent: csv1 });
  assert(import1.status === 201, `Sampler1 CSV import returns 201 (got ${import1.status})`);
  assert(import1.data.success === true, 'Sampler1 CSV import success');
  const batch1Id = import1.data.data.batch.id;
  const batch1Code = import1.data.data.batch.batchCode;

  await sleep(50);

  const s1Notifs = await authReq('/labs/notifications', s1Cookie);
  assert(s1Notifs.data.success === true, 'Sampler1 can list own notifications');
  const s1NotifList = s1Notifs.data.data.notifications;
  assert(s1NotifList.length >= 1, 'Sampler1 has at least 1 notification');

  const importNotifS1 = s1NotifList.find(n => n.type === 'IMPORT_SUCCESS' && n.batchCode === batch1Code);
  assert(!!importNotifS1, 'Sampler1 IMPORT_SUCCESS notification exists');
  assert(importNotifS1.operatorId === sampler1.data.data.id, 'Notification operatorId matches sampler1');
  assert(importNotifS1.operatorName === '张采样', 'Notification operatorName is 张采样');
  assert(importNotifS1.status === 'SUCCESS', 'Notification status is SUCCESS');
  assert(importNotifS1.rolledBack === false, 'Notification rolledBack is false initially');
  assert(!!importNotifS1.result, 'Notification has result data');
  assert(importNotifS1.result.importedCount === 2, 'Notification result importedCount = 2');

  const s2Notifs = await authReq('/labs/notifications', s2Cookie);
  assert(s2Notifs.data.success === true, 'Sampler2 can list own notifications');
  const s2Filtered = s2Notifs.data.data.notifications.filter(n => n.batchCode === batch1Code);
  assert(s2Filtered.length === 0, 'Sampler2 cannot see sampler1\'s notifications');

  const r1Notifs = await authReq('/labs/notifications', r1Cookie);
  assert(r1Notifs.data.success === true, 'Receiver1 can list own notifications');
  const r1Filtered = r1Notifs.data.data.notifications.filter(n => n.batchCode === batch1Code);
  assert(r1Filtered.length === 0, 'Receiver1 cannot see sampler1\'s notifications');

  const aNotifs = await authReq('/labs/notifications', aCookie);
  assert(aNotifs.data.success === true, 'Admin can list all notifications');
  const adminHasS1Notif = aNotifs.data.data.notifications.some(n => n.batchCode === batch1Code);
  assert(adminHasS1Notif, 'Admin can see sampler1\'s notification');
  assert(aNotifs.data.data.total >= s1Notifs.data.data.total, 'Admin sees >= notifications than sampler1');

  // ============== Test 2: Notification Detail Access ====
  console.log('\n=== Test 2: Notification Detail Access ===');

  const notifId = importNotifS1.id;
  const s1Detail = await authReq(`/labs/notifications/${notifId}`, s1Cookie);
  assert(s1Detail.data.success === true, 'Sampler1 can view own notification detail');
  assert(s1Detail.data.data.notification.id === notifId, 'Notification detail ID matches');
  assert(s1Detail.data.data.notification.batchId === batch1Id, 'Notification batchId matches');

  const s2Detail = await authReq(`/labs/notifications/${notifId}`, s2Cookie);
  assert(s2Detail.status === 403, `Sampler2 cannot view sampler1's notification (403, got ${s2Detail.status})`);
  assert(s2Detail.data.success === false, 'Sampler2 view notification fails');
  assert(s2Detail.data.error?.includes('无权'), 'Error message indicates no permission');

  const aDetail = await authReq(`/labs/notifications/${notifId}`, aCookie);
  assert(aDetail.data.success === true, 'Admin can view any notification detail');

  // ============== Test 3: Notification Stats ====
  console.log('\n=== Test 3: Notification Stats ===');

  const s1Stats = await authReq('/labs/notifications/stats', s1Cookie);
  assert(s1Stats.data.success === true, 'Sampler1 can get notification stats');
  assert(s1Stats.data.data.stats.total >= 1, 'Sampler1 stats total >= 1');
  assert(s1Stats.data.data.stats.successCount >= 1, 'Sampler1 stats successCount >= 1');
  assert(typeof s1Stats.data.data.stats.byType === 'object', 'Stats has byType breakdown');
  assert(s1Stats.data.data.stats.byType.IMPORT_SUCCESS >= 1, 'byType includes IMPORT_SUCCESS');

  const aStats = await authReq('/labs/notifications/stats', aCookie);
  assert(aStats.data.success === true, 'Admin can get notification stats');
  assert(aStats.data.data.stats.total >= s1Stats.data.data.stats.total, 'Admin stats >= sampler1 stats');

  // ============== Test 4: Import Failure Notification ====
  console.log('\n=== Test 4: Import Failure Notification ===');

  const csvBad = `sampleCode,type,description,sourceLocation,minTemp,maxTemp,initialTemperature,tempLocation
NOTIF-BAD-${TS}-001,,missing type,Building A,2,8,4.5,Freezer A`;

  const importBad = await authReq('/labs/samples/import-csv', s1Cookie, 'POST', { csvContent: csvBad });
  assert(importBad.data.success === false, 'Bad CSV import fails as expected');

  await sleep(50);

  const s1NotifsAfterFail = await authReq('/labs/notifications?type=IMPORT_FAILURE', s1Cookie);
  assert(s1NotifsAfterFail.data.success === true, 'Can filter notifications by type=IMPORT_FAILURE');
  const failureNotifs = s1NotifsAfterFail.data.data.notifications.filter(n => n.type === 'IMPORT_FAILURE');
  assert(failureNotifs.length >= 1, 'At least 1 IMPORT_FAILURE notification exists');
  assert(failureNotifs[0].status === 'FAILURE', 'Failure notification status = FAILURE');
  assert(failureNotifs[0].rolledBack === false, 'Failure notification rolledBack = false');

  // ============== Test 5: Draft Save/Update Notifications ====
  console.log('\n=== Test 5: Draft Save & Update Notifications ===');

  const receivers = await authReq('/labs/users/receivers', s1Cookie);
  const receiverId = receivers.data.data.find(u => u.username === 'receiver1').id;

  const createTpl = await authReq('/labs/templates', s1Cookie, 'POST', {
    name: `通知测试模板-${TS}`,
    intendedReceiverId: receiverId,
    storageConditions: '2-8℃冷藏',
    shippingRequirements: '冷链运输',
    defaultMinTemp: 2,
    defaultMaxTemp: 8,
  });
  assert(createTpl.data.success === true, 'Create template for notification test');
  const templateId = createTpl.data.data.template.id;
  const templateName = createTpl.data.data.template.name;

  const csvDraft = `sampleCode,type,description,sourceLocation,minTemp,maxTemp,initialTemperature,tempLocation
NOTIF-DRAFT-${TS}-001,urine,draft notif test,Building C,2,8,5.0,Freezer C`;

  const saveDraft = await authReq('/labs/drafts', s1Cookie, 'POST', {
    name: `通知中心测试草稿-${TS}`,
    csvContent: csvDraft,
    templateId,
  });
  assert(saveDraft.data.success === true, 'Save draft for notification test');
  const draftId = saveDraft.data.data.draft.id;
  const draftName = saveDraft.data.data.draft.name;

  await sleep(50);

  const draftNotifs = await authReq(`/labs/notifications?draftId=${draftId}`, s1Cookie);
  assert(draftNotifs.data.success === true, 'Can filter notifications by draftId');
  const saveNotif = draftNotifs.data.data.notifications.find(n => n.type === 'DRAFT_SAVE');
  assert(!!saveNotif, 'DRAFT_SAVE notification exists');
  assert(saveNotif.draftId === draftId, 'DRAFT_SAVE notification draftId matches');
  assert(saveNotif.templateId === templateId, 'DRAFT_SAVE notification templateId matches');
  assert(saveNotif.templateName === templateName, 'DRAFT_SAVE notification templateName matches');

  const updateDraft = await authReq('/labs/drafts', s1Cookie, 'POST', {
    id: draftId,
    name: `${draftName}-更新`,
    csvContent: csvDraft + `\nNOTIF-DRAFT-${TS}-002,urine,draft notif test 2,Building D,2,8,4.2,Freezer D`,
    templateId,
    clientVersion: 1,
  });
  assert(updateDraft.data.success === true, 'Update draft success');

  await sleep(50);

  const draftNotifs2 = await authReq(`/labs/notifications?draftId=${draftId}`, s1Cookie);
  const updateNotif = draftNotifs2.data.data.notifications.find(n => n.type === 'DRAFT_UPDATE');
  assert(!!updateNotif, 'DRAFT_UPDATE notification exists');
  assert(updateNotif.result?.version === 2, 'DRAFT_UPDATE notification result version = 2');

  // ============== Test 6: Draft Conflict Notification ====
  console.log('\n=== Test 6: Draft Conflict Notification ===');

  const adminUpdate = await authReq('/labs/drafts', aCookie, 'POST', {
    id: draftId,
    name: `管理员修改-${TS}`,
    csvContent: csvDraft,
    templateId,
    clientVersion: 2,
  });
  assert(adminUpdate.data.success === true, 'Admin updates same draft (version 2->3)');

  const conflictSave = await authReq('/labs/drafts', s1Cookie, 'POST', {
    id: draftId,
    name: `采样员尝试冲突修改`,
    csvContent: csvDraft,
    templateId,
    clientVersion: 1,
  });
  assert(conflictSave.status === 409, `Conflict save returns 409 (got ${conflictSave.status})`);
  assert(conflictSave.data.conflict?.hasConflict === true, 'Conflict detected');

  await sleep(50);

  const conflictNotifs = await authReq('/labs/notifications?type=DRAFT_CONFLICT', s1Cookie);
  const conflictNotif = conflictNotifs.data.data.notifications.find(n => n.draftId === draftId);
  assert(!!conflictNotif, 'DRAFT_CONFLICT notification exists');
  assert(conflictNotif.status === 'FAILURE', 'Conflict notification status = FAILURE');
  assert(conflictNotif.result?.lastEditedByName === '孙管理', 'Conflict notif shows last editor is admin');

  // ============== Test 7: Draft Cancel Notification ====
  console.log('\n=== Test 7: Draft Cancel Notification ===');

  const draftForCancel = await authReq('/labs/drafts', s1Cookie, 'POST', {
    name: `待取消草稿-${TS}`,
    csvContent: csvDraft,
  });
  assert(draftForCancel.data.success === true, 'Create draft for cancel test');
  const cancelDraftId = draftForCancel.data.data.draft.id;

  const cancelDraft = await authReq(`/labs/drafts/${cancelDraftId}/cancel`, s1Cookie, 'POST', {});
  assert(cancelDraft.data.success === true, 'Cancel draft success');

  await sleep(50);

  const cancelNotifs = await authReq(`/labs/notifications?draftId=${cancelDraftId}`, s1Cookie);
  const cancelNotif = cancelNotifs.data.data.notifications.find(n => n.type === 'DRAFT_CANCEL');
  assert(!!cancelNotif, 'DRAFT_CANCEL notification exists');
  assert(cancelNotif.result?.status === 'CANCELLED', 'Cancel notif result status = CANCELLED');

  // ============== Test 8: Draft Submit (Import from Draft) Notification ====
  console.log('\n=== Test 8: Draft Submit Notification ===');

  const csvForSubmit = `sampleCode,type,description,sourceLocation,minTemp,maxTemp,initialTemperature,tempLocation
NOTIF-SUBMIT-${TS}-001,blood,submit test 1,Building A,2,8,4.5,Freezer A
NOTIF-SUBMIT-${TS}-002,blood,submit test 2,Building B,2,8,3.8,Freezer B`;

  const submitDraftCreate = await authReq('/labs/drafts', s1Cookie, 'POST', {
    name: `待提交草稿-${TS}`,
    csvContent: csvForSubmit,
    templateId,
  });
  assert(submitDraftCreate.data.success === true, 'Create draft for submit test');
  const submitDraftId = submitDraftCreate.data.data.draft.id;
  const submitVersion = submitDraftCreate.data.data.draft.version;

  const submitDraft = await authReq(`/labs/drafts/${submitDraftId}/import`, s1Cookie, 'POST', {
    clientVersion: submitVersion,
  });
  assert(submitDraft.status === 201, `Draft submit returns 201 (got ${submitDraft.status})`);
  assert(submitDraft.data.success === true, 'Draft submit success');
  const submitBatchId = submitDraft.data.data.batch.id;
  const submitBatchCode = submitDraft.data.data.batch.batchCode;

  await sleep(50);

  const submitNotifs = await authReq(`/labs/notifications?batchId=${submitBatchId}`, s1Cookie);
  const submitNotif = submitNotifs.data.data.notifications.find(n => n.type === 'DRAFT_SUBMIT');
  assert(!!submitNotif, 'DRAFT_SUBMIT notification exists');
  assert(submitNotif.batchId === submitBatchId, 'Submit notif batchId matches');
  assert(submitNotif.batchCode === submitBatchCode, 'Submit notif batchCode matches');
  assert(submitNotif.draftId === submitDraftId, 'Submit notif draftId matches');
  assert(submitNotif.result?.importedCount === 2, 'Submit notif importedCount = 2');

  const tplApplyNotif = submitNotifs.data.data.notifications.find(n => n.type === 'TEMPLATE_APPLY');
  assert(!!tplApplyNotif, 'TEMPLATE_APPLY notification exists after draft submit');
  assert(tplApplyNotif.templateId === templateId, 'Template apply notif templateId matches');
  assert(tplApplyNotif.templateName === templateName, 'Template apply notif templateName matches');

  // ============== Test 9: Export Notification ====
  console.log('\n=== Test 9: Export Notification ===');

  const exportBefore = await authReq('/labs/notifications?type=EXPORT_SUCCESS', s1Cookie);
  const beforeCount = exportBefore.data.data.notifications.length;

  const exportRes = await fetch(BASE + '/admin/export/batches', {
    headers: { Cookie: s1Cookie },
  });
  assert(exportRes.status === 200, 'Export batches returns 200');

  await sleep(50);

  const exportAfter = await authReq('/labs/notifications?type=EXPORT_SUCCESS', s1Cookie);
  const afterCount = exportAfter.data.data.notifications.length;
  assert(afterCount > beforeCount, 'New EXPORT_SUCCESS notification created after export');

  const latestExport = exportAfter.data.data.notifications[0];
  assert(latestExport.type === 'EXPORT_SUCCESS', 'Latest export notification type correct');
  assert(latestExport.status === 'SUCCESS', 'Export notification status = SUCCESS');
  assert(latestExport.result?.exportType === 'batches', 'Export notif result exportType = batches');

  // ============== Test 10: Undo Import - Notification Rollback ====
  console.log('\n=== Test 10: Undo Import - Notification Rollback ===');

  const csvForUndo = `sampleCode,type,description,sourceLocation,minTemp,maxTemp,initialTemperature,tempLocation
NOTIF-UNDO-${TS}-001,blood,undo test sample 1,Building A,2,8,4.0,Freezer A
NOTIF-UNDO-${TS}-002,urine,undo test sample 2,Building A,2,8,5.0,Freezer A`;

  const importForUndo = await authReq('/labs/samples/import-csv', s1Cookie, 'POST', { csvContent: csvForUndo });
  assert(importForUndo.data.success === true, 'Direct CSV import for undo test');
  const undoBatchId = importForUndo.data.data.batch.id;
  const undoBatchCode = importForUndo.data.data.batch.batchCode;

  const notifsBeforeUndo = await authReq(`/labs/notifications?batchId=${undoBatchId}`, s1Cookie);
  const beforeUndoList = notifsBeforeUndo.data.data.notifications;
  assert(beforeUndoList.length >= 1, 'Notifications exist for batch before undo');
  assert(beforeUndoList.every(n => n.rolledBack === false), 'All notifs rolledBack = false before undo');

  const undoRes = await authReq('/labs/import-undo/undo', s1Cookie, 'POST', {});
  assert(undoRes.data.success === true, 'Undo import success');
  assert(undoRes.data.data.undoneData.draftReverted === false, 'No draft reverted (direct import)');

  await sleep(50);

  const notifsAfterUndo = await authReq(`/labs/notifications?batchId=${undoBatchId}`, s1Cookie);
  const afterUndoList = notifsAfterUndo.data.data.notifications;
  assert(afterUndoList.length >= 1, 'Notifications still exist after undo (not deleted, just rolled back)');
  const rolledBackNotifs = afterUndoList.filter(n => n.rolledBack === true);
  assert(rolledBackNotifs.length >= 1, 'At least 1 notification marked as rolledBack');
  for (const n of rolledBackNotifs) {
    assert(n.status === 'ROLLED_BACK', `Rolled-back notification ${n.id} status = ROLLED_BACK`);
    assert(!!n.rolledBackAt, `Rolled-back notification ${n.id} has rolledBackAt timestamp`);
    assert(n.rolledBackBy === sampler1.data.data.id, `Rolled-back notification ${n.id} rolledBackBy correct`);
    assert(n.rolledBackByName === '张采样', `Rolled-back notification ${n.id} rolledBackByName correct`);
  }

  const undoNotifs = await authReq('/labs/notifications?type=UNDO_SUCCESS', s1Cookie);
  const undoNotif = undoNotifs.data.data.notifications.find(n => n.batchCode === undoBatchCode);
  assert(!!undoNotif, 'UNDO_SUCCESS notification exists');
  assert(undoNotif.status === 'SUCCESS', 'Undo notif status = SUCCESS');
  assert(undoNotif.rolledBack === false, 'Undo notif itself NOT rolled back');
  assert(undoNotif.result?.sampleCount === 2, 'Undo notif result sampleCount = 2');
  assert(undoNotif.result?.rolledBackNotificationCount >= 1, 'Undo notif reports rolledBackNotificationCount');

  const rollbackAudits = await authReq('/admin/audits?action=ROLLBACK_NOTIFICATIONS', aCookie);
  assert(rollbackAudits.data.data.audits.length >= 1, 'ROLLBACK_NOTIFICATIONS audit record exists');

  // ============== Test 11: No Records to Undo - Failure Case ====
  console.log('\n=== Test 11: No Undo Records - Failure Handling ===');

  const csvForS2 = `sampleCode,type,description,sourceLocation,minTemp,maxTemp,initialTemperature,tempLocation
NOTIF-S2IMPORT-${TS}-001,blood,s2 own import,Building A,2,8,4.0,Freezer A`;

  const importS2 = await authReq('/labs/samples/import-csv', s2Cookie, 'POST', { csvContent: csvForS2 });
  assert(importS2.data.success === true, 'Sampler2 imports their own batch');

  const undoS2Own = await authReq('/labs/import-undo/undo', s2Cookie, 'POST', {});
  assert(undoS2Own.data.success === true, 'Sampler2 undoes their OWN import successfully');
  assert(undoS2Own.data.data.undoneData.sampleCount === 1, 'Sampler2 undo removed 1 sample');

  await sleep(50);

  const undoS2None = await authReq('/labs/import-undo/undo', s2Cookie, 'POST', {});
  assert(undoS2None.data.success === false, 'Sampler2 has no more imports to undo');
  assert(undoS2None.data.error?.includes('没有可撤销'), 'Error indicates no undo records available');

  const s2UndoSuccess = await authReq('/labs/notifications?type=UNDO_SUCCESS', s2Cookie);
  assert(s2UndoSuccess.data.data.notifications.length >= 1, 'Sampler2 has UNDO_SUCCESS notification for own undo');

  // ============== Test 12: Undo Blocked (In-Transit Samples) Notification ====
  console.log('\n=== Test 12: Undo Blocked - Failure Notification ===');

  const csvForBlock = `sampleCode,type,description,sourceLocation,minTemp,maxTemp,initialTemperature,tempLocation
NOTIF-UNDOBLOCK-${TS}-001,blood,undo block test,Building A,2,8,4.0,Freezer A`;

  const importForBlock = await authReq('/labs/samples/import-csv', s1Cookie, 'POST', { csvContent: csvForBlock });
  assert(importForBlock.data.success === true, 'Import for block test');
  const blockBatchId = importForBlock.data.data.batch.id;

  const initiate = await authReq(`/labs/batches/${blockBatchId}/initiate-handover`, s1Cookie, 'POST', {
    intendedReceiverId: receiverId,
    note: 'For undo block notification test',
  });
  assert(initiate.data.success === true, 'Initiate handover success');

  const undoBlocked = await authReq('/labs/import-undo/undo', s1Cookie, 'POST', {});
  assert(undoBlocked.data.success === false, 'Undo blocked for in-transit samples');

  await sleep(50);

  const undoBlockNotifs = await authReq('/labs/notifications?type=UNDO_FAILURE', s1Cookie);
  const blockNotif = undoBlockNotifs.data.data.notifications.find(n => n.batchId === blockBatchId);
  assert(!!blockNotif, 'UNDO_FAILURE notification for blocked undo exists');
  if (blockNotif) {
    assert(blockNotif.status === 'FAILURE', 'Blocked undo notif status = FAILURE');
    assert(blockNotif.result?.error === '样本已流转', 'Blocked undo notif result error correct');
  }

  // ============== Test 13: Notification Filter by Status & RolledBack ====
  console.log('\n=== Test 13: Notification Filtering ===');

  const successNotifs = await authReq('/labs/notifications?status=SUCCESS', s1Cookie);
  assert(successNotifs.data.success === true, 'Filter by status=SUCCESS works');
  for (const n of successNotifs.data.data.notifications) {
    assert(n.status === 'SUCCESS', `Notification ${n.id} status = SUCCESS`);
  }

  const statusFailureNotifs = await authReq('/labs/notifications?status=FAILURE', s1Cookie);
  assert(statusFailureNotifs.data.success === true, 'Filter by status=FAILURE works');

  const rolledBackFilter = await authReq('/labs/notifications?rolledBack=true', s1Cookie);
  assert(rolledBackFilter.data.success === true, 'Filter by rolledBack=true works');
  for (const n of rolledBackFilter.data.data.notifications) {
    assert(n.rolledBack === true, `Notification ${n.id} rolledBack = true`);
  }

  const notRolledBackFilter = await authReq('/labs/notifications?rolledBack=false', s1Cookie);
  assert(notRolledBackFilter.data.success === true, 'Filter by rolledBack=false works');
  for (const n of notRolledBackFilter.data.data.notifications) {
    assert(n.rolledBack === false, `Notification ${n.id} rolledBack = false`);
  }

  // ============== Test 14: Admin Filter by operatorId ====
  console.log('\n=== Test 14: Admin Filter by operatorId ===');

  const s1UserId = sampler1.data.data.id;
  const adminFilterByUser = await authReq(`/labs/notifications?operatorId=${s1UserId}`, aCookie);
  assert(adminFilterByUser.data.success === true, 'Admin can filter by operatorId');
  for (const n of adminFilterByUser.data.data.notifications) {
    assert(n.operatorId === s1UserId, `Notification ${n.id} operatorId matches filter`);
  }

  const s2FilterByUser = await authReq(`/labs/notifications?operatorId=${s1UserId}`, s2Cookie);
  assert(s2FilterByUser.data.success === true, 'Non-admin operatorId filter is ignored (only sees own)');
  for (const n of s2FilterByUser.data.data.notifications) {
    assert(n.operatorId === sampler2.data.data.id, 'Non-admin still only sees own notifications');
  }

  // ============== Test 15: Notification Integrity - No Mixing with Temp Alerts ====
  console.log('\n=== Test 15: Notification Integrity - No Mixing with Temp Alerts ===');

  const allNotifs = await authReq('/labs/notifications', aCookie);
  const types = new Set(allNotifs.data.data.notifications.map(n => n.type));
  const validTypes = [
    'TEMPLATE_APPLY', 'DRAFT_SAVE', 'DRAFT_UPDATE', 'DRAFT_SUBMIT',
    'IMPORT_SUCCESS', 'IMPORT_FAILURE', 'EXPORT_SUCCESS', 'EXPORT_FAILURE',
    'UNDO_SUCCESS', 'UNDO_FAILURE', 'DRAFT_CONFLICT', 'DRAFT_CANCEL'
  ];
  for (const t of types) {
    assert(validTypes.includes(t), `Notification type ${t} is a valid import-related type (not temp alert)`);
  }

  // ============== Test 16: Read/Unread Tracking ====
  console.log('\n=== Test 16: Read/Unread Tracking ===');

  const s1NotifsWithRead = await authReq('/labs/notifications', s1Cookie);
  assert(s1NotifsWithRead.data.success === true, 'Notification list includes read flags');
  assert(typeof s1NotifsWithRead.data.data.unreadCount === 'number', 'Response includes unreadCount');
  assert(s1NotifsWithRead.data.data.unreadCount >= 0, 'unreadCount is non-negative');
  console.log(`  Info: Sampler1 unreadCount = ${s1NotifsWithRead.data.data.unreadCount}`);

  const firstUnread = s1NotifsWithRead.data.data.notifications.find(n => n.isRead === false);
  const testNotifForRead = firstUnread || s1NotifsWithRead.data.data.notifications[0];
  assert(!!testNotifForRead, 'Has at least one notification for read test');
  assert(typeof testNotifForRead.isRead === 'boolean', 'Notification has isRead field');

  const readByIsObject = typeof testNotifForRead.readBy === 'object' && testNotifForRead.readBy !== null;
  assert(readByIsObject, 'Notification has readBy object');

  // ============== Test 17: Mark Single Notification as Read ====
  console.log('\n=== Test 17: Mark Single Notification as Read ===');

  const markReadRes = await authReq(`/labs/notifications/${testNotifForRead.id}/read`, s1Cookie, 'POST', {});
  assert(markReadRes.data.success === true, 'Mark notification as read succeeds');
  assert(markReadRes.data.data.read === true, 'Response confirms read = true');
  assert(!!markReadRes.data.data.readAt, 'Response includes readAt timestamp');

  const s1NotifsAfterRead = await authReq('/labs/notifications', s1Cookie);
  const afterReadUnreadCount = s1NotifsAfterRead.data.data.unreadCount;
  const beforeReadUnreadCount = s1NotifsWithRead.data.data.unreadCount;
  if (testNotifForRead.isRead === false) {
    assert(afterReadUnreadCount === beforeReadUnreadCount - 1,
      `Unread count decreased by 1 (${beforeReadUnreadCount} -> ${afterReadUnreadCount})`);
  } else {
    assert(afterReadUnreadCount === beforeReadUnreadCount,
      'Unread count unchanged for already-read notification');
  }

  const detailAfterRead = await authReq(`/labs/notifications/${testNotifForRead.id}`, s1Cookie);
  assert(detailAfterRead.data.data.notification.isRead === true,
    'Notification detail shows isRead = true after marking');

  // ============== Test 18: Mark All Notifications as Read ====
  console.log('\n=== Test 18: Mark All Notifications as Read ===');

  const s2NotifsBeforeAll = await authReq('/labs/notifications', s2Cookie);
  console.log(`  Info: Sampler2 unread before = ${s2NotifsBeforeAll.data.data.unreadCount}`);

  const markAllRes = await authReq('/labs/notifications/read-all', s2Cookie, 'POST', {});
  assert(markAllRes.data.success === true, 'Mark all as read succeeds');
  assert(typeof markAllRes.data.data.readCount === 'number', 'Response includes readCount');
  console.log(`  Info: Marked ${markAllRes.data.data.readCount} as read for sampler2`);

  const s2NotifsAfterAll = await authReq('/labs/notifications', s2Cookie);
  assert(s2NotifsAfterAll.data.data.unreadCount === 0,
    `Unread count = 0 after mark-all (got ${s2NotifsAfterAll.data.data.unreadCount})`);
  assert(s2NotifsAfterAll.data.data.notifications.every(n => n.isRead === true),
    'All notifications show isRead = true after mark-all');

  // ============== Test 19: Read State Per-User Isolation ====
  console.log('\n=== Test 19: Read State Per-User Isolation ===');

  const aNotifsBeforeAll = await authReq('/labs/notifications', aCookie);
  const adminUnreadBefore = aNotifsBeforeAll.data.data.unreadCount;

  const adminMarkAll = await authReq('/labs/notifications/read-all', aCookie, 'POST', {});
  assert(adminMarkAll.data.success === true, 'Admin mark all succeeds');

  const aNotifsAfterAll = await authReq('/labs/notifications', aCookie);
  assert(aNotifsAfterAll.data.data.unreadCount === 0, 'Admin unread = 0 after mark-all');

  const s1NotifsAfterAdminRead = await authReq('/labs/notifications', s1Cookie);
  assert(s1NotifsAfterAdminRead.data.data.unreadCount === afterReadUnreadCount,
    'Sampler1 unread unaffected by admin mark-all');

  // ============== Test 20: Notification Detail with Related Objects & Audit Timeline ====
  console.log('\n=== Test 20: Notification Detail with Audit Timeline ===');

  const detailRes = await authReq(`/labs/notifications/${importNotifS1.id}/detail`, s1Cookie);
  assert(detailRes.data.success === true, 'Get notification detail with timeline succeeds');
  assert(!!detailRes.data.data.notification, 'Detail response includes notification');
  assert(detailRes.data.data.notification.id === importNotifS1.id, 'Notification ID matches');
  assert(typeof detailRes.data.data.relatedBatch === 'object', 'Detail includes relatedBatch field');
  assert(typeof detailRes.data.data.relatedDraft === 'object', 'Detail includes relatedDraft field');
  assert(typeof detailRes.data.data.relatedTemplate === 'object', 'Detail includes relatedTemplate field');
  assert(Array.isArray(detailRes.data.data.auditTimeline), 'Detail includes auditTimeline array');

  const relatedBatch = detailRes.data.data.relatedBatch;
  assert(relatedBatch !== null, 'Import notification has related batch');
  assert(relatedBatch.id === batch1Id, 'Related batch ID matches');
  assert(relatedBatch.batchCode === batch1Code, 'Related batch code matches');
  assert(!!relatedBatch.status, 'Related batch has status');

  const timeline = detailRes.data.data.auditTimeline;
  assert(timeline.length > 0, 'Audit timeline has entries for import batch');
  const firstTimelineEntry = timeline[0];
  assert(!!firstTimelineEntry.id, 'Timeline entry has id');
  assert(!!firstTimelineEntry.action, 'Timeline entry has action');
  assert(!!firstTimelineEntry.operatorName, 'Timeline entry has operatorName');
  assert(!!firstTimelineEntry.timestamp, 'Timeline entry has timestamp');
  assert(typeof firstTimelineEntry.success === 'boolean', 'Timeline entry has success flag');
  console.log(`  Info: Audit timeline has ${timeline.length} entries`);
  console.log(`  Info: First timeline action = ${firstTimelineEntry.action} by ${firstTimelineEntry.operatorName}`);

  // ============== Test 21: Unauthorized Access to Notification Detail ====
  console.log('\n=== Test 21: Unauthorized Access - Detail Endpoint ===');

  const s2DetailTimeline = await authReq(`/labs/notifications/${importNotifS1.id}/detail`, s2Cookie);
  assert(s2DetailTimeline.status === 403,
    `Sampler2 cannot access sampler1's notification detail timeline (403, got ${s2DetailTimeline.status})`);
  assert(s2DetailTimeline.data.success === false, 'Unauthorized detail request fails');
  assert(s2DetailTimeline.data.error?.includes('无权') || s2DetailTimeline.data.error?.includes('权限'),
    'Error message indicates permission denied');

  const s2ReadAttempt = await authReq(`/labs/notifications/${importNotifS1.id}/read`, s2Cookie, 'POST', {});
  assert(s2ReadAttempt.status === 403,
    `Sampler2 cannot mark sampler1's notification as read (403, got ${s2ReadAttempt.status})`);

  const r1ReadAttempt = await authReq(`/labs/notifications/${importNotifS1.id}/read`, r1Cookie, 'POST', {});
  assert(r1ReadAttempt.status === 403,
    `Receiver1 cannot mark sampler1's notification as read (403, got ${r1ReadAttempt.status})`);

  const adminReadDetail = await authReq(`/labs/notifications/${importNotifS1.id}/detail`, aCookie);
  assert(adminReadDetail.data.success === true,
    'Admin CAN access any notification detail with timeline');

  const adminMarkRead = await authReq(`/labs/notifications/${importNotifS1.id}/read`, aCookie, 'POST', {});
  assert(adminMarkRead.data.success === true,
    'Admin CAN mark any notification as read');

  // ============== Test 22: Invalid Notification ID ====
  console.log('\n=== Test 22: Invalid Notification ID Handling ===');

  const invalidDetail = await authReq('/labs/notifications/nonexistent-id-12345', s1Cookie);
  assert(invalidDetail.status === 404,
    `Invalid notification ID returns 404 for detail (got ${invalidDetail.status})`);
  assert(invalidDetail.data.success === false, 'Invalid ID request fails');

  const invalidRead = await authReq('/labs/notifications/nonexistent-id-12345/read', s1Cookie, 'POST', {});
  assert(invalidRead.status === 404,
    `Invalid notification ID returns 404 for read (got ${invalidRead.status})`);

  const invalidDetailTimeline = await authReq('/labs/notifications/nonexistent-id-12345/detail', s1Cookie);
  assert(invalidDetailTimeline.status === 404,
    `Invalid notification ID returns 404 for detail timeline (got ${invalidDetailTimeline.status})`);

  // ============== Summary ==============
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);

  if (failed > 0) {
    console.log('\n❌ Some tests failed. Please review the output above.');
    process.exit(1);
  } else {
    console.log('\n✅ All notification center tests passed!');
    console.log('\n📋 Next steps for manual verification:');
    console.log('  1. For restart persistence:');
    console.log('     - Stop the server (Ctrl+C)');
    console.log('     - Run: npm run server:dev');
    console.log('     - Run: node test-notification-restart.mjs');
    console.log('  2. For manual verification:');
    console.log('     - Login as sampler1/sampler123');
    console.log('     - Call GET /api/labs/notifications to see your notifications');
    console.log('     - Login as admin1/admin123');
    console.log('     - Call GET /api/labs/notifications to see all notifications');
    process.exit(0);
  }
}

run().catch(e => { console.error(e); process.exit(1); });
