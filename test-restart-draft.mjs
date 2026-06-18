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
  console.log('\n=== Post-restart Draft & Template Verification ===');
  console.log('  This test verifies data persistence after server restart.\n');

  const admin = await login('admin1', 'admin123');
  const sampler1 = await login('sampler1', 'sampler123');
  const aCookie = admin.cookie;
  const s1Cookie = sampler1.cookie;

  console.log('\n--- Templates after restart ---');
  const templates = await authReq('/labs/templates?includeInactive=true', aCookie);
  assert(templates.data.success === true, 'List templates after restart');
  const tplCount = templates.data.data.templates.length;
  console.log(`  Found ${tplCount} templates`);
  assert(tplCount >= 1, 'Templates persisted after restart');

  const activeTemplates = templates.data.data.templates.filter(t => t.isActive);
  const inactiveTemplates = templates.data.data.templates.filter(t => !t.isActive);
  console.log(`  Active: ${activeTemplates.length}, Inactive: ${inactiveTemplates.length}`);

  const firstTpl = templates.data.data.templates[0];
  if (firstTpl) {
    assert(firstTpl.version >= 1, 'Template version preserved');
    assert(firstTpl.referencedCount >= 0, 'Template referencedCount preserved');
    assert(typeof firstTpl.createdAt === 'number', 'Template createdAt preserved');
    console.log(`  Template "${firstTpl.name}": v${firstTpl.version}, referenced ${firstTpl.referencedCount}x`);
  }

  console.log('\n--- Drafts after restart ---');
  const drafts = await authReq('/labs/drafts', s1Cookie);
  assert(drafts.data.success === true, 'List drafts after restart');
  const draftCount = drafts.data.data.drafts.length;
  console.log(`  Found ${draftCount} drafts`);

  const importedDrafts = drafts.data.data.drafts.filter(d => d.status === 'IMPORTED');
  const cancelledDrafts = drafts.data.data.drafts.filter(d => d.status === 'CANCELLED');
  const draftDrafts = drafts.data.data.drafts.filter(d => d.status === 'DRAFT');
  console.log(`  Imported: ${importedDrafts.length}, Cancelled: ${cancelledDrafts.length}, Draft: ${draftDrafts.length}`);

  if (drafts.data.data.drafts.length > 0) {
    const firstDraft = drafts.data.data.drafts[0];
    assert(firstDraft.version >= 1, 'Draft version preserved');
    assert(firstDraft.csvContent?.length > 0, 'Draft CSV content preserved');
    assert(typeof firstDraft.createdAt === 'number', 'Draft createdAt preserved');
    assert(typeof firstDraft.lastEditedAt === 'number', 'Draft lastEditedAt preserved');
    assert(firstDraft.lastEditedByName?.length > 0, 'Draft last editor preserved');
    console.log(`  Draft "${firstDraft.name}": v${firstDraft.version}, status=${firstDraft.status}, edited by ${firstDraft.lastEditedByName}`);

    if (firstDraft.templateSnapshot) {
      assert(firstDraft.templateSnapshot.templateId?.length > 0, 'Draft templateSnapshot.templateId preserved');
      assert(firstDraft.templateSnapshot.name?.length > 0, 'Draft templateSnapshot.name preserved');
      console.log(`  → Uses template snapshot: "${firstDraft.templateSnapshot.name}" v${firstDraft.templateSnapshot.templateVersion}`);
    }

    const draftDetail = await authReq(`/labs/drafts/${firstDraft.id}`, s1Cookie);
    assert(draftDetail.data.success === true, 'Get draft detail after restart');
    assert(draftDetail.data.data.draft.csvContent === firstDraft.csvContent, 'Draft CSV content matches in detail');
  }

  console.log('\n--- Undo records after restart ---');
  const undoRecords = await authReq('/labs/import-undo', aCookie);
  assert(undoRecords.data.success === true, 'List undo records after restart');
  const undoCount = undoRecords.data.data.records.length;
  console.log(`  Found ${undoCount} undo records`);

  const undoneRecords = undoRecords.data.data.records.filter(r => r.undone);
  const pendingRecords = undoRecords.data.data.records.filter(r => !r.undone);
  console.log(`  Undone: ${undoneRecords.length}, Pending: ${pendingRecords.length}`);

  if (undoRecords.data.data.records.length > 0) {
    const firstUndo = undoRecords.data.data.records[0];
    assert(firstUndo.batchCode?.length > 0, 'Undo record batchCode preserved');
    assert(firstUndo.sampleIds?.length > 0, 'Undo record sampleIds preserved');
    assert(firstUndo.creatorName?.length > 0, 'Undo record creatorName preserved');
    console.log(`  Undo record: ${firstUndo.batchCode}, ${firstUndo.sampleIds.length} samples, by ${firstUndo.creatorName}`);
    if (firstUndo.undone) {
      assert(firstUndo.undoneByName?.length > 0, 'Undone record undoneByName preserved');
      console.log(`  → Undone by ${firstUndo.undoneByName} at ${new Date(firstUndo.undoneAt).toLocaleString()}`);
    }
  }

  console.log('\n--- Batches with template snapshots after restart ---');
  const batches = await authReq('/labs/batches', aCookie);
  assert(batches.data.success === true, 'List batches after restart');

  const batchesWithSnapshot = batches.data.data.batches.filter(b => b.templateSnapshot);
  console.log(`  Found ${batchesWithSnapshot.length} batches with template snapshots`);

  for (const b of batchesWithSnapshot) {
    assert(b.templateSnapshot.templateId?.length > 0, `Batch ${b.batchCode} snapshot templateId preserved`);
    assert(b.templateSnapshot.name?.length > 0, `Batch ${b.batchCode} snapshot name preserved`);
    assert(b.templateSnapshot.defaultMinTemp < b.templateSnapshot.defaultMaxTemp, `Batch ${b.batchCode} snapshot temp range valid`);
    console.log(`  Batch ${b.batchCode}: uses snapshot "${b.templateSnapshot.name}" v${b.templateSnapshot.templateVersion}`);
    console.log(`    → Receiver: ${b.templateSnapshot.intendedReceiverName}, Temp: ${b.templateSnapshot.defaultMinTemp}-${b.templateSnapshot.defaultMaxTemp}℃`);
  }

  console.log('\n--- Audit logs for new actions after restart ---');
  const templateAudits = await authReq('/admin/audits?action=CREATE_TEMPLATE', aCookie);
  assert(templateAudits.data.success === true, 'Query CREATE_TEMPLATE audits after restart');
  assert(templateAudits.data.data.audits.length > 0, 'CREATE_TEMPLATE audit records preserved');

  const draftAudits = await authReq('/admin/audits?action=CREATE_DRAFT', aCookie);
  assert(draftAudits.data.success === true, 'Query CREATE_DRAFT audits after restart');
  assert(draftAudits.data.data.audits.length > 0, 'CREATE_DRAFT audit records preserved');

  const undoAudits = await authReq('/admin/audits?action=UNDO_IMPORT', aCookie);
  assert(undoAudits.data.success === true, 'Query UNDO_IMPORT audits after restart');

  const conflictAudits = await authReq('/admin/audits?action=DRAFT_CONFLICT_BLOCKED', aCookie);
  assert(conflictAudits.data.success === true, 'Query DRAFT_CONFLICT_BLOCKED audits after restart');

  const applyTplAudits = await authReq('/admin/audits?action=APPLY_TEMPLATE', aCookie);
  assert(applyTplAudits.data.success === true, 'Query APPLY_TEMPLATE audits after restart');
  assert(applyTplAudits.data.data.audits.length > 0, 'APPLY_TEMPLATE audit records preserved');

  const cancelDraftAudits = await authReq('/admin/audits?action=CANCEL_DRAFT', aCookie);
  assert(cancelDraftAudits.data.success === true, 'Query CANCEL_DRAFT audits after restart');

  const undoRevertDraftAudits = await authReq('/admin/audits?action=UNDO_REVERT_DRAFT', aCookie);
  assert(undoRevertDraftAudits.data.success === true, 'Query UNDO_REVERT_DRAFT audits after restart');

  const undoCleanupAudits = await authReq('/admin/audits?action=UNDO_CLEANUP_EXPORT_CONFIGS', aCookie);
  assert(undoCleanupAudits.data.success === true, 'Query UNDO_CLEANUP_EXPORT_CONFIGS audits after restart');

  console.log('\n--- Data consistency checks ---');
  for (const tpl of templates.data.data.templates) {
    const referencingBatches = batches.data.data.batches.filter(b => b.templateId === tpl.id);
    console.log(`  Template "${tpl.name}" (v${tpl.version}): referencedCount=${tpl.referencedCount}, actual refs=${referencingBatches.length}`);
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);

  if (failed > 0) {
    console.log('\n❌ Some post-restart verification tests failed!');
    process.exit(1);
  } else {
    console.log('\n✅ All post-restart verification tests passed!');
    console.log('  Templates, drafts, undo records, snapshots, and audit logs all persisted correctly.');
    process.exit(0);
  }
}

run().catch(e => { console.error(e); process.exit(1); });
