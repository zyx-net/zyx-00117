import { loadDb, saveDb, generateId } from './db.js';
import { createAudit } from './audit.js';
import type {
  User,
  Sample,
  Batch,
  SampleStatus,
  TemperatureRecord,
  HandoverChainLink,
  ExportConfig,
  CsvImportError,
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

  createAudit(operator, 'CSV_IMPORT', 'BATCH', batchId, true, {
    afterState: {
      batchCode,
      importedCount: newSamples.length,
      samples: newSamples.map((s) => ({ id: s.id, sampleCode: s.sampleCode, status: s.status })),
    },
    ipAddress: ip,
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
