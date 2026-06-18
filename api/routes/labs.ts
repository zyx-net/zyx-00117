import { Router, type Response } from 'express';
import type { AuthenticatedRequest } from '../middleware.js';
import { requireAuth, requireRole, getClientIp } from '../middleware.js';
import {
  registerSamples,
  initiateHandover,
  receiveBatch,
  returnBatch,
  reInitiateHandover,
  voidBatch,
  listBatches,
  getBatchDetail,
  listSamples,
  getSampleDetail,
  addTemperatureRecord,
  resolveAlert,
  listReceivers,
  listUsers,
  importCsvSamples,
  createExportConfig,
  updateExportConfig,
  deleteExportConfig,
  listExportConfigs,
  createSampleTemplate,
  updateSampleTemplate,
  deactivateSampleTemplate,
  listSampleTemplates,
  getSampleTemplate,
  createTemplateSnapshot,
  saveImportDraft,
  listImportDrafts,
  getImportDraft,
  deleteImportDraft,
  cancelImportDraft,
  importCsvFromDraft,
  getLastImportUndoRecord,
  undoLastImport,
  listImportUndoRecords,
  importCsvSamplesWithTemplate,
  checkDraftConflict,
  listImportNotifications,
  getImportNotification,
  getNotificationStats,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  getNotificationDetailWithTimeline,
} from '../services.js';
import type { Role, ImportNotificationType, ImportNotificationStatus } from '../types.js';

const router = Router();

router.get('/batches', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const filters: Record<string, string | number> = {};
    if (req.query.status) filters.status = req.query.status as string;
    if (req.query.createdBy) filters.createdBy = req.query.createdBy as string;
    if (req.query.receiverId) filters.receiverId = req.query.receiverId as string;
    if (req.query.keyword) filters.keyword = req.query.keyword as string;
    if (req.query.startTime) filters.startTime = Number(req.query.startTime);
    if (req.query.endTime) filters.endTime = Number(req.query.endTime);

    const user = req.user!;
    if (user.role === 'SAMPLER') {
      filters.createdBy = user.id;
    } else if (user.role === 'RECEIVER') {
      filters.receiverId = user.id;
    }

    res.json({ success: true, data: listBatches(filters) });
  } catch (e) {
    res.status(500).json({ success: false, error: '查询批次列表失败' });
  }
});

router.get('/batches/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = getBatchDetail(req.params.id);
    if (!result) {
      return res.status(404).json({ success: false, error: '批次不存在' });
    }
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, error: '查询批次详情失败' });
  }
});

router.post('/samples/register', requireAuth, requireRole('SAMPLER' as Role, 'ADMIN' as Role), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { inputs } = req.body;
    if (!Array.isArray(inputs)) {
      return res.status(400).json({ success: false, error: '样本数据格式错误' });
    }
    const ip = getClientIp(req);
    const result = registerSamples(req.user!, inputs, ip);
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }
    res.status(201).json({ success: true, data: { batch: result.batch, samples: result.samples } });
  } catch (e) {
    res.status(500).json({ success: false, error: '登记样本失败' });
  }
});

router.post('/batches/:id/initiate-handover', requireAuth, requireRole('SAMPLER' as Role, 'ADMIN' as Role), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { intendedReceiverId, note } = req.body;
    if (!intendedReceiverId) {
      return res.status(400).json({ success: false, error: '必须指定接收人' });
    }
    const ip = getClientIp(req);
    const result = initiateHandover(req.user!, req.params.id, intendedReceiverId, note, ip);
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }
    res.json({ success: true, data: { batch: result.batch } });
  } catch (e) {
    res.status(500).json({ success: false, error: '发起交接失败' });
  }
});

router.post('/batches/:id/receive', requireAuth, requireRole('RECEIVER' as Role, 'ADMIN' as Role), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sampleIds, temperatureRecords } = req.body;
    if (!Array.isArray(sampleIds) || sampleIds.length === 0) {
      return res.status(400).json({ success: false, error: '必须指定待签收样本' });
    }
    if (!Array.isArray(temperatureRecords)) {
      return res.status(400).json({ success: false, error: '必须提供温度记录' });
    }
    const ip = getClientIp(req);
    const result = receiveBatch(req.user!, req.params.id, sampleIds, temperatureRecords, ip);
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }
    res.json({ success: true, data: { batch: result.batch, receivedSamples: result.receivedSamples } });
  } catch (e) {
    res.status(500).json({ success: false, error: '签收失败' });
  }
});

