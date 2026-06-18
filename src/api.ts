import type {
  User,
  Batch,
  Sample,
  AuditEntry,
  ApiResponse,
  RegisterSampleInput,
  ExportConfig,
  CsvImportError,
  SampleTemplate,
  ImportDraft,
  ImportUndoRecord,
  DraftConflictInfo,
  ImportNotification,
  ImportNotificationType,
  ImportNotificationStatus,
} from './types';

export type { RegisterSampleInput, ExportConfig, CsvImportError, SampleTemplate, ImportDraft, ImportUndoRecord, DraftConflictInfo, ImportNotification, ImportNotificationType, ImportNotificationStatus };

const API_BASE = '/api';

async function request<T>(
  path: string,
  method: string = 'GET',
  body?: unknown,
): Promise<ApiResponse<T>> {
  const opts: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
  };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
  }
  try {
    const res = await fetch(API_BASE + path, opts);
    const json = (await res.json()) as ApiResponse<T>;
    return json;
  } catch (e) {
    return {
      success: false,
      error: (e as Error).message || '网络请求失败',
    };
  }
}

export const api = {
  login: (username: string, password: string) =>
    request<User>('/auth/login', 'POST', { username, password }),

  me: () => request<User>('/auth/me'),

  logout: () => request('/auth/logout', 'POST'),

  listBatches: (filters?: Record<string, string | number | undefined>) => {
    const qs = filters
      ? '?' +
        Object.entries(filters)
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join('&')
      : '';
    return request<{ batches: Batch[] }>(`/labs/batches${qs}`);
  },

  getBatchDetail: (id: string) =>
    request<{ batch: Batch; samples: Sample[] }>(`/labs/batches/${id}`),

  registerSamples: (inputs: RegisterSampleInput[]) =>
    request<{ batch: Batch; samples: Sample[] }>('/labs/samples/register', 'POST', { inputs }),

  initiateHandover: (batchId: string, intendedReceiverId: string, note?: string) =>
    request<{ batch: Batch }>(`/labs/batches/${batchId}/initiate-handover`, 'POST', {
      intendedReceiverId,
      note,
    }),

  receiveBatch: (
    batchId: string,
    sampleIds: string[],
    temperatureRecords: Array<{ sampleId: string; temperature: number; location: string }>,
  ) =>
    request<{ batch: Batch; receivedSamples: Sample[] }>(`/labs/batches/${batchId}/receive`, 'POST', {
      sampleIds,
      temperatureRecords,
    }),

  returnBatch: (
    batchId: string,
    sampleIds: string[],
    reason: string,
    temperatureRecords: Array<{ sampleId: string; temperature: number; location: string }>,
  ) =>
    request<{ batch: Batch }>(`/labs/batches/${batchId}/return`, 'POST', {
      sampleIds,
      reason,
      temperatureRecords,
    }),

  reInitiateHandover: (
    batchId: string,
    sampleIds: string[],
    newReceiverId: string,
    temperatureRecords: Array<{ sampleId: string; temperature: number; location: string }>,
    note?: string,
  ) =>
    request<{ batch: Batch }>(`/labs/batches/${batchId}/re-handover`, 'POST', {
      sampleIds,
      newReceiverId,
      temperatureRecords,
      note,
    }),

  voidBatch: (batchId: string, sampleIds: string[] | undefined, reason: string) =>
    request<{ batch: Batch }>(`/labs/batches/${batchId}/void`, 'POST', { sampleIds, reason }),

  listSamples: (filters?: Record<string, string | number | boolean | undefined>) => {
    const qs = filters
      ? '?' +
        Object.entries(filters)
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join('&')
      : '';
    return request<{ samples: Sample[] }>(`/labs/samples${qs}`);
  },

  getSampleDetail: (id: string) => request<Sample>(`/labs/samples/${id}`),

  addTemperature: (sampleId: string, temperature: number, location: string, note?: string) =>
    request<{ sample: Sample }>(`/labs/samples/${sampleId}/temperature`, 'POST', {
      temperature,
      location,
      note,
    }),

  resolveAlert: (alertId: string, resolutionNote: string) =>
    request(`/labs/alerts/${alertId}/resolve`, 'POST', { resolutionNote }),

  listReceivers: () => request<User[]>('/labs/users/receivers'),
  listUsers: () => request<User[]>('/labs/users'),

  listAudits: (filters?: Record<string, string | number | boolean | undefined>) => {
    const qs = filters
      ? '?' +
        Object.entries(filters)
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join('&')
      : '';
    return request<{ audits: AuditEntry[] }>(`/admin/audits${qs}`);
  },

  buildExportUrl: (type: 'batches' | 'samples', filters?: Record<string, string | number | boolean | undefined>, configId?: string, options?: { includeSignoffHistory?: boolean; includeTempAlerts?: boolean; includeFailureAudit?: boolean }) => {
    const allFilters: Record<string, string> = {};
    if (filters) {
      Object.entries(filters)
        .filter(([, v]) => v !== undefined && v !== '')
        .forEach(([k, v]) => { allFilters[k] = String(v); });
    }
    if (configId) allFilters.configId = configId;
    if (options?.includeSignoffHistory !== undefined) allFilters.includeSignoffHistory = String(options.includeSignoffHistory);
    if (options?.includeTempAlerts !== undefined) allFilters.includeTempAlerts = String(options.includeTempAlerts);
    if (options?.includeFailureAudit !== undefined) allFilters.includeFailureAudit = String(options.includeFailureAudit);
    const qs = Object.keys(allFilters).length > 0
      ? '?' + Object.entries(allFilters).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
      : '';
    return `${API_BASE}/admin/export/${type}${qs}`;
  },

  importCsv: (csvContent: string) =>
    request<{ batch: Batch; samples: Sample[]; importedCount: number }>('/labs/samples/import-csv', 'POST', { csvContent }),

  listExportConfigs: (type?: 'batches' | 'samples') => {
    const qs = type ? `?type=${encodeURIComponent(type)}` : '';
    return request<{ configs: ExportConfig[] }>(`/labs/export-configs${qs}`);
  },

  createExportConfig: (config: Omit<ExportConfig, 'id' | 'createdBy' | 'creatorName' | 'createdAt' | 'updatedAt'>) =>
    request<{ config: ExportConfig }>('/labs/export-configs', 'POST', config),

  updateExportConfig: (id: string, updates: Partial<Omit<ExportConfig, 'id' | 'createdBy' | 'creatorName' | 'createdAt'>>) =>
    request<{ config: ExportConfig }>(`/labs/export-configs/${id}`, 'PUT', updates),

  deleteExportConfig: (id: string) =>
    request(`/labs/export-configs/${id}`, 'DELETE'),

  listSampleTemplates: (includeInactive = false) => {
    const qs = includeInactive ? '?includeInactive=true' : '';
    return request<{ templates: SampleTemplate[] }>(`/labs/templates${qs}`);
  },

  getSampleTemplate: (id: string) =>
    request<{ template: SampleTemplate }>(`/labs/templates/${id}`),

  createSampleTemplate: (input: Omit<SampleTemplate, 'id' | 'createdBy' | 'creatorName' | 'createdAt' | 'updatedAt' | 'version' | 'isActive' | 'referencedCount' | 'intendedReceiverName'>) =>
    request<{ template: SampleTemplate }>('/labs/templates', 'POST', input),

  updateSampleTemplate: (id: string, updates: Partial<Omit<SampleTemplate, 'id' | 'createdBy' | 'creatorName' | 'createdAt' | 'version' | 'referencedCount'>>) =>
    request<{ template: SampleTemplate }>(`/labs/templates/${id}`, 'PUT', updates),

  deactivateSampleTemplate: (id: string) =>
    request(`/labs/templates/${id}/deactivate`, 'POST'),

  importCsvWithTemplate: (csvContent: string, templateId?: string) =>
    request<{ batch: Batch; samples: Sample[]; importedCount: number }>('/labs/samples/import-csv-with-template', 'POST', { csvContent, templateId }),

  listImportDrafts: () =>
    request<{ drafts: ImportDraft[] }>('/labs/drafts'),

  getImportDraft: (id: string) =>
    request<{ draft: ImportDraft }>(`/labs/drafts/${id}`),

  checkDraftConflict: (id: string, clientVersion: number) => {
    const qs = `?clientVersion=${clientVersion}`;
    return request<{ conflict: DraftConflictInfo }>(`/labs/drafts/${id}/conflict${qs}`);
  },

  saveImportDraft: (input: { id?: string; name: string; csvContent: string; templateId?: string; parsedRows?: Array<Record<string, unknown>>; errors?: CsvImportError[]; clientVersion?: number }) =>
    request<{ draft: ImportDraft }>('/labs/drafts', 'POST', input),

  deleteImportDraft: (id: string) =>
    request(`/labs/drafts/${id}`, 'DELETE'),

  cancelImportDraft: (id: string) =>
    request(`/labs/drafts/${id}/cancel`, 'POST'),

  importCsvFromDraft: (id: string, clientVersion: number) =>
    request<{ batch: Batch; samples: Sample[]; importedCount: number }>(`/labs/drafts/${id}/import`, 'POST', { clientVersion }),

  getLastImportUndoRecord: () =>
    request<{ record: ImportUndoRecord }>('/labs/import-undo/last'),

  listImportUndoRecords: () =>
    request<{ records: ImportUndoRecord[] }>('/labs/import-undo'),

  undoLastImport: () =>
    request<{ undoneData: { batchCode: string; sampleCount: number; draftReverted?: boolean } }>('/labs/import-undo/undo', 'POST'),

  listNotifications: (filters?: Record<string, string | number | boolean | undefined>) => {
    const qs = filters
      ? '?' +
        Object.entries(filters)
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join('&')
      : '';
    return request<{ notifications: ImportNotification[]; total: number; unreadCount: number }>(`/labs/notifications${qs}`);
  },

  getNotificationStats: () =>
    request<{ stats: { total: number; successCount: number; failureCount: number; rolledBackCount: number; byType: Record<string, number> } }>('/labs/notifications/stats'),

  getNotificationDetail: (id: string) =>
    request<{
      notification: ImportNotification;
      relatedBatch: Batch | null;
      relatedDraft: ImportDraft | null;
      relatedTemplate: SampleTemplate | null;
      auditTimeline: AuditEntry[];
    }>(`/labs/notifications/${id}/detail`),

  markNotificationRead: (id: string) =>
    request<{ read: boolean; readAt: number }>(`/labs/notifications/${id}/read`, 'POST'),

  markAllNotificationsRead: () =>
    request<{ readCount: number }>('/labs/notifications/read-all', 'POST'),
};
