import { loadDb, saveDb, generateId } from './db.js';
import { createAudit, queryAudits } from './audit.js';
import type {
  User,
  Sample,
  Batch,
  SampleStatus,
  TemperatureRecord,
  HandoverChainLink,
  ExportConfig,
  CsvImportError,
  SampleTemplate,
  TemplateSnapshot,
  ImportDraft,
  ImportUndoRecord,
  DraftConflictInfo,
  ImportNotification,
  ImportNotificationType,
  ImportNotificationStatus,
  AuditEntry,
  NotificationEvent,
  NotificationResultPayload,
  NotificationListFilters,
  NotificationStats,
  NotificationRelatedObjects,
  NotificationDetailResponse,
} from './types.js';

const STATUS_FLOW: Record<SampleStatus, SampleStatus[]> = {
  REGISTERED: ['PENDING_HANDOVER', 'IN_TRANSIT', 'VOIDED'],
  PENDING_HANDOVER: ['IN_TRANSIT', 'VOIDED'],
  IN_TRANSIT: ['RECEIVED', 'RETURNED', 'VOIDED'],
  RECEIVED: ['VOIDED'],
  RETURNED: ['PENDING_HANDOVER', 'IN_TRANSIT', 'VOIDED'],
  VOIDED: [],
};

function checkStatusTransition(current: SampleStatus, next: SampleStatus): boolean {
  return STATUS_FLOW[current]?.includes(next) ?? false;
}

export function getUserById(id: string): User | undefined {
  const db = loadDb();
  return db.users.find((u) => u.id === id);
}

export function getUserByUsername(username: string): User | undefined {
  const db = loadDb();
  return db.users.find((u) => u.username === username.toLowerCase());
}

function addChainLink(sample: Sample, link: Omit<HandoverChainLink, 'id' | 'timestamp'>): void {
  sample.handoverChain.unshift({
    ...link,
    id: generateId('chain'),
    timestamp: Date.now(),
  });
}

function checkTemperatureIntegrity(samples: Sample[]): { valid: boolean; missingSampleIds: string[]; errors: string[] } {
  const missingSampleIds: string[] = [];
  const errors: string[] = [];
  for (const s of samples) {
    if (s.temperatureRecords.length === 0) {
      missingSampleIds.push(s.sampleCode);
      errors.push(`样本 ${s.sampleCode} 缺少温控记录`);
    }
  }
  return {
    valid: missingSampleIds.length === 0,
    missingSampleIds,
    errors,
  };
}

function checkAndGenerateTempAlerts(sample: Sample, record: TemperatureRecord) {
  let alert = null;
  if (record.temperature < sample.minTemp) {
    alert = {
      id: generateId('alert'),
      sampleId: sample.id,
      recordId: record.id,
      type: 'TOO_LOW' as const,
      threshold: sample.minTemp,
      actualValue: record.temperature,
      timestamp: Date.now(),
      resolved: false,
    };
  } else if (record.temperature > sample.maxTemp) {
    alert = {
      id: generateId('alert'),
      sampleId: sample.id,
      recordId: record.id,
      type: 'TOO_HIGH' as const,
      threshold: sample.maxTemp,
      actualValue: record.temperature,
      timestamp: Date.now(),
      resolved: false,
    };
  }
  if (alert) {
    sample.temperatureAlerts.unshift(alert);
  }
  return alert;
}

export function updateBatchStatus(db: ReturnType<typeof loadDb>, batch: Batch): void {
  const samples = db.samples.filter((s) => batch.sampleIds.includes(s.id));
  if (samples.length === 0) return;

  const statuses = new Set(samples.map((s) => s.status));
  if (statuses.has('VOIDED') && statuses.size === 1) {
    batch.status = 'VOIDED';
  } else if (statuses.has('RECEIVED') && !statuses.has('IN_TRANSIT') && !statuses.has('PENDING_HANDOVER')) {
    batch.status = 'FULLY_RECEIVED';
    batch.receivedAt = Date.now();
  } else if (statuses.has('RECEIVED')) {
    batch.status = 'PARTIAL_RECEIVED';
  } else if (statuses.has('RETURNED') && !statuses.has('IN_TRANSIT')) {
    batch.status = 'RETURNED';
  } else if (statuses.has('IN_TRANSIT')) {
    batch.status = 'IN_TRANSIT';
  } else if (statuses.has('PENDING_HANDOVER')) {
    batch.status = 'PENDING';
  }
}

export interface RegisterSampleInput {
  sampleCode: string;
  type: string;
  description: string;
  sourceLocation: string;
  minTemp: number;
  maxTemp: number;
  initialTemperature: number;
  tempLocation: string;
}