router.post('/batches/:id/return', requireAuth, requireRole('RECEIVER' as Role, 'ADMIN' as Role), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sampleIds, reason, temperatureRecords } = req.body;
    if (!Array.isArray(sampleIds) || sampleIds.length === 0) {
      return res.status(400).json({ success: false, error: '必须指定待退回样本' });
    }
    if (!Array.isArray(temperatureRecords)) {
      return res.status(400).json({ success: false, error: '必须提供温度记录' });
    }
    const ip = getClientIp(req);
    const result = returnBatch(req.user!, req.params.id, sampleIds, reason, temperatureRecords, ip);
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }
    res.json({ success: true, data: { batch: result.batch } });
  } catch (e) {
    res.status(500).json({ success: false, error: '退回失败' });
  }
});

router.post('/batches/:id/re-handover', requireAuth, requireRole('SAMPLER' as Role, 'ADMIN' as Role), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sampleIds, newReceiverId, temperatureRecords, note } = req.body;
    if (!Array.isArray(sampleIds) || sampleIds.length === 0) {
      return res.status(400).json({ success: false, error: '必须指定待重新交接样本' });
    }
    if (!newReceiverId) {
      return res.status(400).json({ success: false, error: '必须指定新接收人' });
    }
    if (!Array.isArray(temperatureRecords)) {
      return res.status(400).json({ success: false, error: '必须提供温度记录' });
    }
    const ip = getClientIp(req);
    const result = reInitiateHandover(req.user!, req.params.id, sampleIds, newReceiverId, temperatureRecords, note, ip);
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }
    res.json({ success: true, data: { batch: result.batch } });
  } catch (e) {
    res.status(500).json({ success: false, error: '重新交接失败' });
  }
});

router.post('/batches/:id/void', requireAuth, requireRole('ADMIN' as Role), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sampleIds, reason } = req.body;
    const ip = getClientIp(req);
    const result = voidBatch(req.user!, req.params.id, sampleIds, reason, ip);
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }
    res.json({ success: true, data: { batch: result.batch } });
  } catch (e) {
    res.status(500).json({ success: false, error: '作废失败' });
  }
});

router.get('/samples', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const filters: Record<string, string | boolean> = {};
    if (req.query.batchId) filters.batchId = req.query.batchId as string;
    if (req.query.status) filters.status = req.query.status as string;
    if (req.query.holderId) filters.holderId = req.query.holderId as string;
    if (req.query.keyword) filters.keyword = req.query.keyword as string;
    if (req.query.hasAlert !== undefined) filters.hasAlert = req.query.hasAlert === 'true';

    res.json({ success: true, data: listSamples(filters) });
  } catch (e) {
    res.status(500).json({ success: false, error: '查询样本列表失败' });
  }
});

router.get('/samples/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = getSampleDetail(req.params.id);
    if (!result) {
      return res.status(404).json({ success: false, error: '样本不存在' });
    }
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, error: '查询样本详情失败' });
  }
});

router.post('/samples/:id/temperature', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { temperature, location, note } = req.body;
    const ip = getClientIp(req);
    const result = addTemperatureRecord(req.user!, req.params.id, Number(temperature), location, note, ip);
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }
    res.json({ success: true, data: { sample: result.sample } });
  } catch (e) {
    res.status(500).json({ success: false, error: '添加温度记录失败' });
  }
});

router.post('/alerts/:id/resolve', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { resolutionNote } = req.body;
    const ip = getClientIp(req);
    const result = resolveAlert(req.user!, req.params.id, resolutionNote, ip);
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: '处理告警失败' });
  }
});

router.get('/users/receivers', requireAuth, (_req: AuthenticatedRequest, res: Response) => {
  try {
    res.json({ success: true, data: listReceivers() });
  } catch (e) {
    res.status(500).json({ success: false, error: '查询接收人列表失败' });
  }
});

router.get('/users', requireAuth, (_req: AuthenticatedRequest, res: Response) => {
  try {
    res.json({ success: true, data: listUsers() });
  } catch (e) {
    res.status(500).json({ success: false, error: '查询用户列表失败' });
  }
});

