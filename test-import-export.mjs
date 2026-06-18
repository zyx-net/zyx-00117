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

async function run() {
  console.log('\n=== Login ===');
  const sampler = await login('sampler1', 'sampler123');
  const receiver = await login('receiver1', 'receiver123');
  const admin = await login('admin1', 'admin123');
  assert(sampler.data.success === true, 'Sampler login');
  assert(receiver.data.success === true, 'Receiver login');
  assert(admin.data.success === true, 'Admin login');

  const sCookie = sampler.cookie;
  const rCookie = receiver.cookie;
  const aCookie = admin.cookie;

  console.log('\n=== Test 1: CSV successful import ===');
  const csv1 = `sampleCode,type,description,sourceLocation,minTemp,maxTemp,initialTemperature,tempLocation
CSV-${TS}-001,blood,import test 1,Building A,2,8,4.5,Freezer A
CSV-${TS}-002,urine,import test 2,Building B,2,8,3.8,Freezer B`;
  const import1 = await authReq('/labs/samples/import-csv', sCookie, 'POST', { csvContent: csv1 });
  assert(import1.status === 201, `CSV import returns 201 (got ${import1.status})`);
  assert(import1.data.success === true, 'CSV import success');
  const importedBatchId = import1.data?.data?.batch?.id;

  if (import1.data.success) {
    assert(import1.data.data.importedCount === 2, `Imported 2 samples (got ${import1.data.data.importedCount})`);
  }

  console.log('\n=== Test 2: Data visible after import ===');
  const batches1 = await authReq('/labs/batches', sCookie);
  assert(batches1.data.success === true, 'List batches success');
  const found = batches1.data.data.batches.find(b => b.id === importedBatchId);
  assert(!!found, 'Imported batch visible in list');
  if (found) assert(found.sampleCount === 2, 'Batch has 2 samples');

  const samples1 = await authReq('/labs/samples', sCookie);
  assert(samples1.data.success === true, 'List samples success');
  const csv001 = samples1.data.data.samples.find(s => s.sampleCode === `CSV-${TS}-001`);
  assert(!!csv001, 'Imported sample visible in sample list');
  if (csv001) {
    assert(csv001.status === 'REGISTERED', 'Imported sample status = REGISTERED');
    assert(csv001.temperatureRecords.length > 0, 'Sample has temperature records');
    assert(csv001.handoverChain.length > 0, 'Sample has handover chain');
  }

  console.log('\n=== Test 3: Duplicate sample code conflict ===');
  const csv2 = `sampleCode,type,description,sourceLocation,minTemp,maxTemp,initialTemperature,tempLocation
CSV-${TS}-001,blood,duplicate,Building A,2,8,4.5,Freezer A`;
  const import2 = await authReq('/labs/samples/import-csv', sCookie, 'POST', { csvContent: csv2 });
  assert(import2.status === 400, 'Duplicate import returns 400');
  assert(import2.data.success === false, 'Duplicate import fails');
  assert(import2.data.errors && import2.data.errors.length > 0, 'Error list returned');
  assert(import2.data.errors.some(e => e.field === 'sampleCode' && e.reason.includes('\u5DF2\u5B58\u5728')), 'Error says sample code exists');

  console.log('\n=== Test 4: Internal duplicate in CSV ===');
  const csv3 = `sampleCode,type,description,sourceLocation,minTemp,maxTemp,initialTemperature,tempLocation
CSV-${TS}-DUP,blood,internal dup 1,Building A,2,8,4.5,Freezer A
CSV-${TS}-DUP,urine,internal dup 2,Building B,2,8,3.8,Freezer B`;
  const import3 = await authReq('/labs/samples/import-csv', sCookie, 'POST', { csvContent: csv3 });
  assert(import3.status === 400, 'Internal duplicate returns 400');
  assert(import3.data.errors && import3.data.errors.some(e => e.reason.includes('\u91CD\u590D')), 'Error mentions duplicate');

  console.log('\n=== Test 5: No permission import ===');
  const import4 = await authReq('/labs/samples/import-csv', rCookie, 'POST', { csvContent: csv1 });
  assert(import4.status === 403, 'Receiver import returns 403');

  console.log('\n=== Test 6: Field validation ===');
  const csvBadField = `sampleCode,type,description,sourceLocation,minTemp,maxTemp,initialTemperature,tempLocation
,blood,empty code,Building A,2,8,4.5,Freezer A
CSV-${TS}-BAD,,empty type,Building A,2,8,4.5,Freezer A
CSV-${TS}-TEMP,blood,bad temp,Building A,abc,8,4.5,Freezer A
CSV-${TS}-RANGE,blood,bad range,Building A,8,2,4.5,Freezer A`;
  const import5 = await authReq('/labs/samples/import-csv', sCookie, 'POST', { csvContent: csvBadField });
  assert(import5.status === 400, 'Field validation fails with 400');
  assert(import5.data.errors && import5.data.errors.length >= 3, `At least 3 field errors (got ${import5.data.errors?.length})`);

  const csvBadReceiver = `sampleCode,type,description,sourceLocation,minTemp,maxTemp,initialTemperature,tempLocation,intendedReceiverUsername
CSV-${TS}-RECV,blood,bad receiver,Building A,2,8,4.5,Freezer A,nonexistentuser`;
  const import6 = await authReq('/labs/samples/import-csv', sCookie, 'POST', { csvContent: csvBadReceiver });
  assert(import6.status === 400, 'Non-existent receiver returns 400');

  console.log('\n=== Test 7: Export config CRUD ===');
  const createConf = await authReq('/labs/export-configs', sCookie, 'POST', {
    name: 'Test batch export',
    type: 'batches',
    includeSignoffHistory: true,
    includeTempAlerts: true,
    includeFailureAudit: false,
    filters: {},
  });
  assert(createConf.status === 201, 'Create export config returns 201');
  assert(createConf.data.success === true, 'Create export config success');
  const configId = createConf.data?.data?.config?.id;

  const listConf = await authReq('/labs/export-configs?type=batches', sCookie);
  assert(listConf.data.success === true, 'List export configs success');
  assert(listConf.data.data.configs.length > 0, 'At least 1 export config');

  const updateConf = await authReq(`/labs/export-configs/${configId}`, sCookie, 'PUT', {
    name: 'Updated batch export',
    includeFailureAudit: true,
  });
  assert(updateConf.data.success === true, 'Update export config success');
  assert(updateConf.data.data.config.name === 'Updated batch export', 'Config name updated');

  console.log('\n=== Test 8: Export with config ===');
  const exportUrl = `${BASE}/admin/export/batches?configId=${configId}`;
  const exportRes = await fetch(exportUrl, { headers: { Cookie: sCookie } });
  const exportText = await exportRes.text();
  assert(exportRes.status === 200, 'Configured export returns 200');
  assert(exportText.includes('\u6279\u6B21\u5217\u8868'), 'Export includes batch list');
  assert(exportText.includes('\u6837\u672C\u660E\u7EC6'), 'Export includes sample details');
  assert(exportText.includes('\u6E29\u63A7\u8BB0\u5F55'), 'Export includes temp records (config)');
  assert(exportText.includes('\u4EA4\u63A5\u94FE\u5386\u53F2'), 'Export includes signoff history (config)');
  assert(exportText.includes('\u5931\u8D25\u5BA1\u8BA1\u8BB0\u5F55'), 'Export includes failure audit (config)');
  assert(exportText.includes('Updated batch export'), 'Export header includes config name');

  console.log('\n=== Test 9: Operation audit logs ===');
  const audits = await authReq('/admin/audits?action=CSV_IMPORT', aCookie);
  assert(audits.data.success === true, 'Query audit logs success');
  const importAudits = audits.data.data.audits.filter(a => a.action === 'CSV_IMPORT');
  assert(importAudits.length > 0, 'CSV_IMPORT audit records exist');
  const failedImport = importAudits.find(a => !a.success);
  assert(!!failedImport, 'Failed import has audit record');

  const configAudits = await authReq('/admin/audits?action=CREATE_EXPORT_CONFIG', aCookie);
  assert(configAudits.data.data.audits.length > 0, 'Create export config audit record exists');

  const exportAudits = await authReq('/admin/audits?action=EXPORT_BATCHES', aCookie);
  assert(exportAudits.data.data.audits.length > 0, 'Actual export audit record exists');

  console.log('\n=== Test 10: Delete export config ===');
  const delConf = await authReq(`/labs/export-configs/${configId}`, sCookie, 'DELETE');
  assert(delConf.data.success === true, 'Delete export config success');

  const listConf2 = await authReq('/labs/export-configs?type=batches', sCookie);
  const found2 = listConf2.data.data.configs.find(c => c.id === configId);
  assert(!found2, 'Config no longer exists after delete');

  console.log('\n=== Restart verification (manual) ===');
  console.log('  To verify restart persistence:');
  console.log('  1. Stop the server (Ctrl+C)');
  console.log('  2. Run: npm run server:dev');
  console.log(`  3. Check: imported batches CSV-${TS}-001/CSV-${TS}-002 still visible`);
  console.log('  4. Check: sample status still REGISTERED, handover chain intact');
  console.log('  5. Check: temperature records and alerts preserved');
  console.log('  6. Check: audit logs contain CSV_IMPORT records');

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
