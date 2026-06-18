import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api';
import { useAppStore } from '@/store';
import type { Sample, SampleStatus } from '@/types';
import {
  STATUS_LABELS,
  STATUS_COLORS,
  formatDate,
} from '@/types';
import {
  Search,
  Filter,
  Download,
  Clock,
  X,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';

const STATUS_OPTIONS: (SampleStatus | '')[] = [
  '', 'REGISTERED', 'PENDING_HANDOVER', 'IN_TRANSIT', 'RECEIVED', 'RETURNED', 'VOIDED',
];

export default function SampleList() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Sample[]>([]);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<string>('');
  const [holderId, setHolderId] = useState('');
  const [onlyAlert, setOnlyAlert] = useState(false);
  const showToast = useAppStore((s) => s.showToast);
  const [applied, setApplied] = useState({ keyword: '', status: '', holderId: '', onlyAlert: false });

  useEffect(() => {
    load();
  }, [applied]);

  async function load() {
    setLoading(true);
    const filters: Record<string, string | boolean> = {};
    if (applied.keyword) filters.keyword = applied.keyword;
    if (applied.status) filters.status = applied.status;
    if (applied.holderId) filters.holderId = applied.holderId;
    if (applied.onlyAlert) filters.hasAlert = true;
    const r = await api.listSamples(filters);
    if (r.success && r.data) setItems(r.data.samples);
    setLoading(false);
  }

  function apply() {
    setApplied({ keyword, status, holderId, onlyAlert });
  }

  function reset() {
    setKeyword('');
    setStatus('');
    setHolderId('');
    setOnlyAlert(false);
    setApplied({ keyword: '', status: '', holderId: '', onlyAlert: false });
  }

  function doExport() {
    const filters: Record<string, string> = {};
    if (applied.keyword) filters.keyword = applied.keyword;
    if (applied.status) filters.status = applied.status;
    if (applied.holderId) filters.holderId = applied.holderId;
    if (applied.onlyAlert) filters.hasAlert = 'true';
    const url = api.buildExportUrl('samples', filters);
    window.open(url, '_blank');
    showToast('已开始导出', 'success');
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
            <h2 className="text-lg font-semibold text-slate-800">样本追溯</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              追踪每个样本的当前保管人、状态、温控记录和完整交接链
            </p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 md:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs text-slate-500 mb-1">关键字</label>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && apply()}
                placeholder="编号/类型/保管人"
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-400 outline-none text-sm"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">样本状态</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-400 outline-none text-sm bg-white"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s ? STATUS_LABELS[s as SampleStatus] : '全部状态'}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">保管人ID</label>
            <input
              value={holderId}
              onChange={(e) => setHolderId(e.target.value)}
              placeholder="可留空"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-400 outline-none text-sm"
            />
          </div>
          <div className="flex items-end pb-1.5">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={onlyAlert}
                onChange={(e) => setOnlyAlert(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-red-600 focus:ring-red-400"
              />
              <span className="text-slate-700">仅看温控异常</span>
            </label>
          </div>
          <div className="flex gap-2 items-end">
            <button onClick={apply}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 transition">
              <Filter className="w-4 h-4" /> 查询
            </button>
            <button onClick={reset}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-200 text-slate-600 text-sm hover:bg-slate-50 transition">
              <X className="w-4 h-4" /> 重置
            </button>
            <button onClick={doExport}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm hover:bg-emerald-700 transition">
              <Download className="w-4 h-4" /> 导出
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-3 text-xs">
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <div key={k} className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-slate-50">
              <span className={`inline-block w-2 h-2 rounded-full ${k === 'REGISTERED' ? 'bg-slate-400' :
                k === 'IN_TRANSIT' ? 'bg-blue-500' :
                k === 'RECEIVED' ? 'bg-emerald-500' :
                k === 'RETURNED' ? 'bg-orange-500' :
                k === 'VOIDED' ? 'bg-red-500' : 'bg-amber-500'}`}></span>
              <span className="text-slate-600">{v}</span>
              <span className="font-semibold text-slate-800">{stats[k] || 0}</span>
            </div>
          ))}
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
                  <th className="px-4 py-3 text-left font-medium">样本编号</th>
                  <th className="px-4 py-3 text-left font-medium">类型</th>
                  <th className="px-4 py-3 text-left font-medium">采样人</th>
                  <th className="px-4 py-3 text-left font-medium">当前保管人</th>
                  <th className="px-4 py-3 text-center font-medium">温度</th>
                  <th className="px-4 py-3 text-center font-medium">状态</th>
                  <th className="px-4 py-3 text-center font-medium">温控异常</th>
                  <th className="px-4 py-3 text-left font-medium">更新时间</th>
                  <th className="px-4 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-16 text-center text-slate-400">
                      暂无符合条件的样本
                    </td>
                  </tr>
                ) : (
                  items.map((s) => {
                    const lastT = s.temperatureRecords[0];
                    const unres = s.temperatureAlerts.filter((a) => !a.resolved).length;
                    return (
                      <tr key={s.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3">
                          <Link to={`/samples/${s.id}`} className="font-medium text-blue-600 hover:text-blue-700">
                            {s.sampleCode}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-slate-700">{s.type}</td>
                        <td className="px-4 py-3 text-slate-600">{s.collectorName}</td>
                        <td className="px-4 py-3 text-slate-700">{s.currentHolderName}</td>
                        <td className="px-4 py-3 text-center">
                          {lastT ? (
                            <span className={`font-medium ${
                              lastT.temperature < s.minTemp || lastT.temperature > s.maxTemp
                                ? 'text-red-600'
                                : 'text-slate-700'
                            }`}>
                              {lastT.temperature}℃
                            </span>
                          ) : (
                            <span className="text-xs text-red-500">缺失</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium border ${STATUS_COLORS[s.status]}`}>
                            {STATUS_LABELS[s.status]}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {unres > 0 ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                              <AlertTriangle className="w-3 h-3" />
                              {unres}
                            </span>
                          ) : (
                            <CheckCircle2 className="w-4 h-4 text-emerald-500 mx-auto" />
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-500 text-xs">{formatDate(s.updatedAt)}</td>
                        <td className="px-4 py-3 text-right">
                          <Link to={`/samples/${s.id}`} className="text-blue-600 hover:text-blue-700 font-medium">
                            追溯
                          </Link>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