router.post('/samples/import-csv', requireAuth, requireRole('SAMPLER' as Role, 'ADMIN' as Role), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { csvContent } = req.body;
    if (!csvContent || typeof csvContent !== 'string') {
      return res.status(400).json({ success: false, error: '必须提供 CSV 内容' });
    }
    const ip = getClientIp(req);
    const result = importCsvSamples(req.user!, csvContent, ip);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error,
        errors: result.errors,
      });
    }
    res.status(201).json({
      success: true,
      data: {
        batch: result.batch,
        samples: result.samples,
        importedCount: result.importedCount,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: 'CSV 导入失败' });
  }
});

router.get('/export-configs', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const type = req.query.type as 'batches' | 'samples' | undefined;
    const configs = listExportConfigs(type);
    res.json({ success: true, data: { configs } });
  } catch (e) {
    res.status(500).json({ success: false, error: '查询导出配置失败' });
  }
});

router.post('/export-configs', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, type, includeSignoffHistory, includeTempAlerts, includeFailureAudit, filters } = req.body;
    if (!name || !type) {
      return res.status(400).json({ success: false, error: '配置名称和类型必填' });
    }
    const ip = getClientIp(req);
    const config = createExportConfig(req.user!, {
      name,
      type,
      includeSignoffHistory: !!includeSignoffHistory,
      includeTempAlerts: !!includeTempAlerts,
      includeFailureAudit: !!includeFailureAudit,
      filters: filters || {},
    }, ip);
    res.status(201).json({ success: true, data: { config } });
  } catch (e) {
    res.status(500).json({ success: false, error: '创建导出配置失败' });
  }
});

router.put('/export-configs/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const ip = getClientIp(req);
    const result = updateExportConfig(req.user!, req.params.id, req.body, ip);
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }
    res.json({ success: true, data: { config: result.config } });
  } catch (e) {
    res.status(500).json({ success: false, error: '更新导出配置失败' });
  }
});

router.delete('/export-configs/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const ip = getClientIp(req);
    const result = deleteExportConfig(req.user!, req.params.id, ip);
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: '删除导出配置失败' });
  }
});

// ==================== Sample Template Routes ====================

router.get('/templates', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const includeInactive = req.query.includeInactive === 'true';
    const templates = listSampleTemplates(includeInactive);
    res.json({ success: true, data: { templates } });
  } catch (e) {
    res.status(500).json({ success: false, error: '查询模板列表失败' });
  }
});

router.get('/templates/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const template = getSampleTemplate(req.params.id);
    if (!template) {
      return res.status(404).json({ success: false, error: '模板不存在' });
    }
    res.json({ success: true, data: { template } });
  } catch (e) {
    res.status(500).json({ success: false, error: '查询模板详情失败' });
  }
});

router.post('/templates', requireAuth, requireRole('SAMPLER' as Role, 'ADMIN' as Role), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, description, intendedReceiverId, storageConditions, shippingRequirements, defaultMinTemp, defaultMaxTemp, note } = req.body;
    if (!name || !intendedReceiverId || storageConditions === undefined || shippingRequirements === undefined || defaultMinTemp === undefined || defaultMaxTemp === undefined) {
      return res.status(400).json({ success: false, error: '模板名称、接收人、保存条件、运输要求、温度范围均为必填' });
    }
    const ip = getClientIp(req);
    const result = createSampleTemplate(req.user!, {
      name,
      description,
      intendedReceiverId,
      storageConditions,
      shippingRequirements,
      defaultMinTemp: Number(defaultMinTemp),
      defaultMaxTemp: Number(defaultMaxTemp),
      note,
    }, ip);
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }
    res.status(201).json({ success: true, data: { template: result.template } });
  } catch (e) {
    res.status(500).json({ success: false, error: '创建模板失败' });
  }
});

router.put('/templates/:id', requireAuth, requireRole('SAMPLER' as Role, 'ADMIN' as Role), (req: AuthenticatedRequest, res: Response) => {
  try {
    const ip = getClientIp(req);
    const updates = { ...req.body };
    if (updates.defaultMinTemp !== undefined) updates.defaultMinTemp = Number(updates.defaultMinTemp);
    if (updates.defaultMaxTemp !== undefined) updates.defaultMaxTemp = Number(updates.defaultMaxTemp);
    const result = updateSampleTemplate(req.user!, req.params.id, updates, ip);
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }
    res.json({ success: true, data: { template: result.template } });
  } catch (e) {
    res.status(500).json({ success: false, error: '更新模板失败' });
  }
});