export function registerSamples(
  operator: User,
  inputs: RegisterSampleInput[],
  ip?: string,
) {
  if (operator.role !== 'SAMPLER' && operator.role !== 'ADMIN') {
    return { success: false as const, error: '只有采样员或管理员可以登记样本' };
  }
  if (inputs.length === 0) {
    return { success: false as const, error: '至少登记一个样本' };
  }
  for (const input of inputs) {
    if (!input.sampleCode?.trim()) {
      return { success: false as const, error: '样本编号不能为空' };
    }
    if (input.initialTemperature === undefined || input.initialTemperature === null || isNaN(input.initialTemperature)) {
      return { success: false as const, error: `样本 ${input.sampleCode} 初始温度值缺失，必须提供初始温控记录` };
    }
    if (input.minTemp >= input.maxTemp) {
      return { success: false as const, error: `样本 ${input.sampleCode} 温度范围设置错误` };
    }
  }
  const db = loadDb();
  for (const input of inputs) {
    if (db.samples.some((s) => s.sampleCode === input.sampleCode)) {
      return { success: false as const, error: `样本编号 ${input.sampleCode} 已存在` };
    }
  }

  const now = Date.now();
  const batchId = generateId('batch');
  const batchCode = `BATCH-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}${String(new Date().getDate()).padStart(2, '0')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

  const newSamples: Sample[] = [];

  for (const input of inputs) {
    const sampleId = generateId('sample');
    const tempRecord: TemperatureRecord = {
      id: generateId('temp'),
      sampleId,
      timestamp: now,
      temperature: input.initialTemperature,
      recordedBy: operator.id,
      location: input.tempLocation || input.sourceLocation,
      note: '登记时初始温度记录',
    };

    const sample: Sample = {
      id: sampleId,
      sampleCode: input.sampleCode,
      batchId,
      type: input.type,
      description: input.description,
      collectedAt: now,
      collectedBy: operator.id,
      collectorName: operator.name,
      sourceLocation: input.sourceLocation,
      currentHolderId: operator.id,
      currentHolderName: operator.name,
      status: 'REGISTERED',
      minTemp: input.minTemp,
      maxTemp: input.maxTemp,
      temperatureRecords: [tempRecord],
      temperatureAlerts: [],
      handoverChain: [],
      createdAt: now,
      updatedAt: now,
    };

    checkAndGenerateTempAlerts(sample, tempRecord);

    addChainLink(sample, {
      fromUserId: 'SYSTEM',
      fromUserName: '系统',
      toUserId: operator.id,
      toUserName: operator.name,
      action: 'REGISTER',
      temperatureChecks: [tempRecord.id],
    });

    newSamples.push(sample);
  }

  const batch: Batch = {
    id: batchId,
    batchCode,
    createdAt: now,
    createdBy: operator.id,
    creatorName: operator.name,
    sampleIds: newSamples.map((s) => s.id),
    status: 'DRAFT',
  };

  const samplesAfter = newSamples.map((s) => ({ id: s.id, status: s.status, holder: s.currentHolderName }));

  db.samples.push(...newSamples);
  db.batches.unshift(batch);
  saveDb(db);

  createAudit(operator, 'REGISTER_SAMPLES', 'BATCH', batchId, true, {
    beforeState: { samples: [] },
    afterState: { batchCode, samples: samplesAfter },
    ipAddress: ip,
  });

  return { success: true as const, batch, samples: newSamples };
}

export function initiateHandover(
  operator: User,
  batchId: string,
  intendedReceiverId: string,
  note?: string,
  ip?: string,
) {
  if (operator.role !== 'SAMPLER' && operator.role !== 'ADMIN') {
    return { success: false as const, error: '只有采样员或管理员可以发起交接' };
  }

  const db = loadDb();
  const batch = db.batches.find((b) => b.id === batchId);
  if (!batch) {
    return { success: false as const, error: '批次不存在' };
  }

  const samples = db.samples.filter((s) => batch.sampleIds.includes(s.id));
  if (samples.length === 0) {
    return { success: false as const, error: '批次中无样本' };
  }

  const tempCheck = checkTemperatureIntegrity(samples);
  if (!tempCheck.valid) {
    createAudit(operator, 'INITIATE_HANDOVER', 'BATCH', batchId, false, {
      failureReason: tempCheck.errors.join('; '),
      ipAddress: ip,
    });
    return { success: false as const, error: tempCheck.errors.join('; ') + '，无法发起交接' };
  }

  for (const sample of samples) {
    if (!checkStatusTransition(sample.status, 'IN_TRANSIT')) {
      createAudit(operator, 'INITIATE_HANDOVER', 'BATCH', batchId, false, {
        failureReason: `样本 ${sample.sampleCode} 当前状态 ${sample.status} 不允许发起交接`,
        ipAddress: ip,
      });
      return { success: false as const, error: `样本 ${sample.sampleCode} 当前状态不允许发起交接` };
    }
    if (sample.currentHolderId !== operator.id && operator.role !== 'ADMIN') {
      createAudit(operator, 'INITIATE_HANDOVER', 'BATCH', batchId, false, {
        failureReason: `样本 ${sample.sampleCode} 不属于当前用户，无权发起交接`,
        ipAddress: ip,
      });
      return { success: false as const, error: `样本 ${sample.sampleCode} 不属于您，无权发起交接` };
    }
  }

  const receiver = getUserById(intendedReceiverId);
  if (!receiver) {
    return { success: false as const, error: '接收人不存在' };
  }
  if (receiver.role !== 'RECEIVER' && receiver.role !== 'ADMIN') {
    return { success: false as const, error: '接收人必须是接收员角色' };
  }

  const beforeState = {
    batchStatus: batch.status,
    samples: samples.map((s) => ({ id: s.id, status: s.status })),
  };

  const now = Date.now();
  for (const sample of samples) {
    sample.status = 'IN_TRANSIT';
    sample.updatedAt = now;
    addChainLink(sample, {
      fromUserId: operator.id,
      fromUserName: operator.name,
      toUserId: receiver.id,
      toUserName: receiver.name,
      action: 'INITIATE_HANDOVER',
      note,
      temperatureChecks: sample.temperatureRecords.map((t) => t.id),
    });
  }

  batch.status = 'IN_TRANSIT';
  batch.intendedReceiverId = receiver.id;
  batch.intendedReceiverName = receiver.name;
  batch.initiatedAt = now;
  batch.note = note;
  batch.receivedBy = undefined;
  batch.receivedAt = undefined;

  saveDb(db);

  createAudit(operator, 'INITIATE_HANDOVER', 'BATCH', batchId, true, {
    beforeState,
    afterState: {
      batchStatus: batch.status,
      receiverId: receiver.id,
      samples: samples.map((s) => ({ id: s.id, status: s.status })),
    },
    ipAddress: ip,
  });

  return { success: true as const, batch };
}

export function receiveBatch(
  operator: User,
  batchId: string,
  sampleIds: string[],
  temperatureRecords: Array<{ sampleId: string; temperature: number; location: string }>,
  ip?: string,
) {
  if (operator.role !== 'RECEIVER' && operator.role !== 'ADMIN') {
    return { success: false as const, error: '只有接收员或管理员可以签收' };
  }

  const db = loadDb();
  const batch = db.batches.find((b) => b.id === batchId);
  if (!batch) {
    return { success: false as const, error: '批次不存在' };
  }

  const samples = db.samples.filter((s) => batch.sampleIds.includes(s.id));
  if (samples.length === 0) {
    return { success: false as const, error: '批次中无样本' };
  }

  const targetSamples = samples.filter((s) => sampleIds.includes(s.id));
  if (targetSamples.length !== sampleIds.length) {
    createAudit(operator, 'RECEIVE_BATCH', 'BATCH', batchId, false, {
      failureReason: '部分样本不属于此批次',
      ipAddress: ip,
    });
    return { success: false as const, error: '部分待签收样本不属于此批次' };
  }

  if (!batch.intendedReceiverId) {
    createAudit(operator, 'RECEIVE_BATCH', 'BATCH', batchId, false, {
      failureReason: '批次未发起交接',
      ipAddress: ip,
    });
    return { success: false as const, error: '批次未发起交接' };
  }

  if (batch.intendedReceiverId !== operator.id && operator.role !== 'ADMIN') {
    createAudit(operator, 'RECEIVE_BATCH', 'BATCH', batchId, false, {
      failureReason: `非指定接收人${batch.intendedReceiverName}，禁止替签`,
      ipAddress: ip,
    });
    return { success: false as const, error: `您不是该批次的指定接收人，禁止替人签收。指定接收人为：${batch.intendedReceiverName}` };
  }

  const tempMap = new Map(temperatureRecords.map((t) => [t.sampleId, t]));
  for (const sample of targetSamples) {
    if (!checkStatusTransition(sample.status, 'RECEIVED')) {
      createAudit(operator, 'RECEIVE_BATCH', 'BATCH', batchId, false, {
        failureReason: `样本 ${sample.sampleCode} 状态不允许签收`,
        ipAddress: ip,
      });
      return { success: false as const, error: `样本 ${sample.sampleCode} 当前状态不允许签收` };
    }
    if (!tempMap.has(sample.id)) {
      createAudit(operator, 'RECEIVE_BATCH', 'BATCH', batchId, false, {
        failureReason: `样本 ${sample.sampleCode} 签收时缺少温控记录`,
        ipAddress: ip,
      });
      return { success: false as const, error: `样本 ${sample.sampleCode} 签收时必须提供温度记录` };
    }
    const temp = tempMap.get(sample.id)!;
    if (temp.temperature === undefined || temp.temperature === null || isNaN(temp.temperature)) {
      createAudit(operator, 'RECEIVE_BATCH', 'BATCH', batchId, false, {
        failureReason: `样本 ${sample.sampleCode} 温度值非法`,
        ipAddress: ip,
      });
      return { success: false as const, error: `样本 ${sample.sampleCode} 温度值缺失或非法` };
    }
  }

  const beforeState = {
    batchStatus: batch.status,
    samples: targetSamples.map((s) => ({ id: s.id, status: s.status, holder: s.currentHolderName })),
  };

  const now = Date.now();
  const receivedSamples: Sample[] = [];

  for (const sample of targetSamples) {
    const temp = tempMap.get(sample.id)!;
    const tempRecord: TemperatureRecord = {
      id: generateId('temp'),
      sampleId: sample.id,
      timestamp: now,
      temperature: temp.temperature,
      recordedBy: operator.id,
      location: temp.location,
      note: '签收时温度记录',
    };
    sample.temperatureRecords.unshift(tempRecord);
    checkAndGenerateTempAlerts(sample, tempRecord);

    sample.status = 'RECEIVED';
    sample.currentHolderId = operator.id;
    sample.currentHolderName = operator.name;
    sample.updatedAt = now;

    addChainLink(sample, {
      fromUserId: batch.createdBy,
      fromUserName: batch.creatorName,
      toUserId: operator.id,
      toUserName: operator.name,
      action: 'RECEIVE',
      temperatureChecks: [tempRecord.id],
    });

    receivedSamples.push(sample);
  }

  updateBatchStatus(db, batch);
  if (!batch.receivedBy) {
    batch.receivedBy = operator.id;
  }

  saveDb(db);

  createAudit(operator, 'RECEIVE_BATCH', 'BATCH', batchId, true, {
    beforeState,
    afterState: {
      batchStatus: batch.status,
      samples: receivedSamples.map((s) => ({ id: s.id, status: s.status, holder: s.currentHolderName })),
    },
    ipAddress: ip,
  });

  return { success: true as const, batch, receivedSamples };
}

export function returnBatch(
  operator: User,
  batchId: string,
  sampleIds: string[],
  reason: string,
  temperatureRecords: Array<{ sampleId: string; temperature: number; location: string }>,
  ip?: string,
) {
  if (!reason || !reason.trim()) {
    createAudit(operator, 'RETURN_BATCH', 'BATCH', batchId || 'unknown', false, {
      failureReason: '无退回原因',
      ipAddress: ip,
    });
    return { success: false as const, error: '退回必须填写原因' };
  }

  if (operator.role !== 'RECEIVER' && operator.role !== 'ADMIN') {
    return { success: false as const, error: '只有接收员或管理员可以退回' };
  }

  const db = loadDb();
  const batch = db.batches.find((b) => b.id === batchId);
  if (!batch) {
    return { success: false as const, error: '批次不存在' };
  }

  const samples = db.samples.filter((s) => batch.sampleIds.includes(s.id));
  const targetSamples = samples.filter((s) => sampleIds.includes(s.id));
  if (targetSamples.length !== sampleIds.length) {
    return { success: false as const, error: '部分样本不属于此批次' };
  }

  const tempMap = new Map(temperatureRecords.map((t) => [t.sampleId, t]));
  for (const sample of targetSamples) {
    if (sample.status !== 'IN_TRANSIT') {
      createAudit(operator, 'RETURN_BATCH', 'BATCH', batchId, false, {
        failureReason: `样本 ${sample.sampleCode} 当前状态 ${sample.status} 不允许退回，仅 IN_TRANSIT 状态可退回`,
        ipAddress: ip,
      });
      return { success: false as const, error: `样本 ${sample.sampleCode} 当前状态不允许退回，已签收样本不可退回` };
    }
    if (sample.currentHolderId !== operator.id && batch.intendedReceiverId !== operator.id && operator.role !== 'ADMIN') {
      createAudit(operator, 'RETURN_BATCH', 'BATCH', batchId, false, {
        failureReason: `样本 ${sample.sampleCode} 不属于当前用户，且非指定接收人`,
        ipAddress: ip,
      });
      return { success: false as const, error: `样本 ${sample.sampleCode} 不属于您，且非指定接收人` };
    }
    if (!tempMap.has(sample.id)) {
      createAudit(operator, 'RETURN_BATCH', 'BATCH', batchId, false, {
        failureReason: `样本 ${sample.sampleCode} 退回时缺少温控记录`,
        ipAddress: ip,
      });
      return { success: false as const, error: `样本 ${sample.sampleCode} 退回时必须提供温度记录` };
    }
    const temp = tempMap.get(sample.id)!;
    if (temp.temperature === undefined || temp.temperature === null || isNaN(temp.temperature)) {
      createAudit(operator, 'RETURN_BATCH', 'BATCH', batchId, false, {
        failureReason: `样本 ${sample.sampleCode} 温度值非法`,
        ipAddress: ip,
      });
      return { success: false as const, error: `样本 ${sample.sampleCode} 温度值缺失或非法` };
    }
  }

  const beforeState = {
    batchStatus: batch.status,
    samples: targetSamples.map((s) => ({ id: s.id, status: s.status, holder: s.currentHolderName })),
  };

  const now = Date.now();

  for (const sample of targetSamples) {
    const temp = tempMap.get(sample.id)!;
    const tempRecord: TemperatureRecord = {
      id: generateId('temp'),
      sampleId: sample.id,
      timestamp: now,
      temperature: temp.temperature,
      recordedBy: operator.id,
      location: temp.location,
      note: '退回时温度记录',
    };
    sample.temperatureRecords.unshift(tempRecord);
    checkAndGenerateTempAlerts(sample, tempRecord);

    sample.status = 'RETURNED';
    sample.currentHolderId = sample.collectedBy;
    sample.currentHolderName = sample.collectorName;
    sample.updatedAt = now;

    addChainLink(sample, {
      fromUserId: operator.id,
      fromUserName: operator.name,
      toUserId: sample.collectedBy,
      toUserName: sample.collectorName,
      action: 'RETURN',
      returnReason: reason,
      temperatureChecks: [tempRecord.id],
    });
  }

  updateBatchStatus(db, batch);
  saveDb(db);

  createAudit(operator, 'RETURN_BATCH', 'BATCH', batchId, true, {
    beforeState,
    afterState: {
      batchStatus: batch.status,
      returnReason: reason,
      samples: targetSamples.map((s) => ({ id: s.id, status: s.status, holder: s.currentHolderName })),
    },
    ipAddress: ip,
  });

  return { success: true as const, batch };
}

export function reInitiateHandover(
  operator: User,
  batchId: string,
  sampleIds: string[],
  newReceiverId: string,
  temperatureRecords: Array<{ sampleId: string; temperature: number; location: string }>,
  note?: string,
  ip?: string,
) {
  if (operator.role !== 'SAMPLER' && operator.role !== 'ADMIN') {
    return { success: false as const, error: '只有采样员或管理员可以重新发起交接' };
  }

  const db = loadDb();
  const batch = db.batches.find((b) => b.id === batchId);
  if (!batch) {
    return { success: false as const, error: '批次不存在' };
  }

  const samples = db.samples.filter((s) => batch.sampleIds.includes(s.id));
  const targetSamples = samples.filter((s) => sampleIds.includes(s.id));
  if (targetSamples.length !== sampleIds.length) {
    return { success: false as const, error: '部分样本不属于此批次' };
  }

  const receiver = getUserById(newReceiverId);
  if (!receiver) {
    return { success: false as const, error: '接收人不存在' };
  }
  if (receiver.role !== 'RECEIVER' && receiver.role !== 'ADMIN') {
    return { success: false as const, error: '接收人必须是接收员角色' };
  }

  const tempMap = new Map(temperatureRecords.map((t) => [t.sampleId, t]));
  for (const sample of targetSamples) {
    if (sample.status !== 'RETURNED' && sample.status !== 'REGISTERED' && sample.status !== 'PENDING_HANDOVER') {
      createAudit(operator, 'RE_HANDOVER', 'BATCH', batchId, false, {
        failureReason: `样本 ${sample.sampleCode} 状态不允许重新交接`,
        ipAddress: ip,
      });
      return { success: false as const, error: `样本 ${sample.sampleCode} 当前状态不允许重新发起交接` };
    }
    if (sample.currentHolderId !== operator.id && operator.role !== 'ADMIN') {
      createAudit(operator, 'RE_HANDOVER', 'BATCH', batchId, false, {
        failureReason: `样本 ${sample.sampleCode} 不属于当前用户`,
        ipAddress: ip,
      });
      return { success: false as const, error: `样本 ${sample.sampleCode} 不属于您` };
    }
    if (!tempMap.has(sample.id)) {
      createAudit(operator, 'RE_HANDOVER', 'BATCH', batchId, false, {
        failureReason: `样本 ${sample.sampleCode} 缺少温控记录`,
        ipAddress: ip,
      });
      return { success: false as const, error: `样本 ${sample.sampleCode} 重新交接时必须提供温度记录` };
    }
    const temp = tempMap.get(sample.id)!;
    if (temp.temperature === undefined || temp.temperature === null || isNaN(temp.temperature)) {
      createAudit(operator, 'RE_HANDOVER', 'BATCH', batchId, false, {
        failureReason: `样本 ${sample.sampleCode} 温度值非法`,
        ipAddress: ip,
      });
      return { success: false as const, error: `样本 ${sample.sampleCode} 温度值缺失或非法` };
    }
  }

  const beforeState = {
    batchStatus: batch.status,
    samples: targetSamples.map((s) => ({ id: s.id, status: s.status, holder: s.currentHolderName })),
  };

  const now = Date.now();
  for (const sample of targetSamples) {
    const temp = tempMap.get(sample.id)!;
    const tempRecord: TemperatureRecord = {
      id: generateId('temp'),
      sampleId: sample.id,
      timestamp: now,
      temperature: temp.temperature,
      recordedBy: operator.id,
      location: temp.location,
      note: '重交时温度记录',
    };
    sample.temperatureRecords.unshift(tempRecord);
    checkAndGenerateTempAlerts(sample, tempRecord);

    sample.status = 'IN_TRANSIT';
    sample.updatedAt = now;

    addChainLink(sample, {
      fromUserId: operator.id,
      fromUserName: operator.name,
      toUserId: receiver.id,
      toUserName: receiver.name,
      action: 'RE_HANDOVER',
      note,
      temperatureChecks: [tempRecord.id],
    });
  }

  batch.status = 'IN_TRANSIT';
  batch.intendedReceiverId = receiver.id;
  batch.intendedReceiverName = receiver.name;
  batch.initiatedAt = now;
  batch.note = note;
  batch.receivedBy = undefined;
  batch.receivedAt = undefined;

  saveDb(db);

  createAudit(operator, 'RE_HANDOVER', 'BATCH', batchId, true, {
    beforeState,
    afterState: {
      batchStatus: batch.status,
      receiverId: receiver.id,
      samples: targetSamples.map((s) => ({ id: s.id, status: s.status, holder: s.currentHolderName })),
    },
    ipAddress: ip,
  });

  return { success: true as const, batch };
}

export function voidBatch(
  operator: User,
  batchId: string,
  sampleIds: string[] | undefined,
  reason: string,
  ip?: string,
) {
  if (operator.role !== 'ADMIN') {
    return { success: false as const, error: '只有管理员可以作废' };
  }
  if (!reason || !reason.trim()) {
    return { success: false as const, error: '作废必须填写原因' };
  }

  const db = loadDb();
  const batch = db.batches.find((b) => b.id === batchId);
  if (!batch) {
    return { success: false as const, error: '批次不存在' };
  }

  const samples = db.samples.filter((s) => batch.sampleIds.includes(s.id));
  const targetIds = sampleIds && sampleIds.length > 0 ? sampleIds : samples.map((s) => s.id);
  const targetSamples = samples.filter((s) => targetIds.includes(s.id));

  if (targetSamples.length === 0) {
    return { success: false as const, error: '没有可作废的样本' };
  }

  const beforeState = {
    batchStatus: batch.status,
    samples: targetSamples.map((s) => ({ id: s.id, status: s.status })),
  };

  const now = Date.now();
  for (const sample of targetSamples) {
    if (sample.status === 'VOIDED') continue;
    sample.status = 'VOIDED';
    sample.voidedBy = operator.id;
    sample.voidedAt = now;
    sample.voidReason = reason;
    sample.updatedAt = now;

    addChainLink(sample, {
      fromUserId: sample.currentHolderId,
      fromUserName: sample.currentHolderName,
      toUserId: null,
      toUserName: null,
      action: 'VOID',
      note: reason,
    });
  }

  updateBatchStatus(db, batch);
  saveDb(db);

  createAudit(operator, 'VOID_BATCH', 'BATCH', batchId, true, {
    beforeState,
    afterState: {
      batchStatus: batch.status,
      voidReason: reason,
      samples: targetSamples.map((s) => ({ id: s.id, status: s.status })),
    },
    ipAddress: ip,
  });

  return { success: true as const, batch };
}

export function addTemperatureRecord(
  operator: User,
  sampleId: string,
  temperature: number,
  location: string,
  note?: string,
  ip?: string,
) {
  if (temperature === undefined || temperature === null || isNaN(temperature)) {
    return { success: false as const, error: '温度值缺失或非法' };
  }

  const db = loadDb();
  const sample = db.samples.find((s) => s.id === sampleId);
  if (!sample) {
    return { success: false as const, error: '样本不存在' };
  }

  const beforeState = {
    lastTempCount: sample.temperatureRecords.length,
    alertCount: sample.temperatureAlerts.length,
  };

  const now = Date.now();
  const tempRecord: TemperatureRecord = {
    id: generateId('temp'),
    sampleId: sample.id,
    timestamp: now,
    temperature,
    recordedBy: operator.id,
    location,
    note,
  };

  sample.temperatureRecords.unshift(tempRecord);
  const alert = checkAndGenerateTempAlerts(sample, tempRecord);
  sample.updatedAt = now;

  saveDb(db);

  createAudit(operator, 'ADD_TEMPERATURE', 'SAMPLE', sampleId, true, {
    beforeState,
    afterState: {
      lastTempCount: sample.temperatureRecords.length,
      alertCount: sample.temperatureAlerts.length,
      hasAlert: !!alert,
    },
    ipAddress: ip,
  });

  return { success: true as const, sample };
}

export function resolveAlert(
  operator: User,
  alertId: string,
  resolutionNote: string,
  ip?: string,
) {
  if (!resolutionNote || !resolutionNote.trim()) {
    return { success: false as const, error: '必须填写处理说明' };
  }

  const db = loadDb();
  for (const sample of db.samples) {
    const alert = sample.temperatureAlerts.find((a) => a.id === alertId);
    if (alert) {
      alert.resolved = true;
      alert.resolvedBy = operator.id;
      alert.resolvedAt = Date.now();
      alert.resolutionNote = resolutionNote;
      saveDb(db);
      createAudit(operator, 'RESOLVE_ALERT', 'SAMPLE', sample.id, true, {
        beforeState: { alertResolved: false },
        afterState: { alertResolved: true, note: resolutionNote },
        ipAddress: ip,
      });
      return { success: true as const };
    }
  }
  return { success: false as const, error: '告警不存在' };
}

export function listBatches(filters?: {
  status?: Batch['status'];
  createdBy?: string;
  receiverId?: string;
  keyword?: string;
  startTime?: number;
  endTime?: number;
}) {
  const db = loadDb();
  let batches = [...db.batches];

  if (filters) {
    if (filters.status) batches = batches.filter((b) => b.status === filters!.status);
    if (filters.createdBy) batches = batches.filter((b) => b.createdBy === filters!.createdBy);
    if (filters.receiverId) batches = batches.filter((b) => b.intendedReceiverId === filters!.receiverId);
    if (filters.startTime) batches = batches.filter((b) => b.createdAt >= filters!.startTime!);
    if (filters.endTime) batches = batches.filter((b) => b.createdAt <= filters!.endTime!);
    if (filters.keyword) {
      const kw = filters.keyword.toLowerCase();
      batches = batches.filter((b) =>
        b.batchCode.toLowerCase().includes(kw) ||
        b.creatorName.toLowerCase().includes(kw) ||
        (b.intendedReceiverName && b.intendedReceiverName.toLowerCase().includes(kw)),
      );
    }
  }

  const result = batches.map((b) => {
    const batchSamples = db.samples.filter((s) => b.sampleIds.includes(s.id));
    return {
      ...b,
      sampleCount: batchSamples.length,
      receivedCount: batchSamples.filter((s) => s.status === 'RECEIVED').length,
      returnedCount: batchSamples.filter((s) => s.status === 'RETURNED').length,
      voidedCount: batchSamples.filter((s) => s.status === 'VOIDED').length,
    };
  });

  return { batches: result };
}

export function listSamples(filters?: {
  batchId?: string;
  status?: SampleStatus;
  holderId?: string;
  keyword?: string;
  hasAlert?: boolean;
}) {
  const db = loadDb();
  let samples = [...db.samples];

  if (filters) {
    if (filters.batchId) samples = samples.filter((s) => s.batchId === filters!.batchId);
    if (filters.status) samples = samples.filter((s) => s.status === filters!.status);
    if (filters.holderId) samples = samples.filter((s) => s.currentHolderId === filters!.holderId);
    if (filters.hasAlert !== undefined) {
      samples = samples.filter((s) =>
        filters!.hasAlert
          ? s.temperatureAlerts.some((a) => !a.resolved)
          : !s.temperatureAlerts.some((a) => !a.resolved),
      );
    }
    if (filters.keyword) {
      const kw = filters.keyword.toLowerCase();
      samples = samples.filter((s) =>
        s.sampleCode.toLowerCase().includes(kw) ||
        s.type.toLowerCase().includes(kw) ||
        s.currentHolderName.toLowerCase().includes(kw) ||
        s.collectorName.toLowerCase().includes(kw),
      );
    }
  }

  return {
    samples: samples.map((s) => ({
      ...s,
      hasUnresolvedAlert: s.temperatureAlerts.some((a) => !a.resolved),
    })),
  };
}

export function getBatchDetail(batchId: string) {
  const db = loadDb();
  const batch = db.batches.find((b) => b.id === batchId);
  if (!batch) return undefined;
  const samples = db.samples.filter((s) => batch.sampleIds.includes(s.id));
  return { batch, samples };
}

export function getSampleDetail(sampleId: string): Sample | undefined {
  const db = loadDb();
  return db.samples.find((s) => s.id === sampleId);
}

export function listUsers(): User[] {
  const db = loadDb();
  return db.users.map((u) => ({ ...u, password: '***' as unknown as string }));
}

export function listReceivers(): User[] {
  return listUsers().filter((u) => u.role === 'RECEIVER' || u.role === 'ADMIN');
}

interface CsvSampleRow {
  sampleCode: string;
  type: string;
  description: string;
  sourceLocation: string;
  minTemp: number;
  maxTemp: number;
  initialTemperature: number;
  tempLocation: string;
  intendedReceiverUsername?: string;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current.trim());
  return result;
}

const CSV_REQUIRED_HEADERS = [
  'sampleCode', 'type', 'description', 'sourceLocation',
  'minTemp', 'maxTemp', 'initialTemperature', 'tempLocation',
];

export function importCsvSamples(
  operator: User,
  csvContent: string,
  ip?: string,
): {
  success: boolean;
  error?: string;
  errors?: CsvImportError[];
  batch?: Batch;
  samples?: Sample[];
  importedCount?: number;
} {
  if (operator.role !== 'SAMPLER' && operator.role !== 'ADMIN') {
    createAudit(operator, 'CSV_IMPORT', 'BATCH', 'N/A', false, {
      failureReason: '只有采样员或管理员可以导入样本',
      ipAddress: ip,
    });
    createImportNotification(operator, 'IMPORT_FAILURE', {
      message: '导入失败：只有采样员或管理员可以导入样本',
      result: { error: '只有采样员或管理员可以导入样本' },
    });
    return { success: false, error: '只有采样员或管理员可以导入样本' };
  }

  const lines = csvContent.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'));
  if (lines.length < 2) {
    return { success: false, error: 'CSV 文件为空或缺少数据行' };
  }

  const headerLine = lines[0];
  const headers = parseCsvLine(headerLine);
  const headerMap = new Map<string, number>();
  headers.forEach((h, i) => headerMap.set(h.trim().toLowerCase(), i));

  for (const req of CSV_REQUIRED_HEADERS) {
    if (!headerMap.has(req.toLowerCase())) {
      return { success: false, error: `CSV 缺少必需列: ${req}` };
    }
  }

  const hasReceiverCol = headerMap.has('intendedreceiverusername');

  const rows: CsvSampleRow[] = [];
  const parseErrors: CsvImportError[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const row = i + 1;

    const sampleCode = cols[headerMap.get('samplecode')!] || '';
    const type = cols[headerMap.get('type')!] || '';
    const description = cols[headerMap.get('description')!] || '';
    const sourceLocation = cols[headerMap.get('sourcelocation')!] || '';
    const minTempStr = cols[headerMap.get('mintemp')!] || '';
    const maxTempStr = cols[headerMap.get('maxtemp')!] || '';
    const initialTempStr = cols[headerMap.get('initialtemperature')!] || '';
    const tempLocation = cols[headerMap.get('templocation')!] || '';
    const intendedReceiverUsername = hasReceiverCol ? (cols[headerMap.get('intendedreceiverusername')!] || '') : '';

    if (!sampleCode.trim()) {
      parseErrors.push({ row, sampleCode: '', field: 'sampleCode', reason: '样本编号不能为空' });
      continue;
    }
    if (!type.trim()) {
      parseErrors.push({ row, sampleCode, field: 'type', reason: '样本类型不能为空' });
      continue;
    }
    if (!sourceLocation.trim()) {
      parseErrors.push({ row, sampleCode, field: 'sourceLocation', reason: '来源地点不能为空' });
      continue;
    }

    const minTemp = Number(minTempStr);
    const maxTemp = Number(maxTempStr);
    const initialTemperature = Number(initialTempStr);

    if (isNaN(minTemp)) {
      parseErrors.push({ row, sampleCode, field: 'minTemp', reason: '最低温度值无效' });
      continue;
    }
    if (isNaN(maxTemp)) {
      parseErrors.push({ row, sampleCode, field: 'maxTemp', reason: '最高温度值无效' });
      continue;
    }
    if (isNaN(initialTemperature)) {
      parseErrors.push({ row, sampleCode, field: 'initialTemperature', reason: '初始温度值无效' });
      continue;
    }
    if (minTemp >= maxTemp) {
      parseErrors.push({ row, sampleCode, field: 'minTemp', reason: '最低温度必须小于最高温度' });
      continue;
    }

    if (intendedReceiverUsername) {
      const db = loadDb();
      const receiver = db.users.find((u) => u.username === intendedReceiverUsername.toLowerCase());
      if (!receiver) {
        parseErrors.push({ row, sampleCode, field: 'intendedReceiverUsername', reason: `接收人用户名 ${intendedReceiverUsername} 不存在` });
        continue;
      }
      if (receiver.role !== 'RECEIVER' && receiver.role !== 'ADMIN') {
        parseErrors.push({ row, sampleCode, field: 'intendedReceiverUsername', reason: `用户 ${intendedReceiverUsername} 不是接收员角色` });
        continue;
      }
    }

    rows.push({
      sampleCode,
      type,
      description,
      sourceLocation,
      minTemp,
      maxTemp,
      initialTemperature,
      tempLocation,
      intendedReceiverUsername,
    });
  }

  const db = loadDb();

  const duplicateErrors: CsvImportError[] = [];
  for (const row of rows) {
    if (db.samples.some((s) => s.sampleCode === row.sampleCode)) {
      duplicateErrors.push({
        row: 0,
        sampleCode: row.sampleCode,
        field: 'sampleCode',
        reason: `样本编号 ${row.sampleCode} 已存在`,
      });
    }
  }

  const seenCodes = new Set<string>();
  const internalDupErrors: CsvImportError[] = [];
  for (const row of rows) {
    if (seenCodes.has(row.sampleCode)) {
      internalDupErrors.push({
        row: 0,
        sampleCode: row.sampleCode,
        field: 'sampleCode',
        reason: `CSV 内样本编号 ${row.sampleCode} 重复`,
      });
    }
    seenCodes.add(row.sampleCode);
  }

  const allErrors = [...parseErrors, ...duplicateErrors, ...internalDupErrors];

  if (allErrors.length > 0) {
    let rowCounter = 1;
    const indexedErrors: CsvImportError[] = [];
    for (const row of rows) {
      rowCounter++;
      const dupeErr = duplicateErrors.find((e) => e.sampleCode === row.sampleCode);
      if (dupeErr) {
        indexedErrors.push({ ...dupeErr, row: rowCounter });
      }
      const intErr = internalDupErrors.filter((e) => e.sampleCode === row.sampleCode);
      for (const e of intErr) {
        indexedErrors.push({ ...e, row: rowCounter });
      }
    }
    const finalErrors = [...parseErrors, ...indexedErrors];

    createAudit(operator, 'CSV_IMPORT', 'BATCH', 'N/A', false, {
      failureReason: `导入校验失败: ${finalErrors.length} 个错误`,
      afterState: { errors: finalErrors },
      ipAddress: ip,
    });

    createImportNotification(operator, 'IMPORT_FAILURE', {
      message: `导入校验失败：${finalErrors.length} 个错误`,
      result: { errorCount: finalErrors.length, errors: finalErrors as unknown as Record<string, unknown> },
    });

    return { success: false, error: '导入校验失败，请修正后重新导入', errors: finalErrors };
  }

  if (rows.length === 0) {
    return { success: false, error: '没有有效的样本数据可导入' };
  }

  const now = Date.now();
  const batchId = generateId('batch');
  const batchCode = `BATCH-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}${String(new Date().getDate()).padStart(2, '0')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

  const newSamples: Sample[] = [];

  for (const input of rows) {
    const sampleId = generateId('sample');
    const tempRecord: TemperatureRecord = {
      id: generateId('temp'),
      sampleId,
      timestamp: now,
      temperature: input.initialTemperature,
      recordedBy: operator.id,
      location: input.tempLocation || input.sourceLocation,
      note: 'CSV导入初始温度记录',
    };

    const sample: Sample = {
      id: sampleId,
      sampleCode: input.sampleCode,
      batchId,
      type: input.type,
      description: input.description,
      collectedAt: now,
      collectedBy: operator.id,
      collectorName: operator.name,
      sourceLocation: input.sourceLocation,
      currentHolderId: operator.id,
      currentHolderName: operator.name,
      status: 'REGISTERED',
      minTemp: input.minTemp,
      maxTemp: input.maxTemp,
      temperatureRecords: [tempRecord],
      temperatureAlerts: [],
      handoverChain: [],
      createdAt: now,
      updatedAt: now,
    };

    checkAndGenerateTempAlerts(sample, tempRecord);

    addChainLink(sample, {
      fromUserId: 'SYSTEM',
      fromUserName: '系统',
      toUserId: operator.id,
      toUserName: operator.name,
      action: 'REGISTER',
      temperatureChecks: [tempRecord.id],
    });

    newSamples.push(sample);
  }

  const batch: Batch = {
    id: batchId,
    batchCode,
    createdAt: now,
    createdBy: operator.id,
    creatorName: operator.name,
    sampleIds: newSamples.map((s) => s.id),
    status: 'DRAFT',
  };

  db.samples.push(...newSamples);
  db.batches.unshift(batch);
  saveDb(db);

  const audit = createAudit(operator, 'CSV_IMPORT', 'BATCH', batchId, true, {
    afterState: {
      batchCode,
      importedCount: newSamples.length,
      samples: newSamples.map((s) => ({ id: s.id, sampleCode: s.sampleCode, status: s.status })),
    },
    ipAddress: ip,
  });

  createImportUndoRecord(
    batchId,
    batchCode,
    newSamples.map((s) => s.id),
    audit.id,
    operator.id,
    operator.name,
  );

  createImportNotification(operator, 'IMPORT_SUCCESS', {
    message: `成功导入 ${newSamples.length} 个样本，批次号：${batchCode}`,
    batchId,
    batchCode,
    result: { importedCount: newSamples.length, batchCode },
  });

  return { success: true, batch, samples: newSamples, importedCount: newSamples.length };
}

