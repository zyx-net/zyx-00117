import type { AuditEntry, User } from './types.js';
import { loadDb, saveDb, generateId } from './db.js';

export function createAudit(
  operator: User,
  action: string,
  targetType: AuditEntry['targetType'],
  targetId: string,
  success: boolean,
  opts: {
    beforeState?: Record<string, unknown>;
    afterState?: Record<string, unknown>;
    failureReason?: string;
    ipAddress?: string;
  } = {},
): AuditEntry {
  const entry: AuditEntry = {
    id: generateId('audit'),
    action,
    operatorId: operator.id,
    operatorName: operator.name,
    targetType,
    targetId,
    timestamp: Date.now(),
    success,
    beforeState: opts.beforeState,
    afterState: opts.afterState,
    failureReason: opts.failureReason,
    ipAddress: opts.ipAddress,
  };
  const db = loadDb();
  db.audits.unshift(entry);
  saveDb(db);
  return entry;
}

export function queryAudits(filters: {
  targetType?: AuditEntry['targetType'];
  targetId?: string;
  action?: string;
  operatorId?: string;
  startTime?: number;
  endTime?: number;
  success?: boolean;
}): AuditEntry[] {
  const db = loadDb();
  return db.audits.filter((a) => {
    if (filters.targetType && a.targetType !== filters.targetType) return false;
    if (filters.targetId && a.targetId !== filters.targetId) return false;
    if (filters.action && a.action !== filters.action) return false;
    if (filters.operatorId && a.operatorId !== filters.operatorId) return false;
    if (filters.startTime && a.timestamp < filters.startTime) return false;
    if (filters.endTime && a.timestamp > filters.endTime) return false;
    if (filters.success !== undefined && a.success !== filters.success) return false;
    return true;
  });
}
