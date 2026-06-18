import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '@/api';
import { useAppStore } from '@/store';
import type { Sample } from '@/types';
import {
  STATUS_LABELS,
  STATUS_COLORS,
  ACTION_LABELS,
  formatDate,
} from '@/types';
import {
  ArrowLeft,
  Clock,
  User,
  Thermometer,
  AlertTriangle,
  CheckCircle2,
  FileText,
  TrendingUp,
  RotateCcw,
  ShieldAlert,
  Plus,
  X,
} from 'lucide-react';

export default function SampleDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const showToast = useAppStore((s) => s.showToast);
  const [sample, setSample] = useState<Sample | null>(null);
  const [loading, setLoading] = useState(true);
  const [addingTemp, setAddingTemp] = useState(false);
  const [newTemp, setNewTemp] = useState({ value: '', location: '', note: '' });
  const [resolving, setResolving] = useState<string | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');

  useEffect(() => {
    load();
  }, [id]);

  async function load() {
    setLoading(true);
    const r = await api.getSampleDetail(id!);
    if (r.success && r.data) setSample(r.data);
    setLoading(false);
  }

  async function submitAddTemp() {
    if (!newTemp.value || isNaN(Number(newTemp.value))) {
      showToast('请填写有效温度值', 'error');
      return;
    }
    const r = await api.addTemperature(id!, Number(newTemp.value), newTemp.location || '手动记录', newTemp.note);
    if (r.success) {
      showToast('温度记录已添加', 'success');
      setAddingTemp(false);
      setNewTemp({ value: '', location: '', note: '' });
      await load();
    } else {
      showToast(r.error || '添加失败', 'error');
    }
  }

  async function submitResolve(alertId: string) {
    if (!resolutionNote.trim()) {
      showToast('请填写处理说明', 'error');
      return;
    }
    const r = await api.resolveAlert(alertId, resolutionNote.trim());
    if (r.success) {
      showToast('已处理', 'success');
      setResolving(null);
      setResolutionNote('');
      await load();
    } else {
      showToast(r.error || '处理失败', 'error');
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 animate-spin" />
          加载中...
        </div>
      </div>
    );
  }
  if (!sample) {
    return (
      <div className="text-center py-20 text-slate-500">
        样本不存在
        <div className="mt-4">
          <button onClick={() => navigate('/samples')} className="text-blue-600">
            ← 返回样本列表
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 transition">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-slate-800">{sample.sampleCode}</h2>
            <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium border ${STATUS_COLORS[sample.status]}`}>
              {STATUS_LABELS[sample.status]}
            </span>
            {sample.temperatureAlerts.some((a) => !a.resolved) && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                <AlertTriangle className="w-3 h-3" />
                温控异常
              </span>
            )}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {sample.type} · 采集于 {formatDate(sample.collectedAt)}
          </div>
        </div>
        <Link
          to={`/batches/${sample.batchId}`}
          className="text-sm text-blue-600 hover:text-blue-700 inline-flex items-center gap-1"
        >
          查看所属批次 →
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
              <FileText className="w-4 h-4 text-slate-500" />
              样本信息
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <Info label="样本编号" value={sample.sampleCode} />
              <Info label="样本类型" value={sample.type} />
              <Info label="来源地点" value={sample.sourceLocation} />
              <Info label="描述" value={sample.description || '-'} />
              <Info label="采样人" value={sample.collectorName} />
              <Info label="采样时间" value={formatDate(sample.collectedAt)} />
              <Info label="当前保管人" value={sample.currentHolderName} />
              <Info label="更新时间" value={formatDate(sample.updatedAt)} />
              <Info label="温度下限" value={`${sample.minTemp}℃`} />
              <Info label="温度上限" value={`${sample.maxTemp}℃`} />
              <Info label="温控记录数" value={String(sample.temperatureRecords.length)} />
              <Info label="异常告警数" value={String(sample.temperatureAlerts.length)} />
              {sample.voidedAt && (
                <>
                  <Info label="作废时间" value={formatDate(sample.voidedAt)} />
                  <Info label="作废原因" value={sample.voidReason || '-'} />
                </>
              )}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-blue-500" />
                完整交接链（{sample.handoverChain.length}）
              </h3>
              <button
                onClick={() => setAddingTemp(true)}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-blue-50 text-blue-600 hover:bg-blue-100 transition"
              >
                <Plus className="w-3.5 h-3.5" /> 追加温控
              </button>
            </div>
            <ol className="relative border-l-2 border-slate-100 ml-6 my-5 space-y-5">
              {sample.handoverChain.map((link) => (
                <li key={link.id} className="pl-6 relative">
                  <span
                    className={`absolute -left-[13px] top-1 w-6 h-6 rounded-full flex items-center justify-center ${
                      link.action === 'REGISTER'
                        ? 'bg-blue-100 text-blue-600'
                        : link.action === 'INITIATE_HANDOVER'
                        ? 'bg-amber-100 text-amber-600'
                        : link.action === 'RECEIVE'
                        ? 'bg-emerald-100 text-emerald-600'
                        : link.action === 'RETURN'
                        ? 'bg-orange-100 text-orange-600'
                        : link.action === 'RE_HANDOVER'
                        ? 'bg-indigo-100 text-indigo-600'
                        : 'bg-red-100 text-red-600'
                    }`}
                  >
                    {link.action === 'REGISTER' && <User className="w-3 h-3" />}
                    {link.action === 'INITIATE_HANDOVER' && <TrendingUp className="w-3 h-3" />}
                    {link.action === 'RECEIVE' && <CheckCircle2 className="w-3 h-3" />}
                    {link.action === 'RETURN' && <RotateCcw className="w-3 h-3" />}
                    {link.action === 'RE_HANDOVER' && <TrendingUp className="w-3 h-3" />}
                    {link.action === 'VOID' && <ShieldAlert className="w-3 h-3" />}
                  </span>
                  <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-slate-800">
                        {ACTION_LABELS[link.action]}
                      </span>
                      <span className="text-xs text-slate-400">{formatDate(link.timestamp)}</span>
                    </div>
                    <div className="text-xs text-slate-600">
                      {link.fromUserName} → {link.toUserName || '(无)'}
                    </div>
                    {link.temperatureChecks && link.temperatureChecks.length > 0 && (
                      <div className="text-xs text-blue-600 mt-1">
                        关联温控记录：{link.temperatureChecks.length} 条
                      </div>
                    )}
                    {link.returnReason && (
                      <div className="mt-2 p-2 rounded bg-orange-50 text-xs text-orange-700 border border-orange-100">
                        <strong>退回原因：</strong>{link.returnReason}
                      </div>
                    )}
                    {link.note && !link.returnReason && (
                      <div className="mt-2 text-xs text-slate-500">
                        备注：{link.note}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                <Thermometer className="w-4 h-4 text-red-500" />
                温控记录（{sample.temperatureRecords.length}）
              </h3>
            </div>
            <div className="divide-y divide-slate-100 max-h-[400px] overflow-y-auto">
              {sample.temperatureRecords.length === 0 ? (
                <div className="p-6 text-center text-slate-400 text-sm">暂无温控记录</div>
              ) : (
                sample.temperatureRecords.map((t) => {
                  const abnormal = t.temperature < sample.minTemp || t.temperature > sample.maxTemp;
                  return (
                    <div key={t.id} className="px-5 py-3">
                      <div className="flex items-start justify-between mb-1">
                        <div
                          className={`text-2xl font-bold ${
                            abnormal ? 'text-red-600' : 'text-emerald-600'
                          }`}
                        >
                          {t.temperature}℃
                        </div>
                        {abnormal && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-red-100 text-red-700">
                            <AlertTriangle className="w-3 h-3" />
                            异常
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500">
                        地点：{t.location} · {formatDate(t.timestamp)}
                      </div>
                      {t.note && <div className="text-xs text-slate-400 mt-0.5">{t.note}</div>}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                温控异常（{sample.temperatureAlerts.length}）
              </h3>
            </div>
            <div className="divide-y divide-slate-100">
              {sample.temperatureAlerts.length === 0 ? (
                <div className="p-6 text-center text-slate-400 text-sm">
                  <CheckCircle2 className="w-6 h-6 mx-auto text-emerald-400 mb-1" />
                  无异常记录
                </div>
              ) : (
                sample.temperatureAlerts.map((a) => (
                  <div key={a.id} className="px-5 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
                              a.type === 'TOO_HIGH' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
                            }`}
                          >
                            {a.type === 'TOO_HIGH' ? '温度过高' : '温度过低'}
                          </span>
                          {a.resolved ? (
                            <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                              <CheckCircle2 className="w-3 h-3" /> 已处理
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                              <AlertTriangle className="w-3 h-3" /> 待处理
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500">
                          实际：{a.actualValue}℃ · 阈值：{a.threshold}℃
                        </div>
                        <div className="text-xs text-slate-400">{formatDate(a.timestamp)}</div>
                        {a.resolved && (
                          <div className="mt-2 p-2 rounded bg-emerald-50 text-xs text-emerald-700 border border-emerald-100">
                            {a.resolutionNote}
                          </div>
                        )}
                      </div>
                      {!a.resolved &&
                        (resolving === a.id ? (
                          <div className="flex flex-col gap-1 items-end">
                            <input
                              value={resolutionNote}
                              onChange={(e) => setResolutionNote(e.target.value)}
                              placeholder="处理说明"
                              className="px-2 py-1 rounded text-xs border border-slate-200 outline-none focus:border-blue-400 w-40"
                            />
                            <div className="flex gap-1">
                              <button
                                onClick={() => submitResolve(a.id)}
                                className="px-2 py-1 rounded text-xs bg-emerald-600 text-white hover:bg-emerald-700"
                              >
                                确认
                              </button>
                              <button
                                onClick={() => { setResolving(null); setResolutionNote(''); }}
                                className="px-2 py-1 rounded text-xs text-slate-500 hover:bg-slate-100"
                              >
                                取消
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setResolving(a.id); setResolutionNote(''); }}
                            className="px-2 py-1 rounded text-xs bg-blue-600 text-white hover:bg-blue-700"
                          >
                            处理
                          </button>
                        ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {addingTemp && (
        <div className="fixed inset-0 bg-slate-900/40 z-40 flex items-center justify-center p-4" onClick={() => setAddingTemp(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-slate-800">添加温控记录</h3>
              <button onClick={() => setAddingTemp(false)} className="p-1 rounded text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-slate-700 mb-1">温度值 (℃) *</label>
                <input
                  type="number"
                  step="0.1"
                  value={newTemp.value}
                  onChange={(e) => setNewTemp({ ...newTemp, value: e.target.value })}
                  placeholder={`范围 ${sample.minTemp} ~ ${sample.maxTemp}`}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-400 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-700 mb-1">测温地点</label>
                <input
                  value={newTemp.location}
                  onChange={(e) => setNewTemp({ ...newTemp, location: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-400 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-700 mb-1">备注</label>
                <input
                  value={newTemp.note}
                  onChange={(e) => setNewTemp({ ...newTemp, note: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-400 outline-none"
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setAddingTemp(false)} className="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100 text-sm">
                取消
              </button>
              <button onClick={submitAddTemp} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700">
                提交
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      <div className="text-slate-800 font-medium truncate" title={value}>{value}</div>
    </div>
  );
}
