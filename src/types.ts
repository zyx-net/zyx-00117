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

export function formatDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
