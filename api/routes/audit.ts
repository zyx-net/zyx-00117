import { Router, type Response } from 'express';
import type { AuthenticatedRequest } from '../middleware.js';
import { requireAuth, requireRole, getClientIp } from '../middleware.js';
import { queryAudits } from '../audit.js';
import { createAudit } from '../audit.js';
import { listBatches, listSamples, getBatchDetail, getExportConfig } from '../services.js';
import { createImportNotification } from '../services.js';
import type { AuditEntry, Role, Sample, Batch } from '../types.js';

const router = Router();

router.get('/audits', requireAuth, requireRole('ADMIN' as Role), (req: AuthenticatedRequest, res: Response) => {
  try {
    const filters: Record<string, string | number | boolean> = {};
    if (req.query.targetType) filters.targetType = req.query.targetType as AuditEntry['targetType'];
    if (req.query.targetId) filters.targetId = req.query.targetId as string;
    if (req.query.action) filters.action = req.query.action as string;
    if (req.query.operatorId) filters.operatorId = req.query.operatorId as string;
    if (req.query.startTime) filters.startTime = Number(req.query.startTime);
    if (req.query.endTime) filters.endTime = Number(req.query.endTime);
    if (req.query.success !== undefined) filters.success = req.query.success === 'true';

    const audits = queryAudits(filters);
    res.json({ success: true, data: { audits } });
  } catch (e) {
    res.status(500).json({ success: false, error: '查询审计日志失败' });
  }
});

function formatDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildCsvRows(rows: string[][]): string {
  return rows.map((r) => r.map(escapeCsv).join(',')).join('\r\n');
}

