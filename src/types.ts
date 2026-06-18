export type Role = 'SAMPLER' | 'RECEIVER' | 'ADMIN';

export type SampleStatus =
  | 'REGISTERED'
  | 'PENDING_HANDOVER'
  | 'IN_TRANSIT'
  | 'RECEIVED'
  | 'RETURNED'
  | 'VOIDED';

export interface User {
  id: string;
  username: string;
  name: string;
  role: Role;
  department: string;
}

export interface TemperatureRecord {
  id: string;
  sampleId: string;
  timestamp: number;
  temperature: number;
  recordedBy: string;
  location: string;
  note?: string;
}

export interface TemperatureAlert {
  id: string;
  sampleId: string;
  recordId: string;
  type: 'TOO_HIGH' | 'TOO_LOW' | 'MISSING';
  threshold: number;
  actualValue: number | null;
  timestamp: number;
  resolved: boolean;
  resolvedBy?: string;
  resolvedAt?: number;
  resolutionNote?: string;
}

export interface HandoverChainLink {
  id: string;
  fromUserId: string;
  fromUserName: string;
  toUserId: string | null;
  toUserName: string | null;
  action: 'REGISTER' | 'INITIATE_HANDOVER' | 'RECEIVE' | 'RETURN' | 'RE_HANDOVER' | 'VOID';
  timestamp: number;
  note?: string;
  returnReason?: string;
  temperatureChecks?: string[];
}

export interface Sample {
  id: string;
  sampleCode: string;
  batchId: string;
  type: string;
  description: string;
  collectedAt: number;
  collectedBy: string;
  collectorName: string;
  sourceLocation: string;
  currentHolderId: string;
  currentHolderName: string;
  status: SampleStatus;
  minTemp: number;
  maxTemp: number;
  temperatureRecords: TemperatureRecord[];
  temperatureAlerts: TemperatureAlert[];
  handoverChain: HandoverChainLink[];
  createdAt: number;
  updatedAt: number;
  voidedBy?: string;
  voidedAt?: number;
  voidReason?: string;
  hasUnresolvedAlert?: boolean;
}

export interface TemplateSnapshot {
  templateId: string;
  templateVersion: number;
  name: string;
  intendedReceiverId: string;
  intendedReceiverName: string;
  storageConditions: string;
  shippingRequirements: string;
  defaultMinTemp: number;
  defaultMaxTemp: number;
  note?: string;
  snapshotAt: number;
}

export interface SampleTemplate {
  id: string;
  name: string;
  description?: string;
  intendedReceiverId: string;
  intendedReceiverName: string;
  storageConditions: string;
  shippingRequirements: string;
  defaultMinTemp: number;
  defaultMaxTemp: number;
  note?: string;
  createdBy: string;
  creatorName: string;
  createdAt: number;
  updatedAt: number;
  version: number;
  isActive: boolean;
  referencedCount: number;
}

export interface ImportDraft {
  id: string;
  name: string;
  csvContent: string;
  templateId?: string;
  templateSnapshot?: TemplateSnapshot;
  parsedRows?: Array<Record<string, unknown>>;
  errors?: CsvImportError[];
  status: 'DRAFT' | 'IMPORTING' | 'IMPORTED' | 'CANCELLED';
  createdBy: string;
  creatorName: string;
  createdAt: number;
  updatedAt: number;
  version: number;
  lastEditedBy: string;
  lastEditedByName: string;
  lastEditedAt: number;
  batchId?: string;
}

export interface ImportUndoRecord {
  id: string;
  batchId: string;
  batchCode: string;
  sampleIds: string[];
  importAuditId: string;
  createdBy: string;
  creatorName: string;
  createdAt: number;
  undone: boolean;
  undoneBy?: string;
  undoneByName?: string;
  undoneAt?: number;
}

export type DraftConflictInfo = {
  hasConflict: boolean;
  currentVersion: number;
  clientVersion: number;
  lastEditedBy: string;
  lastEditedByName: string;
  lastEditedAt: number;
};

export interface Batch {
  id: string;
  batchCode: string;
  createdAt: number;
  createdBy: string;
  creatorName: string;
  sampleIds: string[];
  status: 'DRAFT' | 'PENDING' | 'IN_TRANSIT' | 'PARTIAL_RECEIVED' | 'FULLY_RECEIVED' | 'RETURNED' | 'VOIDED';
  intendedReceiverId?: string;
  intendedReceiverName?: string;
  initiatedAt?: number;
  receivedAt?: number;
  receivedBy?: string;
  note?: string;
  sampleCount?: number;
  receivedCount?: number;
  returnedCount?: number;
  voidedCount?: number;
  templateSnapshot?: TemplateSnapshot;
  templateId?: string;
}

export interface AuditEntry {
  id: string;
  action: string;
  operatorId: string;
  operatorName: string;
  targetType: 'SAMPLE' | 'BATCH' | 'USER' | 'SYSTEM';
  targetId: string;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
  timestamp: number;
  ipAddress?: string;
  success: boolean;
  failureReason?: string;
}

export interface ExportConfig {
  id: string;
  name: string;
  createdBy: string;
  creatorName: string;
  createdAt: number;
  updatedAt: number;
  type: 'batches' | 'samples';
  includeSignoffHistory: boolean;
  includeTempAlerts: boolean;
  includeFailureAudit: boolean;
  filters: Record<string, string | number | boolean>;
}