export function createExportConfig(
  operator: User,
  config: Omit<ExportConfig, 'id' | 'createdBy' | 'creatorName' | 'createdAt' | 'updatedAt'>,
  ip?: string,
): ExportConfig {
  const db = loadDb();
  const now = Date.now();
  const newConfig: ExportConfig = {
    ...config,
    id: generateId('expconf'),
    createdBy: operator.id,
    creatorName: operator.name,
    createdAt: now,
    updatedAt: now,
  };
  db.exportConfigs.push(newConfig);
  saveDb(db);

  createAudit(operator, 'CREATE_EXPORT_CONFIG', 'SYSTEM', newConfig.id, true, {
    afterState: { name: newConfig.name, type: newConfig.type, filters: newConfig.filters },
    ipAddress: ip,
  });

  return newConfig;
}

export function updateExportConfig(
  operator: User,
  configId: string,
  updates: Partial<Omit<ExportConfig, 'id' | 'createdBy' | 'creatorName' | 'createdAt'>>,
  ip?: string,
): { success: boolean; config?: ExportConfig; error?: string } {
  const db = loadDb();
  const idx = db.exportConfigs.findIndex((c) => c.id === configId);
  if (idx === -1) return { success: false, error: '导出配置不存在' };

  const before = { ...db.exportConfigs[idx] };
  Object.assign(db.exportConfigs[idx], updates, { updatedAt: Date.now() });
  saveDb(db);

  createAudit(operator, 'UPDATE_EXPORT_CONFIG', 'SYSTEM', configId, true, {
    beforeState: { ...before },
    afterState: { ...db.exportConfigs[idx] },
    ipAddress: ip,
  });

  return { success: true, config: db.exportConfigs[idx] };
}

