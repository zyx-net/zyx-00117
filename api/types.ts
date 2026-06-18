import type { Request as ExpressRequest } from 'express';

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
  password: string;
  role: Role;
  name: string;
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
  templateSnapshot?: TemplateSnapshot;
  templateId?: string;
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

export interface LabsRequest extends ExpressRequest {
  session: {
    userId?: string;
    [key: string]: unknown;
  } | null;
}

export interface CsvImportError {
  row: number;
  sampleCode: string;
  field: string;
  reason: string;
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
  result?: Record<string, unknown>;
  status: ImportNotificationStatus;
  rolledBack: boolean;
  rolledBackAt?: number;
  rolledBackBy?: string;
  rolledBackByName?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
