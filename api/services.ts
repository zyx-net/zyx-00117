import { loadDb, saveDb, generateId } from './db.js';
import { createAudit } from './audit.js';
import type {
  User,
  Sample,
  Batch,
  SampleStatus,
  TemperatureRecord,
  HandoverChainLink,
} from './types.js';

const STATUS_FLOW: Record<SampleStatus, SampleStatus[]> = {
  REGISTERED: ['PENDING_HANDOVER', 'IN_TRANSIT', 'VOIDED'],
  PENDING_HANDOVER: ['IN_TRANSIT', 'VOIDED'],
  IN_TRANSIT: ['RECEIVED', 'RETURNED', 'VOIDED'],
  RECEIVED: ['RETURNED', 'VOIDED'],
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
    if (sample.status !== 'IN_TRANSIT' && sample.status !== 'RECEIVED') {
      createAudit(operator, 'RETURN_BATCH', 'BATCH', batchId, false, {
        failureReason: `样本 ${sample.sampleCode} 状态不允许退回`,
        ipAddress: ip,
      });
      return { success: false as const, error: `样本 ${sample.sampleCode} 当前状态不允许退回` };
    }
    if (sample.currentHolderId !== operator.id && operator.role !== 'ADMIN') {
      createAudit(operator, 'RETURN_BATCH', 'BATCH', batchId, false, {
        failureReason: `样本 ${sample.sampleCode} 不属于当前用户`,
        ipAddress: ip,
      });
      return { success: false as const, error: `样本 ${sample.sampleCode} 不属于您` };
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