router.post('/templates/:id/deactivate', requireAuth, requireRole('SAMPLER' as Role, 'ADMIN' as Role), (req: AuthenticatedRequest, res: Response) => {
  try {
    const ip = getClientIp(req);
    const result = deactivateSampleTemplate(req.user!, req.params.id, ip);
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: '停用模板失败' });
  }
});

// ==================== Import Draft Routes ====================

router.get('/drafts', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const drafts = listImportDrafts(req.user!);
    res.json({ success: true, data: { drafts } });
  } catch (e) {
    res.status(500).json({ success: false, error: '查询草稿列表失败' });
  }
});

router.get('/drafts/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = getImportDraft(req.user!, req.params.id);
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }
    res.json({ success: true, data: { draft: result.draft } });
  } catch (e) {
    res.status(500).json({ success: false, error: '查询草稿详情失败' });
  }
});

router.get('/drafts/:id/conflict', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const clientVersion = Number(req.query.clientVersion || 0);
    const conflict = checkDraftConflict(req.params.id, clientVersion);
    res.json({ success: true, data: { conflict } });
  } catch (e) {
    res.status(500).json({ success: false, error: '检查冲突失败' });
  }
});

router.post('/drafts', requireAuth, requireRole('SAMPLER' as Role, 'ADMIN' as Role), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id, name, csvContent, templateId, parsedRows, errors, clientVersion } = req.body;
    if (!name || !csvContent) {
      return res.status(400).json({ success: false, error: '草稿名称和CSV内容不能为空' });
    }
    const ip = getClientIp(req);
    const result = saveImportDraft(req.user!, {
      id,
      name,
      csvContent,
      templateId,
      parsedRows,
      errors,
      clientVersion: clientVersion !== undefined ? Number(clientVersion) : undefined,
    }, ip);
    if (!result.success) {
      return res.status(409).json({
        success: false,
        error: result.error,
        conflict: result.conflict,
      });
    }
    res.status(201).json({ success: true, data: { draft: result.draft } });
  } catch (e) {
    res.status(500).json({ success: false, error: '保存草稿失败' });
  }
});

router.delete('/drafts/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const ip = getClientIp(req);
    const result = deleteImportDraft(req.user!, req.params.id, ip);
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: '删除草稿失败' });
  }
});

router.post('/drafts/:id/cancel', requireAuth, requireRole('SAMPLER' as Role, 'ADMIN' as Role), (req: AuthenticatedRequest, res: Response) => {
  try {
    const ip = getClientIp(req);
    const result = cancelImportDraft(req.user!, req.params.id, ip);
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: '取消草稿失败' });
  }
});

router.post('/drafts/:id/import', requireAuth, requireRole('SAMPLER' as Role, 'ADMIN' as Role), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { clientVersion } = req.body;
    if (clientVersion === undefined || clientVersion === null) {
      return res.status(400).json({ success: false, error: '必须提供客户端版本号' });
    }
    const ip = getClientIp(req);
    const result = importCsvFromDraft(req.user!, req.params.id, Number(clientVersion), ip);
    if (!result.success) {
      if (result.conflict) {
        return res.status(409).json({
          success: false,
          error: result.error,
          errors: result.errors,
          conflict: result.conflict,
        });
      }
      return res.status(400).json({
        success: false,
        error: result.error,
        errors: result.errors,
      });
    }
    res.status(201).json({
      success: true,
      data: {
        batch: result.batch,
        samples: result.samples,
        importedCount: result.importedCount,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: '提交草稿导入失败' });
  }
});

// ==================== Import with Template (Direct) ====================

