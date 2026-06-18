import { useEffect, useState } from 'react';
import { api } from '@/api';
import { useAppStore } from '@/store';
import type { AuditEntry } from '@/types';
import { formatDate } from '@/types';
import {
  Search,
  Filter,
  Clock,
  X,
  CheckCircle2,
  XCircle,
} from 'lucide-react';

const ACTIONS = [
  '', 'LOGIN', 'LOGIN_FAILED', 'LOGOUT',
  'REGISTER_SAMPLES', 'INITIATE_HANDOVER', 'RECEIVE_BATCH',
  'RETURN_BATCH', 'RE_HANDOVER', 'VOID_BATCH',
  'ADD_TEMPERATURE', 'RESOLVE_ALERT',
  'CSV_IMPORT', 'CREATE_EXPORT_CONFIG', 'UPDATE_EXPORT_CONFIG',
  'DELETE_EXPORT_CONFIG', 'EXPORT_BATCHES', 'EXPORT_SAMPLES',
] as const;

const TARGET_TYPES = ['', 'SAMPLE', 'BATCH', 'USER', 'SYSTEM'] as const;

const ACTION_LABELS: Record<string, string> = {
  LOGIN: '登录',
  LOGIN_FAILED: '登录失败',
  LOGOUT: '登出',
  REGISTER_SAMPLES: '登记样本',
  INITIATE_HANDOVER: '发起交接',
  RECEIVE_BATCH: '签收批次',
  RETURN_BATCH: '退回样本',
  RE_HANDOVER: '重新交接',
  VOID_BATCH: '作废批次',
  ADD_TEMPERATURE: '添加温控',
  RESOLVE_ALERT: '处理告警',
  CSV_IMPORT: 'CSV导入',
  CREATE_EXPORT_CONFIG: '创建导出配置',
  UPDATE_EXPORT_CONFIG: '修改导出配置',
  DELETE_EXPORT_CONFIG: '删除导出配置',
  EXPORT_BATCHES: '导出批次',
  EXPORT_SAMPLES: '导出样本',
};

export default function AuditLog() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<AuditEntry[]>([]);
  const [action, setAction] = useState('');
  const [targetType, setTargetType] = useState('');
  const [operatorId, setOperatorId] = useState('');
  const [successOnly, setSuccessOnly] = useState<boolean | undefined>(undefined);
  const [applied, setApplied] = useState({ action: '', targetType: '', operatorId: '', successOnly: undefined as boolean | undefined });
  const showToast = useAppStore((s) => s.showToast);

  useEffect(() => {
    load();
  }, [applied]);

  async function load() {
    setLoading(true);
    const filters: Record<string, string | boolean> = {};
    if (applied.action) filters.action = applied.action;
    if (applied.targetType) filters.targetType = applied.targetType;
    if (applied.operatorId) filters.operatorId = applied.operatorId;
    if (applied.successOnly !== undefined) filters.success = applied.successOnly;
    const r = await api.listAudits(filters);
    if (r.success && r.data) setItems(r.data.audits);
    setLoading(false);
  }

  function doExport() {
    showToast('审计日志导出请使用浏览器打印功能', 'info');
  }

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">审计历史</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            管理员权限，记录所有操作、操作者、目标、前后状态与失败原因
          </p>
        </div>

        <div className="mt-5 grid grid-cols-1 md:grid-cols-6 gap-3">
          <div>
            <label className="block text-xs text-slate-500 mb-1">操作类型</label>
            <select
              value={action}
              onChange={(e) => setAction(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-400 outline-none text-sm bg-white"
            >
              {ACTIONS.map((a) => (
                <option key={a} value={a}>{a ? ACTION_LABELS[a] || a : '全部'}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">目标类型</label>
            <select
              value={targetType}
              onChange={(e) => setTargetType(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-400 outline-none text-sm bg-white"
            >
              {TARGET_TYPES.map((t) => (
                <option key={t} value={t}>{t || '全部'}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">操作者ID</label>
            <input
              value={operatorId}
              onChange={(e) => setOperatorId(e.target.value)}
              placeholder="可留空"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-400 outline-none text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">结果</label>
            <select
              value={successOnly === undefined ? '' : String(successOnly)}
              onChange={(e) => setSuccessOnly(e.target.value === '' ? undefined : e.target.value === 'true')}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-400 outline-none text-sm bg-white"
            >
              <option value="">全部</option>
              <option value="true">成功</option>
              <option value="false">失败</option>
            </select>
          </div>
          <div className="md:col-span-2 flex gap-2 items-end">
            <button onClick={() => setApplied({ action, targetType, operatorId, successOnly })}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 transition">
              <Filter className="w-4 h-4" /> 查询
            </button>
            <button onClick={() => {
              setAction(''); setTargetType(''); setOperatorId(''); setSuccessOnly(undefined);
              setApplied({ action: '', targetType: '', operatorId: '', successOnly: undefined });
            }}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-200 text-slate-600 text-sm hover:bg-slate-50 transition">
              <X className="w-4 h-4" /> 重置
            </button>
            <div className="flex-1" />
            <button onClick={doExport}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-600 text-white text-sm hover:bg-slate-700 transition">
              打印
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-64 text-slate-500">
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5 animate-spin" />
              加载中...
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 text-left font-medium w-40">时间</th>
                  <th className="px-4 py-3 text-left font-medium">操作</th>
                  <th className="px-4 py-3 text-left font-medium">操作者</th>
                  <th className="px-4 py-3 text-left font-medium">目标类型</th>
                  <th className="px-4 py-3 text-left font-medium">目标ID</th>
                  <th className="px-4 py-3 text-center font-medium w-20">结果</th>
                  <th className="px-4 py-3 text-left font-medium">失败原因/详情</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-16 text-center text-slate-400">
                      暂无审计记录
                    </td>
                  </tr>
                ) : (
                  items.map((a) => (
                    <tr key={a.id} className={`${!a.success ? 'bg-red-50/40' : ''} hover:bg-slate-50/70`}>
                      <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{formatDate(a.timestamp)}</td>
                      <td className="px-4 py-3 font-medium text-slate-800">
                        {ACTION_LABELS[a.action] || a.action}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{a.operatorName}</td>
                      <td className="px-4 py-3 text-slate-600">{a.targetType}</td>
                      <td className="px-4 py-3 text-slate-600 text-xs font-mono truncate max-w-40" title={a.targetId}>
                        {a.targetId.slice(0, 24)}...
                      </td>
                      <td className="px-4 py-3 text-center">
                        {a.success ? (
                          <span className="inline-flex items-center gap-1 text-emerald-600">
                            <CheckCircle2 className="w-4 h-4" />
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-red-600" title={a.failureReason}>
                            <XCircle className="w-4 h-4" />
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {a.failureReason && (
                          <span className="text-red-600">{a.failureReason}</span>
                        )}
                        {!a.failureReason && a.afterState && (
                          <details className="text-slate-500">
                            <summary className="cursor-pointer hover:text-slate-700">查看变更</summary>
                            <pre className="mt-2 p-2 bg-slate-50 rounded text-xs overflow-x-auto max-w-xl">
                              {JSON.stringify(a.afterState, null, 2)}
                            </pre>
                          </details>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
