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
} from '../services.js';
import type { Role } from '../types.js';

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

export default router;
