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
}

export interface LabsRequest extends ExpressRequest {
  session: {
    userId?: string;
    [key: string]: unknown;
  } | null;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