router.post('/samples/import-csv-with-template', requireAuth, requireRole('SAMPLER' as Role, 'ADMIN' as Role), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { csvContent, templateId } = req.body;
    if (!csvContent || typeof csvContent !== 'string') {
      return res.status(400).json({ success: false, error: '必须提供 CSV 内容' });
    }
    const ip = getClientIp(req);

    let templateSnapshot = undefined;
    if (templateId) {
      const template = getSampleTemplate(templateId);
      if (!template) {
        return res.status(400).json({ success: false, error: '所选模板不存在' });
      }
      if (!template.isActive) {
        return res.status(400).json({ success: false, error: '所选模板已停用' });
      }
      templateSnapshot = createTemplateSnapshot(template);
    }

    const result = importCsvSamplesWithTemplate(req.user!, csvContent, templateSnapshot, templateId, ip);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error,
        errors: result.errors,
      });
    }
    res.status(201).json({
      success: true,
      data: {
        batch: result.batch,
        samples: result.samples,
        importedCount: result.importedCount,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: 'CSV 导入失败' });
  }
});

// ==================== Import Undo Routes ====================

router.get('/import-undo/last', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = getLastImportUndoRecord(req.user!);
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }
    res.json({ success: true, data: { record: result.record } });
  } catch (e) {
    res.status(500).json({ success: false, error: '查询可撤销记录失败' });
  }
});

router.get('/import-undo', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const records = listImportUndoRecords(req.user!);
    res.json({ success: true, data: { records } });
  } catch (e) {
    res.status(500).json({ success: false, error: '查询撤销记录失败' });
  }
});

router.post('/import-undo/undo', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const ip = getClientIp(req);
    const result = undoLastImport(req.user!, ip);
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }
    res.json({ success: true, data: { undoneData: result.undoneData } });
  } catch (e) {
    res.status(500).json({ success: false, error: '撤销导入失败' });
  }
});

// ==================== Import Notification Center Routes ====================

router.get('/notifications', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const filters: {
      type?: ImportNotificationType;
      status?: ImportNotificationStatus;
      batchId?: string;
      draftId?: string;
      templateId?: string;
      operatorId?: string;
      rolledBack?: boolean;
      startTime?: number;
      endTime?: number;
    } = {};

    if (req.query.type) filters.type = req.query.type as ImportNotificationType;
    if (req.query.status) filters.status = req.query.status as ImportNotificationStatus;
    if (req.query.batchId) filters.batchId = req.query.batchId as string;
    if (req.query.draftId) filters.draftId = req.query.draftId as string;
    if (req.query.templateId) filters.templateId = req.query.templateId as string;
    if (req.query.operatorId && req.user!.role === 'ADMIN') {
      filters.operatorId = req.query.operatorId as string;
    }
    if (req.query.rolledBack !== undefined) filters.rolledBack = req.query.rolledBack === 'true';
    if (req.query.startTime) filters.startTime = Number(req.query.startTime);
    if (req.query.endTime) filters.endTime = Number(req.query.endTime);

    const result = listImportNotifications(req.user!, filters);
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, error: '查询通知列表失败' });
  }
});

router.get('/notifications/stats', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const stats = getNotificationStats(req.user!);
    res.json({ success: true, data: { stats } });
  } catch (e) {
    res.status(500).json({ success: false, error: '查询通知统计失败' });
  }
});

router.get('/notifications/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = getImportNotification(req.user!, req.params.id);
    if (result.notFound) {
      return res.status(404).json({ success: false, error: result.error });
    }
    if (!result.success) {
      return res.status(403).json({ success: false, error: result.error });
    }
    res.json({ success: true, data: { notification: result.notification } });
  } catch (e) {
    res.status(500).json({ success: false, error: '查询通知详情失败' });
  }
});

router.get('/notifications/:id/detail', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = getNotificationDetailWithTimeline(req.user!, req.params.id);
    if (result.notFound) {
      return res.status(404).json({ success: false, error: result.error });
    }
    if (!result.success) {
      return res.status(403).json({ success: false, error: result.error });
    }
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, error: '查询通知详情失败' });
  }
});

router.post('/notifications/:id/read', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = markNotificationAsRead(req.user!, req.params.id);
    if (result.notFound) {
      return res.status(404).json({ success: false, error: result.error });
    }
    if (!result.success) {
      return res.status(403).json({ success: false, error: result.error });
    }
    res.json({ success: true, data: { read: result.read, readAt: result.readAt } });
  } catch (e) {
    res.status(500).json({ success: false, error: '标记已读失败' });
  }
});

router.post('/notifications/read-all', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = markAllNotificationsAsRead(req.user!);
    res.json({ success: true, data: { readCount: result.markedCount } });
  } catch (e) {
    res.status(500).json({ success: false, error: '标记全部已读失败' });
  }
});

export default router;