router.get('/export/batches', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    let filters: Record<string, string | number> = {};
    let includeSignoffHistory = true;
    let includeTempAlerts = true;
    let includeFailureAudit = false;
    let configName: string | undefined;

    if (req.query.configId) {
      const config = getExportConfig(req.query.configId as string);
      if (config) {
        filters = { ...config.filters } as Record<string, string | number>;
        includeSignoffHistory = config.includeSignoffHistory;
        includeTempAlerts = config.includeTempAlerts;
        includeFailureAudit = config.includeFailureAudit;
        configName = config.name;
      }
    }

    if (req.query.status) filters.status = req.query.status as string;
    if (req.query.createdBy) filters.createdBy = req.query.createdBy as string;
    if (req.query.receiverId) filters.receiverId = req.query.receiverId as string;
    if (req.query.keyword) filters.keyword = req.query.keyword as string;
    if (req.query.startTime) filters.startTime = Number(req.query.startTime);
    if (req.query.endTime) filters.endTime = Number(req.query.endTime);
    if (req.query.includeSignoffHistory !== undefined) includeSignoffHistory = req.query.includeSignoffHistory === 'true';
    if (req.query.includeTempAlerts !== undefined) includeTempAlerts = req.query.includeTempAlerts === 'true';
    if (req.query.includeFailureAudit !== undefined) includeFailureAudit = req.query.includeFailureAudit === 'true';

    const user = req.user!;
    if (user.role === 'SAMPLER') {
      filters.createdBy = user.id;
    } else if (user.role === 'RECEIVER') {
      filters.receiverId = user.id;
    }

    const { batches } = listBatches(filters);
    const allSampleDetails: Array<{ batch: Batch & { sampleCount: number }; samples: Sample[] }> = [];
    for (const b of batches) {
      const detail = getBatchDetail(b.id);
      if (detail) {
        allSampleDetails.push({ batch: b as Batch & { sampleCount: number }, samples: detail.samples });
      }
    }

    const batchRows: string[][] = [];
    batchRows.push([
      '批次编号',
      '创建时间',
      '创建人',
      '状态',
      '样本总数',
      '已签收数',
      '已退回数',
      '已作废数',
      '指定接收人',
      '发起交接时间',
      '签收时间',
      '备注',
    ]);

    for (const b of batches) {
      batchRows.push([
        b.batchCode,
        formatDate(b.createdAt),
        b.creatorName,
        b.status,
        String(b.sampleCount),
        String(b.receivedCount),
        String(b.returnedCount),
        String(b.voidedCount),
        b.intendedReceiverName || '',
        b.initiatedAt ? formatDate(b.initiatedAt) : '',
        b.receivedAt ? formatDate(b.receivedAt) : '',
        b.note || '',
      ]);
    }

    const sampleRows: string[][] = [];
    sampleRows.push([
      '批次编号',
      '样本编号',
      '样本类型',
      '描述',
      '采样地点',
      '采样时间',
      '采样人',
      '当前保管人',
      '状态',
      '温度范围(最小)',
      '温度范围(最大)',
      '最近温度值',
      '最近温度记录时间',
      '温控异常数量',
      '未解决异常',
      '交接链节点数',
    ]);

    for (const { batch, samples } of allSampleDetails) {
      for (const s of samples) {
        const unresolvedAlerts = s.temperatureAlerts.filter((a) => !a.resolved).length;
        const lastTemp = s.temperatureRecords[0];
        sampleRows.push([
          batch.batchCode,
          s.sampleCode,
          s.type,
          s.description,
          s.sourceLocation,
          formatDate(s.collectedAt),
          s.collectorName,
          s.currentHolderName,
          s.status,
          String(s.minTemp),
          String(s.maxTemp),
          lastTemp ? String(lastTemp.temperature) : '',
          lastTemp ? formatDate(lastTemp.timestamp) : '',
          String(s.temperatureAlerts.length),
          String(unresolvedAlerts),
          String(s.handoverChain.length),
        ]);
      }
    }

    let csvContent = '';

    const now = Date.now();
    const header = `# 实验室样本交接数据导出\r\n# 导出时间: ${formatDate(now)}\r\n# 导出人: ${user.name} (${user.role})\r\n# 筛选条件: ${JSON.stringify(filters)}\r\n${configName ? `# 导出配置: ${configName}\r\n` : ''}# -----\r\n\r\n`;

    csvContent += header;
    csvContent += '## 批次列表\r\n' + buildCsvRows(batchRows) + '\r\n\r\n';
    csvContent += '## 样本明细\r\n' + buildCsvRows(sampleRows) + '\r\n\r\n';

    if (includeTempAlerts) {
      const tempRows: string[][] = [];
      tempRows.push([
        '批次编号',
        '样本编号',
        '记录时间',
        '温度值',
        '记录地点',
        '记录人',
        '是否异常',
        '异常类型',
        '阈值',
        '备注',
      ]);

      for (const { batch, samples } of allSampleDetails) {
        for (const s of samples) {
          const alertMap = new Map(s.temperatureAlerts.map((a) => [a.recordId, a]));
          for (const t of s.temperatureRecords) {
            const alert = alertMap.get(t.id);
            tempRows.push([
              batch.batchCode,
              s.sampleCode,
              formatDate(t.timestamp),
              String(t.temperature),
              t.location,
              t.recordedBy,
              alert ? '是' : '否',
              alert ? alert.type : '',
              alert ? String(alert.threshold) : '',
              t.note || '',
            ]);
          }
        }
      }
      csvContent += '## 温控记录\r\n' + buildCsvRows(tempRows) + '\r\n\r\n';
    }

    if (includeSignoffHistory) {
      const chainRows: string[][] = [];
      chainRows.push([
        '批次编号',
        '样本编号',
        '节点时间',
        '动作类型',
        '转出人',
        '转入人',
        '退回原因',
        '备注',
      ]);

      for (const { batch, samples } of allSampleDetails) {
        for (const s of samples) {
          for (const c of s.handoverChain) {
            chainRows.push([
              batch.batchCode,
              s.sampleCode,
              formatDate(c.timestamp),
              c.action,
              c.fromUserName,
              c.toUserName || '',
              c.returnReason || '',
              c.note || '',
            ]);
          }
        }
      }
      csvContent += '## 交接链历史\r\n' + buildCsvRows(chainRows) + '\r\n\r\n';
    }

    if (includeFailureAudit) {
      const { audits } = { audits: queryAudits({ success: false }) };
      const auditRows: string[][] = [];
      auditRows.push([
        '审计ID',
        '时间',
        '操作',
        '操作者',
        '目标类型',
        '目标ID',
        '失败原因',
      ]);
      for (const a of audits) {
        auditRows.push([
          a.id,
          formatDate(a.timestamp),
          a.action,
          a.operatorName,
          a.targetType,
          a.targetId,
          a.failureReason || '',
        ]);
      }
      csvContent += '## 失败审计记录\r\n' + buildCsvRows(auditRows) + '\r\n\r\n';
    }

    const ip = getClientIp(req);
    createAudit(user, 'EXPORT_BATCHES', 'SYSTEM', 'export', true, {
      afterState: {
        filters,
        configName,
        includeSignoffHistory,
        includeTempAlerts,
        includeFailureAudit,
        batchCount: batches.length,
      },
      ipAddress: ip,
    });

    createImportNotification(user, 'EXPORT_SUCCESS', {
      message: `批次导出完成，共 ${batches.length} 条批次记录`,
      result: {
        exportType: 'batches',
        batchCount: batches.length,
        configName,
        filters,
      },
    });

    const filename = `labs_export_${new Date(now).toISOString().slice(0, 10)}_${now}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.end('\uFEFF' + csvContent);
  } catch (e) {
    res.status(500).json({ success: false, error: '导出失败' });
  }
});

router.get('/export/samples', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    let filters: Record<string, string | boolean> = {};
    let includeSignoffHistory = true;
    let includeTempAlerts = true;
    let includeFailureAudit = false;
    let configName: string | undefined;

    if (req.query.configId) {
      const config = getExportConfig(req.query.configId as string);
      if (config) {
        filters = { ...config.filters } as Record<string, string | boolean>;
        includeSignoffHistory = config.includeSignoffHistory;
        includeTempAlerts = config.includeTempAlerts;
        includeFailureAudit = config.includeFailureAudit;
        configName = config.name;
      }
    }

    if (req.query.batchId) filters.batchId = req.query.batchId as string;
    if (req.query.status) filters.status = req.query.status as string;
    if (req.query.holderId) filters.holderId = req.query.holderId as string;
    if (req.query.keyword) filters.keyword = req.query.keyword as string;
    if (req.query.hasAlert !== undefined) filters.hasAlert = req.query.hasAlert === 'true';
    if (req.query.includeSignoffHistory !== undefined) includeSignoffHistory = req.query.includeSignoffHistory === 'true';
    if (req.query.includeTempAlerts !== undefined) includeTempAlerts = req.query.includeTempAlerts === 'true';
    if (req.query.includeFailureAudit !== undefined) includeFailureAudit = req.query.includeFailureAudit === 'true';

    const { samples } = listSamples(filters);

    let csvContent = '';
    const user = req.user!;
    const now = Date.now();
    const header = `# 样本列表导出\r\n# 导出时间: ${formatDate(now)}\r\n# 导出人: ${user.name}\r\n# 筛选条件: ${JSON.stringify(filters)}\r\n${configName ? `# 导出配置: ${configName}\r\n` : ''}\r\n`;

    csvContent += header;

    const rows: string[][] = [];
    rows.push([
      '样本编号',
      '批次编号',
      '类型',
      '描述',
      '来源地点',
      '采样时间',
      '采样人',
      '当前保管人',
      '状态',
      '最小温度',
      '最大温度',
      '温控记录数',
      '未解决异常数',
      '作废原因',
    ]);
    for (const s of samples) {
      const batchCode = 'BATCH-' + s.batchId.split('-').slice(-2).join('');
      rows.push([
        s.sampleCode,
        batchCode,
        s.type,
        s.description,
        s.sourceLocation,
        formatDate(s.collectedAt),
        s.collectorName,
        s.currentHolderName,
        s.status,
        String(s.minTemp),
        String(s.maxTemp),
        String(s.temperatureRecords.length),
        String(s.temperatureAlerts.filter((a) => !a.resolved).length),
        s.voidReason || '',
      ]);
    }
    csvContent += buildCsvRows(rows) + '\r\n\r\n';

    if (includeTempAlerts) {
      const alertRows: string[][] = [];
      alertRows.push([
        '样本编号',
        '异常类型',
        '阈值',
        '实际值',
        '时间',
        '是否处理',
      ]);
      for (const s of samples) {
        for (const a of s.temperatureAlerts) {
          alertRows.push([
            s.sampleCode,
            a.type,
            String(a.threshold),
            a.actualValue != null ? String(a.actualValue) : '',
            formatDate(a.timestamp),
            a.resolved ? '已处理' : '待处理',
          ]);
        }
      }
      csvContent += '## 温控异常记录\r\n' + buildCsvRows(alertRows) + '\r\n\r\n';
    }

    if (includeSignoffHistory) {
      const chainRows: string[][] = [];
      chainRows.push([
        '样本编号',
        '节点时间',
        '动作类型',
        '转出人',
        '转入人',
        '备注',
      ]);
      for (const s of samples) {
        for (const c of s.handoverChain) {
          chainRows.push([
            s.sampleCode,
            formatDate(c.timestamp),
            c.action,
            c.fromUserName,
            c.toUserName || '',
            c.note || '',
          ]);
        }
      }
      csvContent += '## 交接链历史\r\n' + buildCsvRows(chainRows) + '\r\n\r\n';
    }

    if (includeFailureAudit) {
      const { audits } = { audits: queryAudits({ success: false }) };
      const auditRows: string[][] = [];
      auditRows.push([
        '审计ID',
        '时间',
        '操作',
        '操作者',
        '目标类型',
        '目标ID',
        '失败原因',
      ]);
      for (const a of audits) {
        auditRows.push([
          a.id,
          formatDate(a.timestamp),
          a.action,
          a.operatorName,
          a.targetType,
          a.targetId,
          a.failureReason || '',
        ]);
      }
      csvContent += '## 失败审计记录\r\n' + buildCsvRows(auditRows) + '\r\n\r\n';
    }

    const ip = getClientIp(req);
    createAudit(user, 'EXPORT_SAMPLES', 'SYSTEM', 'export', true, {
      afterState: {
        filters,
        configName,
        includeSignoffHistory,
        includeTempAlerts,
        includeFailureAudit,
        sampleCount: samples.length,
      },
      ipAddress: ip,
    });

    createImportNotification(user, 'EXPORT_SUCCESS', {
      message: `样本导出完成，共 ${samples.length} 条样本记录`,
      result: {
        exportType: 'samples',
        sampleCount: samples.length,
        configName,
        filters,
      },
    });

    const filename = `samples_export_${new Date(now).toISOString().slice(0, 10)}_${now}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.end('\uFEFF' + csvContent);
  } catch (e) {
    res.status(500).json({ success: false, error: '导出失败' });
  }
});

export default router;
