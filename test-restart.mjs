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

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  OK: ${msg}`); }
  else { failed++; console.log(`  FAIL: ${msg}`); }
}

async function run() {
  console.log('\n=== Post-restart verification ===');
  const admin = await login('admin1', 'admin123');
  const aCookie = admin.cookie;

  const batches = await fetch(BASE + '/labs/batches', {
    headers: { Cookie: aCookie },
  }).then(r => r.json());
  assert(batches.success === true, 'List batches after restart');
  const csvBatches = batches.data.batches.filter(b => b.batchCode?.includes('CSV') || b.sampleCount >= 2);
  assert(csvBatches.length > 0, 'CSV imported batches still visible after restart');

  const samples = await fetch(BASE + '/labs/samples', {
    headers: { Cookie: aCookie },
  }).then(r => r.json());
  assert(samples.success === true, 'List samples after restart');
  const csvSamples = samples.data.samples.filter(s => s.sampleCode?.startsWith('CSV-'));
  assert(csvSamples.length > 0, 'CSV imported samples still visible after restart');
  
  const firstSample = csvSamples[0];
  if (firstSample) {
    assert(firstSample.status === 'REGISTERED', 'Sample status preserved = REGISTERED');
    assert(firstSample.temperatureRecords.length > 0, 'Temperature records preserved');
    assert(firstSample.handoverChain.length > 0, 'Handover chain preserved');
  }

  const audits = await fetch(BASE + '/admin/audits?action=CSV_IMPORT', {
    headers: { Cookie: aCookie },
  }).then(r => r.json());
  assert(audits.success === true, 'Query audit logs after restart');
  const importAudits = audits.data.audits.filter(a => a.action === 'CSV_IMPORT');
  assert(importAudits.length > 0, 'CSV_IMPORT audit records preserved after restart');

  const tempAlertSamples = csvSamples.filter(s => s.temperatureAlerts && s.temperatureAlerts.length > 0);
  console.log(`  Note: ${tempAlertSamples.length} samples with temperature alerts`);

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