export interface CsvImportError {
  row: number;
  sampleCode: string;
  field: string;
  reason: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export const STATUS_LABELS: Record<SampleStatus, string> = {
  REGISTERED: '已登记',
  PENDING_HANDOVER: '待交接',
  IN_TRANSIT: '交接中',
  RECEIVED: '已签收',
  RETURNED: '已退回',
  VOIDED: '已作废',
};

export const BATCH_STATUS_LABELS: Record<Batch['status'], string> = {
  DRAFT: '草稿',
  PENDING: '待交接',
  IN_TRANSIT: '交接中',
  PARTIAL_RECEIVED: '部分签收',
  FULLY_RECEIVED: '全部签收',
  RETURNED: '已退回',
  VOIDED: '已作废',
};

export const ROLE_LABELS: Record<Role, string> = {
  SAMPLER: '采样员',
  RECEIVER: '接收员',
  ADMIN: '管理员',
};

export const ACTION_LABELS: Record<HandoverChainLink['action'], string> = {
  REGISTER: '登记入库',
  INITIATE_HANDOVER: '发起交接',
  RECEIVE: '签收',
  RETURN: '退回',
  RE_HANDOVER: '重新交接',
  VOID: '作废',
};

export const STATUS_COLORS: Record<SampleStatus, string> = {
  REGISTERED: 'bg-slate-100 text-slate-700 border-slate-200',
  PENDING_HANDOVER: 'bg-amber-50 text-amber-700 border-amber-200',
  IN_TRANSIT: 'bg-blue-50 text-blue-700 border-blue-200',
  RECEIVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  RETURNED: 'bg-orange-50 text-orange-700 border-orange-200',
  VOIDED: 'bg-red-50 text-red-700 border-red-200',
};

export const BATCH_STATUS_COLORS: Record<Batch['status'], string> = {
  DRAFT: 'bg-slate-100 text-slate-700 border-slate-200',
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  IN_TRANSIT: 'bg-blue-50 text-blue-700 border-blue-200',
  PARTIAL_RECEIVED: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  FULLY_RECEIVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  RETURNED: 'bg-orange-50 text-orange-700 border-orange-200',
  VOIDED: 'bg-red-50 text-red-700 border-red-200',
};

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

export type ImportNotificationType =
  | 'TEMPLATE_APPLY'
  | 'DRAFT_SAVE'
  | 'DRAFT_UPDATE'
  | 'DRAFT_SUBMIT'
  | 'IMPORT_SUCCESS'
  | 'IMPORT_FAILURE'
  | 'EXPORT_SUCCESS'
  | 'EXPORT_FAILURE'
  | 'UNDO_SUCCESS'
  | 'UNDO_FAILURE'
  | 'DRAFT_CONFLICT'
  | 'DRAFT_CANCEL';

export type ImportNotificationStatus =
  | 'PENDING'
  | 'SUCCESS'
  | 'FAILURE'
  | 'ROLLED_BACK';

export interface NotificationResultPayload {
  importedCount?: number;
  batchCode?: string;
  draftName?: string;
  version?: number;
  rowCount?: number;
  templateName?: string;
  templateVersion?: number;
  error?: string;
  sampleCodes?: string;
  sampleCount?: number;
  rolledBackNotificationCount?: number;
  draftReverted?: boolean;
  currentVersion?: number;
  clientVersion?: number;
  lastEditedByName?: string;
  status?: string;
  exportType?: string;
  [key: string]: unknown;
}

export interface ImportNotification {
  id: string;
  type: ImportNotificationType;
  title: string;
  message: string;
  operatorId: string;
  operatorName: string;
  batchId?: string;
  batchCode?: string;
  draftId?: string;
  templateId?: string;
  templateName?: string;
  undoRecordId?: string;
  result?: NotificationResultPayload;
  status: ImportNotificationStatus;
  rolledBack: boolean;
  rolledBackAt?: number;
  rolledBackBy?: string;
  rolledBackByName?: string;
  isRead: boolean;
  readBy?: Record<string, { readAt: number }>;
  createdAt: number;
  updatedAt: number;
}

export interface NotificationStats {
  total: number;
  successCount: number;
  failureCount: number;
  rolledBackCount: number;
  byType: Record<string, number>;
}

export const NOTIFICATION_TYPE_LABELS: Record<ImportNotificationType, string> = {
  TEMPLATE_APPLY: '模板套用',
  DRAFT_SAVE: '草稿保存',
  DRAFT_UPDATE: '草稿更新',
  DRAFT_SUBMIT: '草稿提交',
  IMPORT_SUCCESS: '导入成功',
  IMPORT_FAILURE: '导入失败',
  EXPORT_SUCCESS: '导出成功',
  EXPORT_FAILURE: '导出失败',
  UNDO_SUCCESS: '撤销成功',
  UNDO_FAILURE: '撤销失败',
  DRAFT_CONFLICT: '草稿冲突',
  DRAFT_CANCEL: '草稿取消',
};

export const NOTIFICATION_STATUS_COLORS: Record<ImportNotificationStatus, string> = {
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  SUCCESS: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  FAILURE: 'bg-red-50 text-red-700 border-red-200',
  ROLLED_BACK: 'bg-slate-100 text-slate-600 border-slate-200',
};

export const NOTIFICATION_STATUS_LABELS: Record<ImportNotificationStatus, string> = {
  PENDING: '待处理',
  SUCCESS: '成功',
  FAILURE: '失败',
  ROLLED_BACK: '已回退',
};

export function formatDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
