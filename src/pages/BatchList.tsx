import { useEffect, useState, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api';
import { useAppStore } from '@/store';
import type { Batch, ExportConfig, CsvImportError } from '@/types';
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
  Upload,
  Settings2,
  Trash2,
  Save,
  ChevronDown,
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

  const [showImport, setShowImport] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importErrors, setImportErrors] = useState<CsvImportError[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const [showExportConfig, setShowExportConfig] = useState(false);
  const [exportConfigs, setExportConfigs] = useState<ExportConfig[]>([]);
  const [selectedConfigId, setSelectedConfigId] = useState<string>('');
  const [newConfigName, setNewConfigName] = useState('');
  const [newConfigSignoff, setNewConfigSignoff] = useState(true);
  const [newConfigTempAlerts, setNewConfigTempAlerts] = useState(true);
  const [newConfigFailureAudit, setNewConfigFailureAudit] = useState(false);

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

  async function loadExportConfigs() {
    const r = await api.listExportConfigs('batches');
    if (r.success && r.data) setExportConfigs(r.data.configs);
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
    const url = api.buildExportUrl('batches', filters, selectedConfigId || undefined);
    window.open(url, '_blank');
    showToast('已开始导出，与当前筛选条件一致', 'success');
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setImporting(true);
    setImportErrors([]);
    const r = await api.importCsv(text);
    setImporting(false);
    if (r.success && r.data) {
      showToast(`成功导入 ${r.data.importedCount} 个样本`, 'success');
      setShowImport(false);
      await load();
    } else {
      const errData = r as { success: boolean; error?: string; errors?: CsvImportError[] };
      if (errData.errors && errData.errors.length > 0) {
        setImportErrors(errData.errors);
        showToast(`导入校验失败: ${errData.errors.length} 个错误`, 'error');
      } else {
        showToast(r.error || '导入失败', 'error');
      }
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  async function saveExportConfig() {
    if (!newConfigName.trim()) {
      showToast('请输入配置名称', 'error');
      return;
    }
    const filters: Record<string, string | number | boolean> = {};
    if (appliedKeyword) filters.keyword = appliedKeyword;
    if (appliedStatus) filters.status = appliedStatus;
    if (appliedReceiver) filters.receiverId = appliedReceiver;
    const r = await api.createExportConfig({
      name: newConfigName.trim(),
      type: 'batches',
      includeSignoffHistory: newConfigSignoff,
      includeTempAlerts: newConfigTempAlerts,
      includeFailureAudit: newConfigFailureAudit,
      filters,
    });
    if (r.success) {
      showToast('导出配置已保存', 'success');
      setNewConfigName('');
      await loadExportConfigs();
    } else {
      showToast(r.error || '保存失败', 'error');
    }
  }

  async function deleteConfig(id: string) {
    const r = await api.deleteExportConfig(id);
    if (r.success) {
      showToast('配置已删除', 'success');
      if (selectedConfigId === id) setSelectedConfigId('');
      await loadExportConfigs();
    } else {
      showToast(r.error || '删除失败', 'error');
    }
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
              {(user?.role === 'SAMPLER' || user?.role === 'ADMIN') && (
                <button
                  onClick={() => setShowImport(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 text-white text-sm hover:bg-violet-700 transition"
                >
                  <Upload className="w-4 h-4" /> CSV 导入
                </button>
              )}
              <button
                onClick={doExport}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm hover:bg-emerald-700 transition"
              >
                <Download className="w-4 h-4" /> 导出 CSV
              </button>
              <button
                onClick={() => { setShowExportConfig(!showExportConfig); loadExportConfigs(); }}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-slate-600 text-sm hover:bg-slate-50 transition"
              >
                <Settings2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {showExportConfig && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-slate-800">导出配置</h3>
            <button onClick={() => setShowExportConfig(false)} className="text-slate-400 hover:text-slate-600">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-500 mb-1">使用已保存的配置</label>
              <div className="flex gap-2">
                <select
                  value={selectedConfigId}
                  onChange={(e) => setSelectedConfigId(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-400 outline-none text-sm bg-white"
                >
                  <option value="">默认导出</option>
                  {exportConfigs.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                {selectedConfigId && (
                  <button
                    onClick={() => deleteConfig(selectedConfigId)}
                    className="px-2 py-2 rounded-lg border border-red-200 text-red-600 text-sm hover:bg-red-50 transition"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">保存当前筛选为新配置</label>
              <div className="flex gap-2">
                <input
                  value={newConfigName}
                  onChange={(e) => setNewConfigName(e.target.value)}
                  placeholder="配置名称"
                  className="flex-1 px-3 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-400 outline-none text-sm"
                />
                <button
                  onClick={saveExportConfig}
                  className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 transition"
                >
                  <Save className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-4 text-sm">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={newConfigSignoff}
                onChange={(e) => setNewConfigSignoff(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-400"
              />
              包含签收历史
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={newConfigTempAlerts}
                onChange={(e) => setNewConfigTempAlerts(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-400"
              />
              包含温控异常
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={newConfigFailureAudit}
                onChange={(e) => setNewConfigFailureAudit(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-400"
              />
              包含失败审计
            </label>
          </div>
        </div>
      )}

      {showImport && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-slate-800">CSV 批量导入样本</h3>
            <button onClick={() => { setShowImport(false); setImportErrors([]); }} className="text-slate-400 hover:text-slate-600">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="text-sm text-slate-600 space-y-1">
            <p>CSV 必须包含以下列：<code className="bg-slate-100 px-1 rounded text-xs">sampleCode, type, description, sourceLocation, minTemp, maxTemp, initialTemperature, tempLocation</code></p>
            <p>可选列：<code className="bg-slate-100 px-1 rounded text-xs">intendedReceiverUsername</code>（接收人用户名，须为接收员角色）</p>
          </div>
          <div className="flex items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              onChange={handleFileSelect}
              className="text-sm"
              disabled={importing}
            />
            {importing && <span className="text-sm text-blue-600">导入中...</span>}
          </div>
          {importErrors.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="font-medium text-red-800 mb-2">导入校验失败（{importErrors.length} 个错误）</div>
              <div className="max-h-48 overflow-y-auto space-y-1">
                {importErrors.map((e, i) => (
                  <div key={i} className="text-sm text-red-700">
                    <span className="font-mono bg-red-100 px-1 rounded">行{e.row}</span>
                    {e.sampleCode && <span className="ml-1">[{e.sampleCode}]</span>}
                    <span className="ml-1">{e.field}: {e.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

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
