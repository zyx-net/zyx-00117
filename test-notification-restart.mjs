const BASE = 'http://localhost:3001/api';

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

async function run() {
  console.log('\n=== Notification Center - Restart Persistence Test ===');
  console.log('This test verifies notifications survive server restart.');
  console.log('Run test-notification-center.mjs FIRST, then restart server, then run this.');
  console.log('');

  const sampler1 = await login('sampler1', 'sampler123');
  const admin1 = await login('admin1', 'admin123');
  assert(sampler1.data.success === true, 'Sampler1 login');
  assert(admin1.data.success === true, 'Admin1 login');

  const s1Cookie = sampler1.cookie;
  const aCookie = admin1.cookie;

  // ============== Test 1: Notifications Exist After Restart ====
  console.log('\n=== Test 1: Notifications Persist After Restart ===');

  const s1Notifs = await authReq('/labs/notifications', s1Cookie);
  assert(s1Notifs.data.success === true, 'Sampler1 can list notifications after restart');
  assert(s1Notifs.data.data.total > 0, `Sampler1 has ${s1Notifs.data.data.total} notifications (not zero)`);
  console.log(`  Info: Sampler1 has ${s1Notifs.data.data.total} notifications`);

  const types = new Set(s1Notifs.data.data.notifications.map(n => n.type));
  console.log(`  Info: Notification types present: ${[...types].join(', ')}`);

  // ============== Test 2: Notification Data Integrity ====
  console.log('\n=== Test 2: Notification Data Integrity ===');

  for (const n of s1Notifs.data.data.notifications.slice(0, 5)) {
    assert(!!n.id, `Notification ${n.type} has id`);
    assert(!!n.type, `Notification has type`);
    assert(!!n.title, `Notification ${n.id} has title`);
    assert(!!n.message, `Notification ${n.id} has message`);
    assert(!!n.operatorId, `Notification ${n.id} has operatorId`);
    assert(!!n.operatorName, `Notification ${n.id} has operatorName`);
    assert(n.status === 'SUCCESS' || n.status === 'FAILURE' || n.status === 'ROLLED_BACK' || n.status === 'PENDING',
      `Notification ${n.id} has valid status: ${n.status}`);
    assert(typeof n.rolledBack === 'boolean', `Notification ${n.id} has rolledBack flag`);
    assert(n.createdAt > 0, `Notification ${n.id} has valid createdAt timestamp`);
    assert(n.updatedAt > 0, `Notification ${n.id} has valid updatedAt timestamp`);
  }

  // ============== Test 3: Import Success Notifications ====
  console.log('\n=== Test 3: IMPORT_SUCCESS Notifications ===');

  const importNotifs = await authReq('/labs/notifications?type=IMPORT_SUCCESS', s1Cookie);
  assert(importNotifs.data.success === true, 'Can query IMPORT_SUCCESS notifications');
  if (importNotifs.data.data.notifications.length > 0) {
    const n = importNotifs.data.data.notifications[0];
    assert(!!n.batchId, 'IMPORT_SUCCESS notification has batchId');
    assert(!!n.batchCode, 'IMPORT_SUCCESS notification has batchCode');
    assert(!!n.result, 'IMPORT_SUCCESS notification has result data');
    assert(!!n.result.importedCount, 'IMPORT_SUCCESS notification has importedCount');
    console.log(`  Info: Sample IMPORT_SUCCESS - batchCode=${n.batchCode}, importedCount=${n.result.importedCount}`);
  } else {
    console.log('  Info: No IMPORT_SUCCESS notifications found (may need fresh test run)');
  }

  // ============== Test 4: Rolled-back Notifications After Undo ====
  console.log('\n=== Test 4: ROLLED_BACK Notifications ===');

  const rolledBackNotifs = await authReq('/labs/notifications?rolledBack=true', s1Cookie);
  assert(rolledBackNotifs.data.success === true, 'Can query rolledBack=true notifications');
  if (rolledBackNotifs.data.data.notifications.length > 0) {
    for (const n of rolledBackNotifs.data.data.notifications) {
      assert(n.rolledBack === true, `Notification ${n.id} rolledBack = true`);
      assert(n.status === 'ROLLED_BACK', `Notification ${n.id} status = ROLLED_BACK`);
      assert(!!n.rolledBackAt, `Notification ${n.id} has rolledBackAt timestamp`);
      assert(!!n.rolledBackBy, `Notification ${n.id} has rolledBackBy`);
      assert(!!n.rolledBackByName, `Notification ${n.id} has rolledBackByName`);
    }
    console.log(`  Info: ${rolledBackNotifs.data.data.notifications.length} rolled-back notifications found`);
  } else {
    console.log('  Info: No rolled-back notifications (may need fresh undo test run)');
  }

  // ============== Test 5: Undo Success Notifications ====
  console.log('\n=== Test 5: UNDO_SUCCESS Notifications ===');

  const undoNotifs = await authReq('/labs/notifications?type=UNDO_SUCCESS', s1Cookie);
  assert(undoNotifs.data.success === true, 'Can query UNDO_SUCCESS notifications');
  if (undoNotifs.data.data.notifications.length > 0) {
    const n = undoNotifs.data.data.notifications[0];
    assert(n.rolledBack === false, 'UNDO_SUCCESS notification itself is NOT rolled back');
    assert(!!n.result?.rolledBackNotificationCount, 'UNDO_SUCCESS has rolledBackNotificationCount');
    console.log(`  Info: Sample UNDO_SUCCESS - rolledBackNotificationCount=${n.result.rolledBackNotificationCount}`);
  } else {
    console.log('  Info: No UNDO_SUCCESS notifications (may need fresh undo test run)');
  }

  // ============== Test 6: Draft Notifications ====
  console.log('\n=== Test 6: Draft-Related Notifications ===');

  const draftSaveNotifs = await authReq('/labs/notifications?type=DRAFT_SAVE', s1Cookie);
  assert(draftSaveNotifs.data.success === true, 'Can query DRAFT_SAVE notifications');
  if (draftSaveNotifs.data.data.notifications.length > 0) {
    const n = draftSaveNotifs.data.data.notifications[0];
    assert(!!n.draftId, 'DRAFT_SAVE notification has draftId');
    console.log(`  Info: Sample DRAFT_SAVE - draftId=${n.draftId}, templateName=${n.templateName || 'N/A'}`);
  }

  const draftSubmitNotifs = await authReq('/labs/notifications?type=DRAFT_SUBMIT', s1Cookie);
  assert(draftSubmitNotifs.data.success === true, 'Can query DRAFT_SUBMIT notifications');
  if (draftSubmitNotifs.data.data.notifications.length > 0) {
    const n = draftSubmitNotifs.data.data.notifications[0];
    assert(!!n.draftId, 'DRAFT_SUBMIT notification has draftId');
    assert(!!n.batchId, 'DRAFT_SUBMIT notification has batchId');
  }

  // ============== Test 7: Export Notifications ====
  console.log('\n=== Test 7: EXPORT_SUCCESS Notifications ===');

  const exportNotifs = await authReq('/labs/notifications?type=EXPORT_SUCCESS', s1Cookie);
  assert(exportNotifs.data.success === true, 'Can query EXPORT_SUCCESS notifications');
  if (exportNotifs.data.data.notifications.length > 0) {
    const n = exportNotifs.data.data.notifications[0];
    assert(!!n.result?.exportType, 'EXPORT_SUCCESS has exportType in result');
    console.log(`  Info: Sample EXPORT_SUCCESS - exportType=${n.result.exportType}`);
  }

  // ============== Test 8: Notification Stats ====
  console.log('\n=== Test 8: Notification Stats ===');

  const s1Stats = await authReq('/labs/notifications/stats', s1Cookie);
  assert(s1Stats.data.success === true, 'Sampler1 can get stats');
  assert(s1Stats.data.data.stats.total === s1Notifs.data.data.total, 'Stats total matches list total');
  assert(s1Stats.data.data.stats.successCount + s1Stats.data.data.stats.failureCount + s1Stats.data.data.stats.rolledBackCount === s1Stats.data.data.stats.total,
    'Stats breakdown sums to total');
  console.log(`  Info: Stats - total=${s1Stats.data.data.stats.total}, success=${s1Stats.data.data.stats.successCount}, failure=${s1Stats.data.data.stats.failureCount}, rolledBack=${s1Stats.data.data.stats.rolledBackCount}`);
  console.log(`  Info: Stats byType: ${JSON.stringify(s1Stats.data.data.stats.byType)}`);

  // ============== Test 9: Admin Sees All Notifications ====
  console.log('\n=== Test 9: Admin Full Access ===');

  const aNotifs = await authReq('/labs/notifications', aCookie);
  assert(aNotifs.data.success === true, 'Admin can list notifications');
  assert(aNotifs.data.data.total >= s1Notifs.data.data.total, `Admin sees more notifications than sampler1 (admin=${aNotifs.data.data.total}, sampler1=${s1Notifs.data.data.total})`);
  console.log(`  Info: Admin sees ${aNotifs.data.data.total} total notifications`);

  const aStats = await authReq('/labs/notifications/stats', aCookie);
  assert(aStats.data.success === true, 'Admin can get stats');
  assert(aStats.data.data.stats.total >= s1Stats.data.data.stats.total, 'Admin stats >= sampler1 stats');

  // ============== Test 10: ROLLBACK_NOTIFICATIONS Audit Log ====
  console.log('\n=== Test 10: ROLLBACK_NOTIFICATIONS Audit Log ===');

  const rollbackAudits = await authReq('/admin/audits?action=ROLLBACK_NOTIFICATIONS', aCookie);
  assert(rollbackAudits.data.success === true, 'Admin can query ROLLBACK_NOTIFICATIONS audits');
  if (rollbackAudits.data.data.audits.length > 0) {
    const audit = rollbackAudits.data.data.audits[0];
    assert(audit.targetType === 'BATCH', 'ROLLBACK_NOTIFICATIONS audit targetType = BATCH');
    assert(audit.success === true, 'ROLLBACK_NOTIFICATIONS audit success = true');
    assert(!!audit.afterState?.rolledBackCount, 'Audit has rolledBackCount in afterState');
    console.log(`  Info: ROLLBACK_NOTIFICATIONS audit - rolledBackCount=${audit.afterState.rolledBackCount}`);
  } else {
    console.log('  Info: No ROLLBACK_NOTIFICATIONS audit entries (may need fresh undo test run)');
  }

  // ============== Test 11: Conflict Notifications ====
  console.log('\n=== Test 11: DRAFT_CONFLICT Notifications ===');

  const conflictNotifs = await authReq('/labs/notifications?type=DRAFT_CONFLICT', s1Cookie);
  assert(conflictNotifs.data.success === true, 'Can query DRAFT_CONFLICT notifications');
  if (conflictNotifs.data.data.notifications.length > 0) {
    const n = conflictNotifs.data.data.notifications[0];
    assert(n.status === 'FAILURE', 'DRAFT_CONFLICT notification status = FAILURE');
    assert(!!n.result?.lastEditedByName, 'Conflict notif has lastEditedByName');
    console.log(`  Info: Sample DRAFT_CONFLICT - lastEditedByName=${n.result.lastEditedByName}`);
  }

  // ============== Test 12: Read/Unread State Persists After Restart ====
  console.log('\n=== Test 12: Read/Unread State Persistence ===');

  const s1NotifsCheck = await authReq('/labs/notifications', s1Cookie);
  assert(s1NotifsCheck.data.success === true, 'Can get notifications after restart');
  assert(typeof s1NotifsCheck.data.data.unreadCount === 'number', 'unreadCount is present after restart');
  console.log(`  Info: Sampler1 unreadCount after restart = ${s1NotifsCheck.data.data.unreadCount}`);

  const sampleN = s1NotifsCheck.data.data.notifications[0];
  assert(typeof sampleN.isRead === 'boolean', 'Notification has isRead field after restart');
  assert(typeof sampleN.readBy === 'object' && sampleN.readBy !== null,
    'Notification has readBy object after restart');

  const firstRead = s1NotifsCheck.data.data.notifications.find(n => n.isRead === true);
  if (firstRead) {
    const readByMe = firstRead.readBy[sampler1.data.data.id];
    assert(!!readByMe, 'Read notification has entry in readBy for user');
    assert(!!readByMe.readAt, 'Read entry has readAt timestamp');
    assert(readByMe.readAt > 0, 'readAt is valid timestamp');
    console.log(`  Info: Read notification has readAt = ${new Date(readByMe.readAt).toISOString()}`);
  } else {
    console.log('  Info: No read notifications found (may need fresh mark-read test)');
  }

  // ============== Test 13: Per-User Read State Survives Restart ====
  console.log('\n=== Test 13: Per-User Read State Isolation After Restart ===');

  const aNotifsCheck = await authReq('/labs/notifications', aCookie);
  const adminUnread = aNotifsCheck.data.data.unreadCount;
  const s1Unread = s1NotifsCheck.data.data.unreadCount;
  console.log(`  Info: Admin unread=${adminUnread}, Sampler1 unread=${s1Unread}`);
  assert(typeof adminUnread === 'number', 'Admin has unread count after restart');
  assert(typeof s1Unread === 'number', 'Sampler1 has unread count after restart');

  const s1FirstNotif = s1NotifsCheck.data.data.notifications[0];
  const aFirstNotif = aNotifsCheck.data.data.notifications.find(n => n.id === s1FirstNotif.id);
  if (aFirstNotif) {
    assert(typeof aFirstNotif.isRead === 'boolean', 'Admin view of same notif has isRead flag');
    console.log(`  Info: Same notification - Sampler1.isRead=${s1FirstNotif.isRead}, Admin.isRead=${aFirstNotif.isRead}`);
  }

  // ============== Test 14: Rolled-back State Still Marked After Restart ====
  console.log('\n=== Test 14: Rolled-back Markers Survive Restart ===');

  const rolledBackCheck = await authReq('/labs/notifications?rolledBack=true', s1Cookie);
  if (rolledBackCheck.data.data.notifications.length > 0) {
    const n = rolledBackCheck.data.data.notifications[0];
    assert(n.rolledBack === true, 'Notification still rolledBack=true after restart');
    assert(n.status === 'ROLLED_BACK', 'Notification status still ROLLED_BACK after restart');
    assert(!!n.rolledBackAt, 'rolledBackAt timestamp survives restart');
    assert(!!n.rolledBackBy, 'rolledBackBy survives restart');
    assert(!!n.rolledBackByName, 'rolledBackByName survives restart');
    console.log(`  Info: Rolled-back notif - by=${n.rolledBackByName}, at=${new Date(n.rolledBackAt).toISOString()}`);
  }

  // ============== Summary ==============
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);

  if (failed > 0) {
    console.log('\n❌ Some tests failed. Notifications may not have persisted correctly.');
    process.exit(1);
  } else {
    console.log('\n✅ All notification persistence tests passed!');
    console.log('   Notifications, audit logs, rolled-back states all survive server restart.');
    process.exit(0);
  }
}

run().catch(e => { console.error(e); process.exit(1); });
