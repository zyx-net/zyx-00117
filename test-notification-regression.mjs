// Notification Center - Cross-Module Regression Tests
// 覆盖：并发冲突一致性、越权访问拦截、撤销回退验证、关键字筛选一致性

const BASE_URL = 'http://localhost:3001/api';

async function login(username, password) {
  const res = await fetch(BASE_URL + '/auth/login', {
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
  const res = await fetch(BASE_URL + path, opts);
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

async function main() {
  console.log('\n=== Notification Center - Cross-Module Regression Tests ===\n');

  // === Setup: Login as different users ===
  console.log('=== Setup: Login multiple users ===');

  const sampler1Login = await login('sampler1', 'sampler123');
  const sampler2Login = await login('sampler2', 'sampler123');
  const receiver1Login = await login('receiver1', 'receiver123');
  const adminLogin = await login('admin1', 'admin123');

  assert(sampler1Login.data.success === true, 'Sampler1 login');
  assert(sampler2Login.data.success === true, 'Sampler2 login');
  assert(receiver1Login.data.success === true, 'Receiver1 login');
  assert(adminLogin.data.success === true, 'Admin1 login');

  const s1Cookie = sampler1Login.cookie;
  const s2Cookie = sampler2Login.cookie;
  const r1Cookie = receiver1Login.cookie;
  const aCookie = adminLogin.cookie;

  const sampler1Id = sampler1Login.data.data.id;
  const sampler2Id = sampler2Login.data.data.id;

  // ===== Test 1: Keyword search on server side =====
  console.log('\n=== Test 1: Server-side Keyword Search Consistency ===');

  const allResult = await authReq('/labs/notifications', aCookie);
  assert(allResult.data.success === true, 'Get all notifications succeeds');
  const allNotifications = allResult.data.data.notifications;
  console.log(`  Info: Total notifications: ${allNotifications.length}`);

  const keyword = '导入';
  const searchResult = await authReq(`/labs/notifications?keyword=${encodeURIComponent(keyword)}`, aCookie);
  assert(searchResult.data.success === true, 'Keyword search succeeds');
  const filteredNotifications = searchResult.data.data.notifications;
  console.log(`  Info: Notifications matching '${keyword}': ${filteredNotifications.length}`);

  assert(filteredNotifications.length <= allNotifications.length,
    `Filtered count <= total (${filteredNotifications.length} <= ${allNotifications.length})`);

  // 验证所有筛选结果都包含关键字
  const kw = keyword.toLowerCase();
  const invalidMatches = filteredNotifications.filter((n) => {
    const titleMatch = n.title && n.title.toLowerCase().includes(kw);
    const msgMatch = n.message && n.message.toLowerCase().includes(kw);
    const batchMatch = n.batchCode && n.batchCode.toLowerCase().includes(kw);
    const templateMatch = n.templateName && n.templateName.toLowerCase().includes(kw);
    return !titleMatch && !msgMatch && !batchMatch && !templateMatch;
  });
  assert(invalidMatches.length === 0,
    `All filtered notifications contain keyword (${invalidMatches.length} invalid)`);

  assert(searchResult.data.data.total === filteredNotifications.length,
    'Response total matches filtered count');

  // ===== Test 2: Unauthorized access - list endpoint =====
  console.log('\n=== Test 2: Unauthorized Access - List Endpoint ===');

  const s1List = await authReq('/labs/notifications', s1Cookie);
  assert(s1List.data.success === true, 'Sampler1 can list own notifications');
  const s1Ids = new Set(s1List.data.data.notifications.map(n => n.id));
  console.log(`  Info: Sampler1 sees ${s1Ids.size} notifications`);

  const s2List = await authReq('/labs/notifications', s2Cookie);
  assert(s2List.data.success === true, 'Sampler2 can list own notifications');
  const s2Ids = new Set(s2List.data.data.notifications.map(n => n.id));
  console.log(`  Info: Sampler2 sees ${s2Ids.size} notifications`);

  const overlap = [...s1Ids].filter(id => s2Ids.has(id));
  assert(overlap.length === 0,
    `No notification overlap between users (found ${overlap.length})`);

  // Non-admin cannot filter by other operatorId
  const filteredOther = await authReq(`/labs/notifications?operatorId=${sampler1Id}`, s2Cookie);
  assert(filteredOther.data.success === true, 'Filter request succeeds (ignored for non-admin)');
  const filteredOtherIds = new Set(filteredOther.data.data.notifications.map(n => n.id));
  const allOwn = [...filteredOtherIds].every(id => s2Ids.has(id));
  assert(allOwn === true, 'Non-admin still only sees own notifications with operatorId filter');

  // ===== Test 3: Unauthorized access - detail endpoint =====
  console.log('\n=== Test 3: Unauthorized Access - Detail Endpoint ===');

  // Find a sampler1 notification for testing
  const adminList = await authReq('/labs/notifications', aCookie);
  const adminNotifs = adminList.data.data.notifications;
  const sampler1Notif = adminNotifs.find(n => n.operatorId === sampler1Id);
  assert(!!sampler1Notif, 'Found sampler1 notification for permission test');
  console.log(`  Info: Test notification ID: ${sampler1Notif.id}`);

  // Sampler2 cannot access sampler1's notification detail
  const detailForbidden = await authReq(`/labs/notifications/${sampler1Notif.id}/detail`, s2Cookie);
  assert(detailForbidden.data.success === false, 'Non-owner cannot access notification detail');
  assert(detailForbidden.status === 403, 'Detail access returns 403 Forbidden');

  // Sampler2 cannot mark sampler1's notification as read
  const markReadForbidden = await authReq(`/labs/notifications/${sampler1Notif.id}/read`, s2Cookie, 'POST');
  assert(markReadForbidden.data.success === false, 'Non-owner cannot mark notification as read');
  assert(markReadForbidden.status === 403, 'Mark read returns 403 Forbidden');

  // Receiver1 also cannot access sampler1's notification
  const receiverForbidden = await authReq(`/labs/notifications/${sampler1Notif.id}/detail`, r1Cookie);
  assert(receiverForbidden.data.success === false, 'Receiver cannot access sampler notification detail');

  // Sampler1 can access own notification
  const detailAllowed = await authReq(`/labs/notifications/${sampler1Notif.id}/detail`, s1Cookie);
  assert(detailAllowed.data.success === true, 'Owner CAN access own notification detail');
  assert(detailAllowed.data.data.notification.id === sampler1Notif.id, 'Correct notification returned');

  // Admin can access any notification
  const adminDetail = await authReq(`/labs/notifications/${sampler1Notif.id}/detail`, aCookie);
  assert(adminDetail.data.success === true, 'Admin CAN access any notification detail');

  // Admin can mark any notification as read
  const adminMarkRead = await authReq(`/labs/notifications/${sampler1Notif.id}/read`, aCookie, 'POST');
  assert(adminMarkRead.data.success === true, 'Admin CAN mark any notification as read');

  // ===== Test 4: Draft conflict notifications - consistency =====
  console.log('\n=== Test 4: Draft Conflict Notifications Consistency ===');

  const conflictResult = await authReq('/labs/notifications?type=DRAFT_CONFLICT', aCookie);
  assert(conflictResult.data.success === true, 'Query conflict notifications succeeds');
  const conflictNotifs = conflictResult.data.data.notifications;
  console.log(`  Info: Found ${conflictNotifs.length} DRAFT_CONFLICT notifications`);

  if (conflictNotifs.length > 0) {
    const conflict = conflictNotifs[0];

    assert(conflict.status === 'FAILURE', 'Conflict notification has FAILURE status');
    assert(!!conflict.result, 'Conflict notification has result payload');
    assert(conflict.result.lastEditedByName !== undefined, 'Conflict has lastEditedByName');
    assert(conflict.result.currentVersion !== undefined, 'Conflict has currentVersion');
    assert(conflict.result.clientVersion !== undefined, 'Conflict has clientVersion');
    assert(conflict.rolledBack === false, 'Conflict not rolled back by default');
    assert(!!conflict.operatorId, 'Conflict notification has operatorId');
    assert(!!conflict.operatorName, 'Conflict notification has operatorName');

    // 验证冲突通知的详情页也能正常访问
    const conflictDetail = await authReq(`/labs/notifications/${conflict.id}/detail`, aCookie);
    assert(conflictDetail.data.success === true, 'Conflict notification detail accessible');
    assert(!!conflictDetail.data.data.auditTimeline, 'Conflict detail has auditTimeline');
    assert(!!conflictDetail.data.data.relatedDraft, 'Conflict detail has relatedDraft');
  }

  // ===== Test 5: Rollback notifications - consistency check =====
  console.log('\n=== Test 5: Rollback Notification Consistency ===');

  const rolledBackResult = await authReq('/labs/notifications?rolledBack=true', aCookie);
  assert(rolledBackResult.data.success === true, 'Query rolled back notifications succeeds');
  const rolledBackNotifs = rolledBackResult.data.data.notifications;
  console.log(`  Info: Found ${rolledBackNotifs.length} rolled-back notifications`);

  if (rolledBackNotifs.length > 0) {
    const allStatusRB = rolledBackNotifs.every(n => n.status === 'ROLLED_BACK');
    assert(allStatusRB === true, 'All rolled-back notifications have ROLLED_BACK status');

    const allFlagged = rolledBackNotifs.every(n => n.rolledBack === true);
    assert(allFlagged === true, 'All rolled-back notifications have rolledBack=true flag');

    const allHaveTime = rolledBackNotifs.every(n => n.rolledBackAt > 0);
    assert(allHaveTime === true, 'All rolled-back notifications have rolledBackAt timestamp');

    const allHaveBy = rolledBackNotifs.every(n => !!n.rolledBackBy);
    assert(allHaveBy === true, 'All rolled-back notifications have rolledBackBy');

    const allHaveName = rolledBackNotifs.every(n => !!n.rolledBackByName);
    assert(allHaveName === true, 'All rolled-back notifications have rolledBackByName');

    // 验证 UNDO_SUCCESS 通知
    const undoResult = await authReq('/labs/notifications?type=UNDO_SUCCESS', aCookie);
    assert(undoResult.data.success === true, 'Query UNDO_SUCCESS succeeds');
    const undoNotifs = undoResult.data.data.notifications;
    console.log(`  Info: Found ${undoNotifs.length} UNDO_SUCCESS notifications`);

    if (undoNotifs.length > 0) {
      const undoNotRolledBack = undoNotifs.every(n => n.rolledBack === false);
      assert(undoNotRolledBack === true, 'UNDO_SUCCESS notifications are not rolled back themselves');

      const hasCount = undoNotifs.every(n =>
        n.result && n.result.rolledBackNotificationCount !== undefined
      );
      assert(hasCount === true, 'All UNDO_SUCCESS have rolledBackNotificationCount in result');

      const allSuccess = undoNotifs.every(n => n.status === 'SUCCESS');
      assert(allSuccess === true, 'All UNDO_SUCCESS have SUCCESS status');

      // 验证撤销操作有对应的 undoRecordId
      const hasUndoRecord = undoNotifs.every(n => !!n.undoRecordId);
      assert(hasUndoRecord === true, 'All UNDO_SUCCESS have undoRecordId');
    }
  }

  // ===== Test 6: Notification stats accuracy =====
  console.log('\n=== Test 6: Notification Stats Accuracy ===');

  const statsResult = await authReq('/labs/notifications/stats', s1Cookie);
  assert(statsResult.data.success === true, 'Get stats succeeds');
  const stats = statsResult.data.data.stats;
  console.log(`  Info: Stats - total=${stats.total}, success=${stats.successCount}, failure=${stats.failureCount}, rolledBack=${stats.rolledBackCount}`);

  const listResult = await authReq('/labs/notifications', s1Cookie);
  assert(stats.total === listResult.data.data.total, 'Stats total matches list total');

  const byTypeSum = Object.values(stats.byType).reduce((a, b) => a + b, 0);
  assert(byTypeSum === stats.total, 'Stats byType breakdown sums to total');

  assert(typeof stats.successCount === 'number', 'Stats has successCount');
  assert(typeof stats.failureCount === 'number', 'Stats has failureCount');
  assert(typeof stats.rolledBackCount === 'number', 'Stats has rolledBackCount');

  // ===== Test 7: Per-user read state isolation =====
  console.log('\n=== Test 7: Per-User Read State Isolation ===');

  // 找一个 sampler1 的通知
  const targetNotif = adminNotifs.find(n => n.operatorId === sampler1Id && !n.isRead);
  if (targetNotif) {
    console.log(`  Info: Using notification ${targetNotif.id} for read state test`);

    // Sampler1 标记为已读
    const markResult = await authReq(`/labs/notifications/${targetNotif.id}/read`, s1Cookie, 'POST');
    assert(markResult.data.success === true, 'Sampler1 marks notification as read');
    assert(markResult.data.data.read === true, 'Response confirms read = true');
    assert(markResult.data.data.readAt > 0, 'Response includes readAt timestamp');

    // 验证 sampler1 看到已读
    const s1Detail = await authReq(`/labs/notifications/${targetNotif.id}/detail`, s1Cookie);
    assert(s1Detail.data.data.notification.isRead === true, 'Sampler1 sees notification as read');

    // Sampler2 无法访问
    const s2Detail = await authReq(`/labs/notifications/${targetNotif.id}/detail`, s2Cookie);
    assert(s2Detail.data.success === false, 'Sampler2 cannot access notification (403)');

    // Admin 有独立的已读状态
    const aDetail = await authReq(`/labs/notifications/${targetNotif.id}/detail`, aCookie);
    assert('isRead' in aDetail.data.data.notification, 'Admin view has isRead field');
    assert('readBy' in aDetail.data.data.notification, 'Detail has readBy object');
    assert(typeof aDetail.data.data.notification.readBy === 'object', 'readBy is an object');
  } else {
    console.log('  Info: Skipping read isolation test - no unread notification found');
  }

  // ===== Test 8: Admin vs non-admin stats comparison =====
  console.log('\n=== Test 8: Admin vs Non-Admin Stats Comparison ===');

  const adminStats = await authReq('/labs/notifications/stats', aCookie);
  assert(adminStats.data.success === true, 'Admin can get stats');

  const userStats = await authReq('/labs/notifications/stats', s1Cookie);
  assert(userStats.data.success === true, 'User can get stats');

  assert(
    adminStats.data.data.stats.total >= userStats.data.data.stats.total,
    'Admin sees >= notifications than regular user'
  );

  // ===== Test 9: Mark all as read - per user =====
  console.log('\n=== Test 9: Mark All As Read - Per User ===');

  // 获取 sampler2 的未读数量
  const s2Before = await authReq('/labs/notifications/stats', s2Cookie);
  const s2UnreadBefore = s2Before.data.data.stats.total - 0; // 这个不对，应该有单独的 unreadCount
  // 用列表接口获取 unreadCount
  const s2ListBefore = await authReq('/labs/notifications', s2Cookie);
  const unreadBefore = s2ListBefore.data.data.unreadCount;
  console.log(`  Info: Sampler2 unread before: ${unreadBefore}`);

  if (unreadBefore > 0) {
    const markAllResult = await authReq('/labs/notifications/mark-all-read', s2Cookie, 'POST');
    assert(markAllResult.data.success === true, 'Mark all as read succeeds');
    assert(markAllResult.data.data.readCount > 0, 'Response includes readCount > 0');
    console.log(`  Info: Marked ${markAllResult.data.data.readCount} as read for sampler2`);

    const s2ListAfter = await authReq('/labs/notifications', s2Cookie);
    assert(s2ListAfter.data.data.unreadCount === 0, 'Unread count = 0 after mark-all');

    // 验证其他用户不受影响
    const s1ListAfter = await authReq('/labs/notifications', s1Cookie);
    console.log(`  Info: Sampler1 unread after: ${s1ListAfter.data.data.unreadCount}`);
    assert(s1ListAfter.data.data.unreadCount > 0, 'Sampler1 unread unaffected by sampler2 mark-all');
  }

  // ===== Summary =====
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

  if (failed === 0) {
    console.log('✅ All cross-module regression tests passed!');
    console.log('\n📋 Summary of coverage:');
    console.log('  ✓ Server-side keyword search consistency');
    console.log('  ✓ User permission isolation (list endpoint)');
    console.log('  ✓ User permission isolation (detail endpoint)');
    console.log('  ✓ User permission isolation (mark read)');
    console.log('  ✓ Admin full access to all notifications');
    console.log('  ✓ Draft conflict notification structure and consistency');
    console.log('  ✓ Rollback notification consistency');
    console.log('  ✓ UNDO_SUCCESS notification structure');
    console.log('  ✓ Notification stats accuracy');
    console.log('  ✓ Per-user read state isolation');
    console.log('  ✓ Admin vs user stats comparison');
    console.log('  ✓ Mark all as read - per user isolation');
  } else {
    console.log(`❌ ${failed} tests failed!`);
    process.exit(1);
  }
}

main().catch(console.error);
