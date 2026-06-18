import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api';
import { useAppStore } from '@/store';
import type { Batch } from '@/types';
import {
  BATCH_STATUS_LABELS,
  BATCH_STATUS_COLORS,
  formatDate,
} from '@/types';
import {
  Search,
  Filter,
  Download,
  Clock,
  X,
} from 'lucide-react';

const BATCH_STATUS_OPTIONS = [
  '', 'DRAFT', 'PENDING', 'IN_TRANSIT', 'PARTIAL_RECEIVED', 'FULLY_RECEIVED', 'RETURNED', 'VOIDED',
] as const;

export default function BatchList() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Batch[]>([]);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<string>('');
  const [receiverId, setReceiverId] = useState('');
  const user = useAppStore((s) => s.user);
  const showToast = useAppStore((s) => s.showToast);
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const [appliedStatus, setAppliedStatus] = useState('');
  const [appliedReceiver, setAppliedReceiver] = useState('');

  useEffect(() => {
    load();
  }, [appliedKeyword, appliedStatus, appliedReceiver]);

  async function load() {
    setLoading(true);
    const filters: Record<string, string> = {};
    if (appliedKeyword) filters.keyword = appliedKeyword;
    if (appliedStatus) filters.status = appliedStatus;
    if (appliedReceiver) filters.receiverId = appliedReceiver;
    const r = await api.listBatches(filters);
    if (r.success && r.data) setItems(r.data.batches);
    setLoading(false);
  }

  function apply() {
    setAppliedKeyword(keyword);
    setAppliedStatus(status);
    setAppliedReceiver(receiverId);
  }

  function reset() {
    setKeyword('');
    setStatus('');
    setReceiverId('');
    setAppliedKeyword('');
    setAppliedStatus('');
    setAppliedReceiver('');
  }

  function doExport() {
    const filters: Record<string, string> = {};
    if (appliedKeyword) filters.keyword = appliedKeyword;
    if (appliedStatus) filters.status = appliedStatus;
    if (appliedReceiver) filters.receiverId = appliedReceiver;
    const url = api.buildExportUrl('batches', filters);
    window.open(url, '_blank');
    showToast('已开始导出，与当前筛选条件一致', 'success');
  }

  const stats = useMemo(() => {
    const s: Record<string, number> = {};
    items.forEach((b) => {
      s[b.status] = (s[b.status] || 0) + 1;
    });
    return s;
  }, [items]);

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">批次查询</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              可按批次编号、状态筛选，支持导出与筛选条件一致的完整数据
            </p>
          </div>
          <div className="flex gap-4 text-sm">
            {Object.entries(BATCH_STATUS_LABELS).map(([k, v]) => (
              <div key={k} className="text-center">
                <div className="text-xl font-bold text-slate-800">{stats[k] || 0}</div>
                <div className="text-xs text-slate-500">{v}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs text-slate-500 mb-1">关键字</label>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && apply()}
                placeholder="批次号/创建人/接收人"
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-400 outline-none text-sm"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">批次状态</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-400 outline-none text-sm bg-white"
            >
              {BATCH_STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s ? BATCH_STATUS_LABELS[s as Batch['status']] : '全部状态'}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-slate-500 mb-1">&nbsp;</label>
            <div className="flex gap-2">
              <button
                onClick={apply}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 transition"
              >
                <Filter className="w-4 h-4" /> 查询
              </button>
              <button
                onClick={reset}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-200 text-slate-600 text-sm hover:bg-slate-50 transition"
              >
                <X className="w-4 h-4" /> 重置
              </button>
              <div className="flex-1" />
              <button
                onClick={doExport}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm hover:bg-emerald-700 transition"
              >
                <Download className="w-4 h-4" /> 导出 CSV
              </button>
            </div>
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
                  <th className="px-5 py-3 text-left font-medium">批次编号</th>
                  <th className="px-5 py-3 text-left font-medium">创建人</th>
                  <th className="px-5 py-3 text-left font-medium">创建时间</th>
                  <th className="px-5 py-3 text-left font-medium">接收人</th>
                  <th className="px-5 py-3 text-center font-medium">数量</th>
                  <th className="px-5 py-3 text-center font-medium">已签收</th>
                  <th className="px-5 py-3 text-center font-medium">已退回</th>
                  <th className="px-5 py-3 text-center font-medium">已作废</th>
                  <th className="px-5 py-3 text-center font-medium">状态</th>
                  <th className="px-5 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-5 py-16 text-center text-slate-400">
                      暂无批次数据
                    </td>
                  </tr>
                ) : (
                  items.map((b) => (
                    <tr key={b.id} className="hover:bg-slate-50/70">
                      <td className="px-5 py-3">
                        <Link to={`/batches/${b.id}`} className="font-medium text-blue-600 hover:text-blue-700">
                          {b.batchCode}
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-slate-700">{b.creatorName}</td>
                      <td className="px-5 py-3 text-slate-500">{formatDate(b.createdAt)}</td>
                      <td className="px-5 py-3 text-slate-700">{b.intendedReceiverName || '-'}</td>
                      <td className="px-5 py-3 text-center">{b.sampleCount || 0}</td>
                      <td className="px-5 py-3 text-center text-emerald-600 font-medium">{b.receivedCount || 0}</td>
                      <td className="px-5 py-3 text-center text-orange-600 font-medium">{b.returnedCount || 0}</td>
                      <td className="px-5 py-3 text-center text-red-600 font-medium">{b.voidedCount || 0}</td>
                      <td className="px-5 py-3 text-center">
                        <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium border ${BATCH_STATUS_COLORS[b.status]}`}>
                          {BATCH_STATUS_LABELS[b.status]}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <Link to={`/batches/${b.id}`} className="text-blue-600 hover:text-blue-700 font-medium">
                          查看
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {user?.role === 'RECEIVER' && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          💡 提示：只有被指定为接收人的账号才能签收，禁止替其他接收员签收。
        </div>
      )}
    </div>
  );
}