export function deleteExportConfig(
  operator: User,
  configId: string,
  ip?: string,
): { success: boolean; error?: string } {
  const db = loadDb();
  const idx = db.exportConfigs.findIndex((c) => c.id === configId);
  if (idx === -1) return { success: false, error: '导出配置不存在' };

  const removed = db.exportConfigs.splice(idx, 1)[0];
  saveDb(db);

  createAudit(operator, 'DELETE_EXPORT_CONFIG', 'SYSTEM', configId, true, {
    beforeState: { name: removed.name, type: removed.type },
    ipAddress: ip,
  });

  return { success: true };
}

export function listExportConfigs(type?: 'batches' | 'samples'): ExportConfig[] {
  const db = loadDb();
  let configs = [...db.exportConfigs];
  if (type) configs = configs.filter((c) => c.type === type);
  return configs.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getExportConfig(configId: string): ExportConfig | undefined {
  const db = loadDb();
  return db.exportConfigs.find((c) => c.id === configId);
}

// ==================== Sample Template Services ====================

export function createSampleTemplate(
  operator: User,
  input: Omit<SampleTemplate, 'id' | 'createdBy' | 'creatorName' | 'createdAt' | 'updatedAt' | 'version' | 'isActive' | 'referencedCount' | 'intendedReceiverName'>,
  ip?: string,
): { success: boolean; template?: SampleTemplate; error?: string } {
  if (operator.role !== 'SAMPLER' && operator.role !== 'ADMIN') {
    return { success: false, error: '只有采样员或管理员可以创建模板' };
  }
  if (!input.name?.trim()) {
    return { success: false, error: '模板名称不能为空' };
  }
  if (!input.intendedReceiverId) {
    return { success: false, error: '必须指定接收人' };
  }
  if (input.defaultMinTemp >= input.defaultMaxTemp) {
    return { success: false, error: '默认温度范围设置错误' };
  }

  const db = loadDb();
  const receiver = db.users.find((u) => u.id === input.intendedReceiverId);
  if (!receiver) {
    return { success: false, error: '接收人不存在' };
  }
  if (receiver.role !== 'RECEIVER' && receiver.role !== 'ADMIN') {
    return { success: false, error: '接收人必须是接收员角色' };
  }

  if (db.sampleTemplates.some((t) => t.name === input.name.trim() && t.isActive)) {
    return { success: false, error: '已存在同名的启用模板' };
  }

  const now = Date.now();
  const template: SampleTemplate = {
    ...input,
    name: input.name.trim(),
    intendedReceiverId: receiver.id,
    intendedReceiverName: receiver.name,
    id: generateId('tpl'),
    createdBy: operator.id,
    creatorName: operator.name,
    createdAt: now,
    updatedAt: now,
    version: 1,
    isActive: true,
    referencedCount: 0,
  };

  db.sampleTemplates.unshift(template);
  saveDb(db);

  createAudit(operator, 'CREATE_TEMPLATE', 'SYSTEM', template.id, true, {
    afterState: { name: template.name, receiver: template.intendedReceiverName },
    ipAddress: ip,
  });

  return { success: true, template };
}

export function updateSampleTemplate(
  operator: User,
  templateId: string,
  updates: Partial<Omit<SampleTemplate, 'id' | 'createdBy' | 'creatorName' | 'createdAt' | 'version' | 'referencedCount'>>,
  ip?: string,
): { success: boolean; template?: SampleTemplate; error?: string } {
  if (operator.role !== 'SAMPLER' && operator.role !== 'ADMIN') {
    return { success: false, error: '只有采样员或管理员可以修改模板' };
  }

  const db = loadDb();
  const idx = db.sampleTemplates.findIndex((t) => t.id === templateId);
  if (idx === -1) {
    return { success: false, error: '模板不存在' };
  }

  const template = db.sampleTemplates[idx];
  if (template.createdBy !== operator.id && operator.role !== 'ADMIN') {
    return { success: false, error: '只能修改自己创建的模板' };
  }

  const beforeState = { ...template };

  if (updates.name?.trim()) {
    if (db.sampleTemplates.some((t) => t.id !== templateId && t.name === updates.name!.trim() && t.isActive)) {
      return { success: false, error: '已存在同名的启用模板' };
    }
    template.name = updates.name.trim();
  }

  if (updates.intendedReceiverId) {
    const receiver = db.users.find((u) => u.id === updates.intendedReceiverId);
    if (!receiver) {
      return { success: false, error: '接收人不存在' };
    }
    if (receiver.role !== 'RECEIVER' && receiver.role !== 'ADMIN') {
      return { success: false, error: '接收人必须是接收员角色' };
    }
    template.intendedReceiverId = receiver.id;
    template.intendedReceiverName = receiver.name;
  }

  if (updates.defaultMinTemp !== undefined && updates.defaultMaxTemp !== undefined) {
    if (updates.defaultMinTemp >= updates.defaultMaxTemp) {
      return { success: false, error: '默认温度范围设置错误' };
    }
    template.defaultMinTemp = updates.defaultMinTemp;
    template.defaultMaxTemp = updates.defaultMaxTemp;
  } else if (updates.defaultMinTemp !== undefined) {
    if (updates.defaultMinTemp >= template.defaultMaxTemp) {
      return { success: false, error: '默认温度范围设置错误' };
    }
    template.defaultMinTemp = updates.defaultMinTemp;
  } else if (updates.defaultMaxTemp !== undefined) {
    if (template.defaultMinTemp >= updates.defaultMaxTemp) {
      return { success: false, error: '默认温度范围设置错误' };
    }
    template.defaultMaxTemp = updates.defaultMaxTemp;
  }

  if (updates.description !== undefined) template.description = updates.description;
  if (updates.storageConditions !== undefined) template.storageConditions = updates.storageConditions;
  if (updates.shippingRequirements !== undefined) template.shippingRequirements = updates.shippingRequirements;
  if (updates.note !== undefined) template.note = updates.note;
  if (updates.isActive !== undefined) template.isActive = updates.isActive;

  template.version += 1;
  template.updatedAt = Date.now();

  saveDb(db);

  createAudit(operator, 'UPDATE_TEMPLATE', 'SYSTEM', templateId, true, {
    beforeState,
    afterState: { ...template },
    ipAddress: ip,
  });

  return { success: true, template };
}

export function deactivateSampleTemplate(
  operator: User,
  templateId: string,
  ip?: string,
): { success: boolean; error?: string } {
  if (operator.role !== 'SAMPLER' && operator.role !== 'ADMIN') {
    return { success: false, error: '只有采样员或管理员可以停用模板' };
  }

  const db = loadDb();
  const template = db.sampleTemplates.find((t) => t.id === templateId);
  if (!template) {
    return { success: false, error: '模板不存在' };
  }

  if (template.createdBy !== operator.id && operator.role !== 'ADMIN') {
    return { success: false, error: '只能停用自己创建的模板' };
  }

  const beforeState = { isActive: template.isActive };
  template.isActive = false;
  template.updatedAt = Date.now();
  template.version += 1;

  saveDb(db);

  createAudit(operator, 'DEACTIVATE_TEMPLATE', 'SYSTEM', templateId, true, {
    beforeState,
    afterState: { isActive: false },
    ipAddress: ip,
  });

  return { success: true };
}

export function listSampleTemplates(includeInactive = false): SampleTemplate[] {
  const db = loadDb();
  let templates = [...db.sampleTemplates];
  if (!includeInactive) {
    templates = templates.filter((t) => t.isActive);
  }
  return templates.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getSampleTemplate(templateId: string): SampleTemplate | undefined {
  const db = loadDb();
  return db.sampleTemplates.find((t) => t.id === templateId);
}

export function createTemplateSnapshot(template: SampleTemplate): TemplateSnapshot {
  return {
    templateId: template.id,
    templateVersion: template.version,
    name: template.name,
    intendedReceiverId: template.intendedReceiverId,
    intendedReceiverName: template.intendedReceiverName,
    storageConditions: template.storageConditions,
    shippingRequirements: template.shippingRequirements,
    defaultMinTemp: template.defaultMinTemp,
    defaultMaxTemp: template.defaultMaxTemp,
    note: template.note,
    snapshotAt: Date.now(),
  };
}

export function incrementTemplateReference(templateId: string): void {
  const db = loadDb();
  const template = db.sampleTemplates.find((t) => t.id === templateId);
  if (template) {
    template.referencedCount += 1;
    saveDb(db);
  }
}

// ==================== Import Draft Services ====================

export function checkDraftConflict(
  draftId: string,
  clientVersion: number,
): DraftConflictInfo {
  const db = loadDb();
  const draft = db.importDrafts.find((d) => d.id === draftId);
  if (!draft) {
    return {
      hasConflict: false,
      currentVersion: 0,
      clientVersion,
      lastEditedBy: '',
      lastEditedByName: '',
      lastEditedAt: 0,
    };
  }
  return {
    hasConflict: draft.version > clientVersion,
    currentVersion: draft.version,
    clientVersion,
    lastEditedBy: draft.lastEditedBy,
    lastEditedByName: draft.lastEditedByName,
    lastEditedAt: draft.lastEditedAt,
  };
}

export function saveImportDraft(
  operator: User,
  input: {
    id?: string;
    name: string;
    csvContent: string;
    templateId?: string;
    parsedRows?: Array<Record<string, unknown>>;
    errors?: CsvImportError[];
    clientVersion?: number;
  },
  ip?: string,
): { success: boolean; draft?: ImportDraft; error?: string; conflict?: DraftConflictInfo } {
  if (operator.role !== 'SAMPLER' && operator.role !== 'ADMIN') {
    return { success: false, error: '只有采样员或管理员可以保存草稿' };
  }
  if (!input.name?.trim()) {
    return { success: false, error: '草稿名称不能为空' };
  }
  if (!input.csvContent?.trim()) {
    return { success: false, error: 'CSV 内容不能为空' };
  }

  const db = loadDb();
  const now = Date.now();

  if (input.id) {
    const idx = db.importDrafts.findIndex((d) => d.id === input.id);
    if (idx === -1) {
      return { success: false, error: '草稿不存在' };
    }

    const existing = db.importDrafts[idx];

    if (existing.createdBy !== operator.id && operator.role !== 'ADMIN') {
      return { success: false, error: '无权修改他人草稿' };
    }

    if (input.clientVersion !== undefined && existing.version > input.clientVersion) {
      const conflict = checkDraftConflict(input.id, input.clientVersion);
      createAudit(operator, 'DRAFT_CONFLICT_BLOCKED', 'SYSTEM', input.id, false, {
        failureReason: `并发冲突：当前版本 ${existing.version}，客户端版本 ${input.clientVersion}，最后编辑者 ${existing.lastEditedByName}`,
        ipAddress: ip,
      });
      createImportNotification(operator, 'DRAFT_CONFLICT', {
        message: `草稿「${existing.name}」已被 ${existing.lastEditedByName} 修改，请刷新后重新编辑`,
        draftId: input.id,
        result: {
          currentVersion: existing.version,
          clientVersion: input.clientVersion,
          lastEditedByName: existing.lastEditedByName,
        },
      });
      return { success: false, error: '草稿已被他人修改，请刷新后重新编辑', conflict };
    }

    if (existing.status !== 'DRAFT') {
      return { success: false, error: '草稿已提交或已取消，无法修改' };
    }

    let templateSnapshot: TemplateSnapshot | undefined;
    if (input.templateId) {
      const template = db.sampleTemplates.find((t) => t.id === input.templateId);
      if (!template) {
        return { success: false, error: '所选模板不存在' };
      }
      if (!template.isActive) {
        return { success: false, error: '所选模板已停用' };
      }
      templateSnapshot = createTemplateSnapshot(template);
    }

    const beforeState = { ...existing };

    existing.name = input.name.trim();
    existing.csvContent = input.csvContent;
    existing.templateId = input.templateId;
    existing.templateSnapshot = templateSnapshot;
    existing.parsedRows = input.parsedRows;
    existing.errors = input.errors;
    existing.updatedAt = now;
    existing.version += 1;
    existing.lastEditedBy = operator.id;
    existing.lastEditedByName = operator.name;
    existing.lastEditedAt = now;

    saveDb(db);

    createAudit(operator, 'UPDATE_DRAFT', 'SYSTEM', existing.id, true, {
      beforeState: { name: beforeState.name, version: beforeState.version },
      afterState: { name: existing.name, version: existing.version, rowCount: input.parsedRows?.length || 0 },
      ipAddress: ip,
    });

    createImportNotification(operator, 'DRAFT_UPDATE', {
      message: `草稿「${existing.name}」已更新，版本 ${existing.version}`,
      draftId: existing.id,
      templateId: existing.templateId,
      templateName: existing.templateSnapshot?.name,
      result: {
        draftName: existing.name,
        version: existing.version,
        rowCount: input.parsedRows?.length || 0,
      },
    });

    return { success: true, draft: existing };
  } else {
    let templateSnapshot: TemplateSnapshot | undefined;
    if (input.templateId) {
      const template = db.sampleTemplates.find((t) => t.id === input.templateId);
      if (!template) {
        return { success: false, error: '所选模板不存在' };
      }
      if (!template.isActive) {
        return { success: false, error: '所选模板已停用' };
      }
      templateSnapshot = createTemplateSnapshot(template);
    }

    const draft: ImportDraft = {
      id: generateId('draft'),
      name: input.name.trim(),
      csvContent: input.csvContent,
      templateId: input.templateId,
      templateSnapshot,
      parsedRows: input.parsedRows,
      errors: input.errors,
      status: 'DRAFT',
      createdBy: operator.id,
      creatorName: operator.name,
      createdAt: now,
      updatedAt: now,
      version: 1,
      lastEditedBy: operator.id,
      lastEditedByName: operator.name,
      lastEditedAt: now,
    };

    db.importDrafts.unshift(draft);
    saveDb(db);

    createAudit(operator, 'CREATE_DRAFT', 'SYSTEM', draft.id, true, {
      afterState: { name: draft.name, rowCount: input.parsedRows?.length || 0 },
      ipAddress: ip,
    });

    createImportNotification(operator, 'DRAFT_SAVE', {
      message: `草稿「${draft.name}」已保存，版本 1`,
      draftId: draft.id,
      templateId: draft.templateId,
      templateName: draft.templateSnapshot?.name,
      result: {
        draftName: draft.name,
        version: 1,
        rowCount: input.parsedRows?.length || 0,
      },
    });

    return { success: true, draft };
  }
}

export function listImportDrafts(operator: User): ImportDraft[] {
  const db = loadDb();
  let drafts = [...db.importDrafts];
  if (operator.role !== 'ADMIN') {
    drafts = drafts.filter((d) => d.createdBy === operator.id);
  }
  return drafts.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getImportDraft(
  operator: User,
  draftId: string,
): { success: boolean; draft?: ImportDraft; error?: string; conflict?: DraftConflictInfo } {
  const db = loadDb();
  const draft = db.importDrafts.find((d) => d.id === draftId);
  if (!draft) {
    return { success: false, error: '草稿不存在' };
  }
  if (draft.createdBy !== operator.id && operator.role !== 'ADMIN') {
    return { success: false, error: '无权查看他人草稿' };
  }
  return { success: true, draft };
}

export function deleteImportDraft(
  operator: User,
  draftId: string,
  ip?: string,
): { success: boolean; error?: string } {
  const db = loadDb();
  const idx = db.importDrafts.findIndex((d) => d.id === draftId);
  if (idx === -1) {
    return { success: false, error: '草稿不存在' };
  }
  const draft = db.importDrafts[idx];
  if (draft.createdBy !== operator.id && operator.role !== 'ADMIN') {
    return { success: false, error: '无权删除他人草稿' };
  }

  db.importDrafts.splice(idx, 1);
  saveDb(db);

  createAudit(operator, 'DELETE_DRAFT', 'SYSTEM', draftId, true, {
    beforeState: { name: draft.name, status: draft.status },
    ipAddress: ip,
  });

  return { success: true };
}

export function cancelImportDraft(
  operator: User,
  draftId: string,
  ip?: string,
): { success: boolean; error?: string } {
  if (operator.role !== 'SAMPLER' && operator.role !== 'ADMIN') {
    return { success: false, error: '只有采样员或管理员可以取消草稿' };
  }

  const db = loadDb();
  const draft = db.importDrafts.find((d) => d.id === draftId);
  if (!draft) {
    return { success: false, error: '草稿不存在' };
  }
  if (draft.createdBy !== operator.id && operator.role !== 'ADMIN') {
    return { success: false, error: '无权取消他人草稿' };
  }
  if (draft.status !== 'DRAFT') {
    return { success: false, error: '只有草稿状态的导入任务可以取消' };
  }

  const beforeState = { name: draft.name, status: draft.status };
  draft.status = 'CANCELLED';
  draft.updatedAt = Date.now();
  draft.version += 1;
  draft.lastEditedBy = operator.id;
  draft.lastEditedByName = operator.name;
  draft.lastEditedAt = Date.now();
  saveDb(db);

  createAudit(operator, 'CANCEL_DRAFT', 'SYSTEM', draftId, true, {
    beforeState,
    afterState: { status: 'CANCELLED' },
    ipAddress: ip,
  });

  createImportNotification(operator, 'DRAFT_CANCEL', {
    message: `草稿「${draft.name}」已取消`,
    draftId,
    result: { draftName: draft.name, status: 'CANCELLED' },
  });

  return { success: true };
}

export function importCsvFromDraft(
  operator: User,
  draftId: string,
  clientVersion: number,
  ip?: string,
): {
  success: boolean;
  error?: string;
  errors?: CsvImportError[];
  batch?: Batch;
  samples?: Sample[];
  importedCount?: number;
  conflict?: DraftConflictInfo;
} {
  const db = loadDb();
  const draft = db.importDrafts.find((d) => d.id === draftId);
  if (!draft) {
    return { success: false, error: '草稿不存在' };
  }
  if (draft.createdBy !== operator.id && operator.role !== 'ADMIN') {
    return { success: false, error: '无权提交他人草稿' };
  }
  if (draft.status !== 'DRAFT') {
    return { success: false, error: '草稿已提交或已取消' };
  }

  if (draft.version > clientVersion) {
    const conflict = checkDraftConflict(draftId, clientVersion);
    createAudit(operator, 'DRAFT_CONFLICT_BLOCKED', 'SYSTEM', draftId, false, {
      failureReason: `提交时并发冲突：当前版本 ${draft.version}，客户端版本 ${clientVersion}`,
      ipAddress: ip,
    });
    createImportNotification(operator, 'DRAFT_CONFLICT', {
      message: `草稿「${draft.name}」提交时发现冲突：已被 ${draft.lastEditedByName} 修改`,
      draftId,
      result: {
        currentVersion: draft.version,
        clientVersion,
        lastEditedByName: draft.lastEditedByName,
      },
    });
    return { success: false, error: '草稿已被他人修改，请刷新后重新提交', conflict };
  }

  const result = importCsvSamplesWithTemplate(
    operator,
    draft.csvContent,
    draft.templateSnapshot,
    draft.templateId,
    ip,
  );

  if (result.success && result.batch) {
    const freshDb = loadDb();
    const freshDraft = freshDb.importDrafts.find((d) => d.id === draftId);
    if (freshDraft) {
      freshDraft.status = 'IMPORTED';
      freshDraft.batchId = result.batch.id;
      freshDraft.updatedAt = Date.now();
      freshDraft.version += 1;
      saveDb(freshDb);
    }

    createAudit(operator, 'SUBMIT_DRAFT', 'SYSTEM', draftId, true, {
      afterState: { batchId: result.batch.id, importedCount: result.importedCount },
      ipAddress: ip,
    });

    createImportNotification(operator, 'DRAFT_SUBMIT', {
      message: `草稿「${draft.name}」提交成功，导入 ${result.importedCount} 个样本，批次号：${result.batch.batchCode}`,
      batchId: result.batch.id,
      batchCode: result.batch.batchCode,
      draftId,
      templateId: draft.templateId,
      templateName: draft.templateSnapshot?.name,
      result: {
        draftName: draft.name,
        importedCount: result.importedCount,
        batchCode: result.batch.batchCode,
      },
    });
  }

  return result;
}

export function importCsvSamplesWithTemplate(
  operator: User,
  csvContent: string,
  templateSnapshot?: TemplateSnapshot,
  templateId?: string,
  ip?: string,
): {
  success: boolean;
  error?: string;
  errors?: CsvImportError[];
  batch?: Batch;
  samples?: Sample[];
  importedCount?: number;
} {
  const baseResult = importCsvSamples(operator, csvContent, ip);
  if (!baseResult.success || !baseResult.batch || !baseResult.samples) {
    return baseResult;
  }

  if (templateSnapshot && templateId) {
    const db = loadDb();
    const batch = db.batches.find((b) => b.id === baseResult.batch!.id);
    if (batch) {
      batch.templateSnapshot = templateSnapshot;
      batch.templateId = templateId;
      batch.intendedReceiverId = templateSnapshot.intendedReceiverId;
      batch.intendedReceiverName = templateSnapshot.intendedReceiverName;

      for (const sample of baseResult.samples) {
        const s = db.samples.find((s) => s.id === sample.id);
        if (s) {
          s.minTemp = templateSnapshot.defaultMinTemp;
          s.maxTemp = templateSnapshot.defaultMaxTemp;
        }
      }

      saveDb(db);
      incrementTemplateReference(templateId);

      createAudit(operator, 'APPLY_TEMPLATE', 'BATCH', batch.id, true, {
        afterState: {
          templateId,
          templateName: templateSnapshot.name,
          templateVersion: templateSnapshot.templateVersion,
        },
        ipAddress: ip,
      });

      createImportNotification(operator, 'TEMPLATE_APPLY', {
        message: `已套用模板「${templateSnapshot.name}」，批次：${batch.batchCode}`,
        batchId: batch.id,
        batchCode: batch.batchCode,
        templateId,
        templateName: templateSnapshot.name,
        result: {
          templateName: templateSnapshot.name,
          templateVersion: templateSnapshot.templateVersion,
          batchCode: batch.batchCode,
        },
      });

      const updatedBatch = { ...batch, templateSnapshot, templateId };
      const updatedSamples = baseResult.samples.map((s) => ({
        ...s,
        minTemp: templateSnapshot.defaultMinTemp,
        maxTemp: templateSnapshot.defaultMaxTemp,
      }));

      return {
        success: true,
        batch: updatedBatch,
        samples: updatedSamples,
        importedCount: baseResult.importedCount,
      };
    }
  }

  return baseResult;
}

// ==================== Import Undo Services ====================

export function createImportUndoRecord(
  batchId: string,
  batchCode: string,
  sampleIds: string[],
  importAuditId: string,
  createdBy: string,
  creatorName: string,
): ImportUndoRecord {
  const db = loadDb();
  const record: ImportUndoRecord = {
    id: generateId('undo'),
    batchId,
    batchCode,
    sampleIds,
    importAuditId,
    createdBy,
    creatorName,
    createdAt: Date.now(),
    undone: false,
  };
  db.importUndoRecords.unshift(record);
  saveDb(db);
  return record;
}

export function getLastImportUndoRecord(
  operator: User,
): { success: boolean; record?: ImportUndoRecord; error?: string } {
  const db = loadDb();
  const records = db.importUndoRecords.filter((r) => !r.undone);
  if (operator.role !== 'ADMIN') {
    const userRecords = records.filter((r) => r.createdBy === operator.id);
    if (userRecords.length === 0) {
      return { success: false, error: '没有可撤销的导入记录' };
    }
    return { success: true, record: userRecords[0] };
  }
  if (records.length === 0) {
    return { success: false, error: '没有可撤销的导入记录' };
  }
  return { success: true, record: records[0] };
}

export function undoLastImport(
  operator: User,
  ip?: string,
): { success: boolean; error?: string; undoneData?: { batchCode: string; sampleCount: number; draftReverted?: boolean }; conflict?: DraftConflictInfo } {
  const db = loadDb();

  const recordResult = getLastImportUndoRecord(operator);
  if (!recordResult.success || !recordResult.record) {
    return { success: false, error: recordResult.error };
  }

  const recordId = recordResult.record.id;
  const record = db.importUndoRecords.find((r) => r.id === recordId);
  if (!record || record.undone) {
    return { success: false, error: '记录不存在或已被撤销' };
  }

  if (record.createdBy !== operator.id && operator.role !== 'ADMIN') {
    createAudit(operator, 'UNAUTHORIZED_UNDO_ATTEMPT', 'SYSTEM', record.id, false, {
      failureReason: `用户 ${operator.name} 尝试撤销他人创建的导入记录`,
      ipAddress: ip,
    });
    createImportNotification(operator, 'UNDO_FAILURE', {
      message: `撤销失败：只能撤销自己创建的导入记录`,
      batchId: record.batchId,
      batchCode: record.batchCode,
      undoRecordId: record.id,
      result: { error: '只能撤销自己创建的导入记录', batchCode: record.batchCode },
    });
    return { success: false, error: '只能撤销自己创建的导入记录' };
  }

  const batch = db.batches.find((b) => b.id === record.batchId);
  if (!batch) {
    return { success: false, error: '批次不存在，可能已被撤销' };
  }

  const samples = db.samples.filter((s) => record.sampleIds.includes(s.id));

  const nonDraftSamples = samples.filter((s) => s.status !== 'REGISTERED');
  if (nonDraftSamples.length > 0) {
    const nonDraftCodes = nonDraftSamples.map((s) => s.sampleCode).join(', ');
    createAudit(operator, 'UNDO_BLOCKED', 'BATCH', record.batchId, false, {
      failureReason: `部分样本已流转：${nonDraftCodes}`,
      ipAddress: ip,
    });
    createImportNotification(operator, 'UNDO_FAILURE', {
      message: `撤销失败：以下样本已开始流转，无法撤销：${nonDraftCodes}`,
      batchId: record.batchId,
      batchCode: record.batchCode,
      undoRecordId: record.id,
      result: { error: '样本已流转', sampleCodes: nonDraftCodes },
    });
    return { success: false, error: `以下样本已开始流转，无法撤销：${nonDraftCodes}` };
  }

  const beforeState = {
    batchCode: batch.batchCode,
    sampleCount: samples.length,
    batchStatus: batch.status,
  };

  for (const sample of samples) {
    const sIdx = db.samples.findIndex((s) => s.id === sample.id);
    if (sIdx !== -1) {
      db.samples.splice(sIdx, 1);
    }
  }

  const bIdx = db.batches.findIndex((b) => b.id === record.batchId);
  if (bIdx !== -1) {
    db.batches.splice(bIdx, 1);
  }

  record.undone = true;
  record.undoneBy = operator.id;
  record.undoneByName = operator.name;
  record.undoneAt = Date.now();

  if (batch.templateId) {
    const template = db.sampleTemplates.find((t) => t.id === batch.templateId);
    if (template && template.referencedCount > 0) {
      template.referencedCount -= 1;
    }
  }

  const linkedDraft = db.importDrafts.find((d) => d.batchId === record.batchId && d.status === 'IMPORTED');
  if (linkedDraft) {
    linkedDraft.status = 'DRAFT';
    linkedDraft.batchId = undefined;
    linkedDraft.updatedAt = Date.now();
    linkedDraft.version += 1;
    linkedDraft.lastEditedBy = operator.id;
    linkedDraft.lastEditedByName = operator.name;
    linkedDraft.lastEditedAt = Date.now();

    createAudit(operator, 'UNDO_REVERT_DRAFT', 'SYSTEM', linkedDraft.id, true, {
      beforeState: { status: 'IMPORTED', batchId: record.batchId },
      afterState: { status: 'DRAFT', batchId: undefined },
      ipAddress: ip,
    });
  }

  const affectedExportConfigs = db.exportConfigs.filter(
    (c) => c.filters && c.filters.batchId === record.batchId,
  );
  for (const ec of affectedExportConfigs) {
    ec.filters = { ...ec.filters, batchId: '__UNDO_DELETED__' };
    ec.updatedAt = Date.now();
  }
  if (affectedExportConfigs.length > 0) {
    createAudit(operator, 'UNDO_CLEANUP_EXPORT_CONFIGS', 'SYSTEM', record.batchId, true, {
      afterState: { cleanedUpConfigCount: affectedExportConfigs.length },
      ipAddress: ip,
    });
  }

  const nowForRollback = Date.now();
  let rolledBackNotifCount = 0;
  for (const notification of db.importNotifications) {
    if (notification.batchId === record.batchId && !notification.rolledBack) {
      notification.rolledBack = true;
      notification.rolledBackAt = nowForRollback;
      notification.rolledBackBy = operator.id;
      notification.rolledBackByName = operator.name;
      notification.status = 'ROLLED_BACK';
      notification.updatedAt = nowForRollback;
      rolledBackNotifCount++;
    }
  }

  saveDb(db);

  if (rolledBackNotifCount > 0) {
    createAudit(operator, 'ROLLBACK_NOTIFICATIONS', 'BATCH', record.batchId, true, {
      afterState: { rolledBackCount: rolledBackNotifCount },
      ipAddress: ip,
    });
  }

  createAudit(operator, 'UNDO_IMPORT', 'BATCH', record.batchId, true, {
    beforeState,
    afterState: { undone: true },
    ipAddress: ip,
  });

  createImportNotification(operator, 'UNDO_SUCCESS', {
    message: `已撤销批次 ${record.batchCode}，删除 ${record.sampleIds.length} 个样本，回退 ${rolledBackNotifCount} 条关联通知`,
    batchId: record.batchId,
    batchCode: record.batchCode,
    undoRecordId: record.id,
    result: {
      batchCode: record.batchCode,
      sampleCount: record.sampleIds.length,
      rolledBackNotificationCount: rolledBackNotifCount,
      draftReverted: !!linkedDraft,
    },
  });

  return {
    success: true,
    undoneData: {
      batchCode: record.batchCode,
      sampleCount: record.sampleIds.length,
      draftReverted: !!linkedDraft,
    },
  };
}

export function listImportUndoRecords(operator: User): ImportUndoRecord[] {
  const db = loadDb();
  let records = [...db.importUndoRecords];
  if (operator.role !== 'ADMIN') {
    records = records.filter((r) => r.createdBy === operator.id);
  }
  return records.sort((a, b) => b.createdAt - a.createdAt);
}

// ==================== Import Notification Center - Unified App Service ====================

const NOTIFICATION_TITLE_MAP: Record<ImportNotificationType, string> = {
  TEMPLATE_APPLY: '模板套用成功',
  DRAFT_SAVE: '草稿已保存',
  DRAFT_UPDATE: '草稿已更新',
  DRAFT_SUBMIT: '草稿提交导入',
  IMPORT_SUCCESS: 'CSV 导入成功',
  IMPORT_FAILURE: 'CSV 导入失败',
  EXPORT_SUCCESS: '数据导出完成',
  EXPORT_FAILURE: '数据导出失败',
  UNDO_SUCCESS: '导入已撤销',
  UNDO_FAILURE: '撤销导入失败',
  DRAFT_CONFLICT: '草稿编辑冲突',
  DRAFT_CANCEL: '草稿已取消',
};

// ============== Boundary 1: Status Resolution ==============

function resolveNotificationStatus(type: ImportNotificationType, explicitStatus?: ImportNotificationStatus): ImportNotificationStatus {
  if (explicitStatus) return explicitStatus;
  if (type.includes('FAILURE')) return 'FAILURE';
  if (type.includes('CONFLICT')) return 'FAILURE';
  return 'SUCCESS';
}

// ============== Boundary 2: Event Emit (Unified Entry) ==============

export function emitNotificationEvent(event: NotificationEvent): ImportNotification {
  const db = loadDb();
  const now = Date.now();
  const status = resolveNotificationStatus(event.type, event.status);

  const notification: ImportNotification = {
    id: generateId('notif'),
    type: event.type,
    title: NOTIFICATION_TITLE_MAP[event.type] || event.type,
    message: event.message || NOTIFICATION_TITLE_MAP[event.type] || event.type,
    operatorId: event.operator.id,
    operatorName: event.operator.name,
    batchId: event.batchId,
    batchCode: event.batchCode,
    draftId: event.draftId,
    templateId: event.templateId,
    templateName: event.templateName,
    undoRecordId: event.undoRecordId,
    result: event.result,
    status,
    rolledBack: false,
    readBy: {},
    createdAt: now,
    updatedAt: now,
  };

  db.importNotifications.unshift(notification);
  saveDb(db);
  return notification;
}

// ============== Boundary 3: Permission Filter (shared for admin & operator views) ==============

function applyPermissionFilter(notifications: ImportNotification[], operator: User): ImportNotification[] {
  if (operator.role === 'ADMIN') return notifications;
  return notifications.filter((n) => n.operatorId === operator.id);
}

function checkNotificationPermission(notification: ImportNotification, operator: User): boolean {
  if (operator.role === 'ADMIN') return true;
  return notification.operatorId === operator.id;
}

// ============== Boundary 4: List Filtering (shared logic) ==============

function applyListFilters(notifications: ImportNotification[], filters: NotificationListFilters): ImportNotification[] {
  let result = [...notifications];

  if (filters.type) {
    result = result.filter((n) => n.type === filters.type);
  }
  if (filters.status) {
    result = result.filter((n) => n.status === filters.status);
  }
  if (filters.batchId) {
    result = result.filter((n) => n.batchId === filters.batchId);
  }
  if (filters.draftId) {
    result = result.filter((n) => n.draftId === filters.draftId);
  }
  if (filters.templateId) {
    result = result.filter((n) => n.templateId === filters.templateId);
  }
  if (filters.operatorId) {
    result = result.filter((n) => n.operatorId === filters.operatorId);
  }
  if (filters.rolledBack !== undefined) {
    result = result.filter((n) => n.rolledBack === filters.rolledBack);
  }
  if (filters.startTime) {
    result = result.filter((n) => n.createdAt >= filters.startTime!);
  }
  if (filters.endTime) {
    result = result.filter((n) => n.createdAt <= filters.endTime!);
  }
  if (filters.keyword) {
    const kw = filters.keyword.toLowerCase();
    result = result.filter((n) =>
      n.title.toLowerCase().includes(kw) ||
      n.message.toLowerCase().includes(kw) ||
      (n.batchCode && n.batchCode.toLowerCase().includes(kw)) ||
      (n.templateName && n.templateName.toLowerCase().includes(kw)),
    );
  }

  return result;
}

// ============== Boundary 5: Read State Management ==============

function getNotificationReadState(notification: ImportNotification, userId: string): boolean {
  return !!(notification.readBy && notification.readBy[userId]);
}

function countUnreadNotifications(notifications: ImportNotification[], userId: string): number {
  return notifications.filter((n) => !getNotificationReadState(n, userId)).length;
}

function attachReadFlag(notifications: ImportNotification[], userId: string): (ImportNotification & { isRead: boolean })[] {
  return notifications.map((n) => ({
    ...n,
    isRead: getNotificationReadState(n, userId),
  }));
}

// ============== Boundary 6: Rollback State Management ==============

export function rollbackNotificationsByBatchId(
  operator: User,
  batchId: string,
  ip?: string,
): number {
  const db = loadDb();
  const now = Date.now();
  let rolledBackCount = 0;

  for (const notification of db.importNotifications) {
    if (notification.batchId === batchId && !notification.rolledBack) {
      notification.rolledBack = true;
      notification.rolledBackAt = now;
      notification.rolledBackBy = operator.id;
      notification.rolledBackByName = operator.name;
      notification.status = 'ROLLED_BACK';
      notification.updatedAt = now;
      rolledBackCount++;
    }
  }

  if (rolledBackCount > 0) {
    saveDb(db);
    createAudit(operator, 'ROLLBACK_NOTIFICATIONS', 'BATCH', batchId, true, {
      afterState: { rolledBackCount },
      ipAddress: ip,
    });
  }

  return rolledBackCount;
}

// ============== Boundary 7: Related Objects Resolution ==============

function resolveRelatedObjects(notification: ImportNotification): NotificationRelatedObjects {
  const db = loadDb();

  const relatedBatch = notification.batchId
    ? db.batches.find((b) => b.id === notification.batchId) || null
    : null;

  const relatedDraft = notification.draftId
    ? db.importDrafts.find((d) => d.id === notification.draftId) || null
    : null;

  const relatedTemplate = notification.templateId
    ? db.sampleTemplates.find((t) => t.id === notification.templateId) || null
    : null;

  return { relatedBatch, relatedDraft, relatedTemplate };
}

// ============== Boundary 8: Audit Timeline Aggregation ==============

function buildAuditTimeline(notification: ImportNotification, limit = 50): AuditEntry[] {
  const targetIds: string[] = [];
  if (notification.batchId) targetIds.push(notification.batchId);
  if (notification.draftId) targetIds.push(notification.draftId);
  if (notification.undoRecordId) targetIds.push(notification.undoRecordId);
  if (notification.templateId) targetIds.push(notification.templateId);

  if (targetIds.length === 0) return [];

  const allAudits = queryAudits({});
  return allAudits
    .filter((a) => targetIds.includes(a.targetId))
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}

// ============== Boundary 9: Statistics Calculation ==============

function calculateStats(notifications: ImportNotification[]): NotificationStats {
  const stats: NotificationStats = {
    total: notifications.length,
    successCount: 0,
    failureCount: 0,
    rolledBackCount: 0,
    byType: {},
  };

  for (const n of notifications) {
    if (n.rolledBack) {
      stats.rolledBackCount++;
    } else if (n.status === 'SUCCESS') {
      stats.successCount++;
    } else if (n.status === 'FAILURE') {
      stats.failureCount++;
    }
    stats.byType[n.type] = (stats.byType[n.type] || 0) + 1;
  }

  return stats;
}

// ============== Unified App Service ==============

export const notificationAppService = {
  emit: emitNotificationEvent,

  list(
    operator: User,
    filters: NotificationListFilters = {},
  ): { notifications: (ImportNotification & { isRead: boolean })[]; total: number; unreadCount: number } {
    const db = loadDb();
    let all = [...db.importNotifications];

    all = applyPermissionFilter(all, operator);
    all = applyListFilters(all, filters);
    all.sort((a, b) => b.createdAt - a.createdAt);

    const total = all.length;
    const unreadCount = countUnreadNotifications(all, operator.id);
    const withReadFlag = attachReadFlag(all, operator.id);

    return { notifications: withReadFlag, total, unreadCount };
  },

  get(
    operator: User,
    notificationId: string,
  ): { success: boolean; notification?: ImportNotification & { isRead: boolean }; error?: string; notFound?: boolean } {
    const db = loadDb();
    const notification = db.importNotifications.find((n) => n.id === notificationId);
    if (!notification) {
      return { success: false, error: '通知不存在', notFound: true };
    }
    if (!checkNotificationPermission(notification, operator)) {
      return { success: false, error: '无权查看他人通知' };
    }
    const isRead = getNotificationReadState(notification, operator.id);
    return { success: true, notification: { ...notification, isRead } };
  },

  getDetail(
    operator: User,
    notificationId: string,
  ): {
    success: boolean;
    error?: string;
    notFound?: boolean;
    notification?: ImportNotification & { isRead: boolean };
    relatedBatch?: Batch | null;
    relatedDraft?: ImportDraft | null;
    relatedTemplate?: SampleTemplate | null;
    auditTimeline?: AuditEntry[];
  } {
    const basicResult = notificationAppService.get(operator, notificationId);
    if (!basicResult.success || !basicResult.notification) {
      return { success: false, error: basicResult.error, notFound: basicResult.notFound };
    }

    const notification = basicResult.notification;
    const { relatedBatch, relatedDraft, relatedTemplate } = resolveRelatedObjects(notification);
    const auditTimeline = buildAuditTimeline(notification);

    return {
      success: true,
      notification,
      relatedBatch,
      relatedDraft,
      relatedTemplate,
      auditTimeline,
    };
  },

  markRead(
    operator: User,
    notificationId: string,
  ): { success: boolean; error?: string; read?: boolean; readAt?: number; notFound?: boolean } {
    const db = loadDb();
    const notification = db.importNotifications.find((n) => n.id === notificationId);
    if (!notification) {
      return { success: false, error: '通知不存在', notFound: true };
    }
    if (!checkNotificationPermission(notification, operator)) {
      return { success: false, error: '无权操作他人通知' };
    }
    if (!notification.readBy) {
      notification.readBy = {};
    }
    let readAt: number;
    if (!notification.readBy[operator.id]) {
      readAt = Date.now();
      notification.readBy[operator.id] = { readAt };
      notification.updatedAt = Date.now();
      saveDb(db);
    } else {
      readAt = notification.readBy[operator.id].readAt;
    }
    return { success: true, read: true, readAt };
  },

  markAllRead(operator: User): { success: boolean; markedCount: number } {
    const db = loadDb();
    let markedCount = 0;
    const now = Date.now();

    for (const notification of db.importNotifications) {
      if (!checkNotificationPermission(notification, operator)) {
        continue;
      }
      if (!notification.readBy) {
        notification.readBy = {};
      }
      if (!notification.readBy[operator.id]) {
        notification.readBy[operator.id] = { readAt: now };
        notification.updatedAt = now;
        markedCount++;
      }
    }

    if (markedCount > 0) {
      saveDb(db);
    }

    return { success: true, markedCount };
  },

  getStats(operator: User): NotificationStats {
    const db = loadDb();
    let all = [...db.importNotifications];
    all = applyPermissionFilter(all, operator);
    return calculateStats(all);
  },

  rollbackByBatchId: rollbackNotificationsByBatchId,
};

// ============== Backward Compatible Exports ==============

export function createImportNotification(
  operator: User,
  type: ImportNotificationType,
  opts: {
    message?: string;
    batchId?: string;
    batchCode?: string;
    draftId?: string;
    templateId?: string;
    templateName?: string;
    undoRecordId?: string;
    result?: NotificationResultPayload;
    status?: ImportNotificationStatus;
  } = {},
): ImportNotification {
  return emitNotificationEvent({
    type,
    operator,
    ...opts,
  });
}

export interface NotificationFilters {
  type?: ImportNotificationType;
  status?: ImportNotificationStatus;
  batchId?: string;
  draftId?: string;
  templateId?: string;
  operatorId?: string;
  rolledBack?: boolean;
  startTime?: number;
  endTime?: number;
}

export function listImportNotifications(
  operator: User,
  filters: NotificationFilters = {},
): { notifications: (ImportNotification & { isRead: boolean })[]; total: number; unreadCount: number } {
  return notificationAppService.list(operator, filters);
}

export function getImportNotification(
  operator: User,
  notificationId: string,
): { success: boolean; notification?: ImportNotification & { isRead: boolean }; error?: string; notFound?: boolean } {
  return notificationAppService.get(operator, notificationId);
}

export function markNotificationAsRead(
  operator: User,
  notificationId: string,
): { success: boolean; error?: string; read?: boolean; readAt?: number; notFound?: boolean } {
  return notificationAppService.markRead(operator, notificationId);
}

export function markAllNotificationsAsRead(
  operator: User,
): { success: boolean; markedCount: number } {
  return notificationAppService.markAllRead(operator);
}

export function getNotificationDetailWithTimeline(
  operator: User,
  notificationId: string,
): {
  success: boolean;
  error?: string;
  notFound?: boolean;
  notification?: ImportNotification & { isRead: boolean };
  relatedBatch?: Batch | null;
  relatedDraft?: ImportDraft | null;
  relatedTemplate?: SampleTemplate | null;
  auditTimeline?: AuditEntry[];
} {
  return notificationAppService.getDetail(operator, notificationId);
}

export function getNotificationStats(operator: User): NotificationStats {
  return notificationAppService.getStats(operator);
}
