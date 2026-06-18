import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '@/api';
import { useAppStore } from '@/store';
import type { Batch, Sample, User } from '@/types';
import {
  BATCH_STATUS_LABELS,
  STATUS_LABELS,
  BATCH_STATUS_COLORS,
  STATUS_COLORS,
  ACTION_LABELS,
  formatDate,
} from '@/types';
import {
  ArrowLeft,
  Send,
  PackageCheck,
  RotateCcw,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Plus,
  Thermometer,
  UserCheck,
  RefreshCw,
  Download,
} from 'lucide-react';

type ActionMode = null | 'handover' | 'receive' | 'return' | 're-handover' | 'void';

export default function BatchDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const showToast = useAppStore((s) => s.showToast);
  const user = useAppStore((s) => s.user);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<{ batch: Batch; samples: Sample[] } | null>(null);
  const [receivers, setReceivers] = useState<User[]>([]);
  const [mode, setMode] = useState<ActionMode>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [receiverId, setReceiverId] = useState('');
  const [note, setNote] = useState('');
  const [returnReason, setReturnReason] = useState('');
  const [voidReason, setVoidReason] = useState('');
  const [tempRecords, setTempRecords] = useState<Record<string, { temperature: string; location: string }>>({});
  const [resolvingAlert, setResolvingAlert] = useState<string | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [addingTempFor, setAddingTempFor] = useState<string | null>(null);
  const [newTemp, setNewTemp] = useState({ value: '', location: '', note: '' });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    load();
    loadReceivers();
  }, [id]);

  async function load() {
    setLoading(true);
    const r = await api.getBatchDetail(id!);
    if (r.success && r.data) {
      setDetail(r.data);
      initSelected(r.data.samples);
    }
    setLoading(false);
  }

  async function loadReceivers() {
    const r = await api.listReceivers();
    if (r.success && r.data) setReceivers(r.data);
  }

  function initSelected(samples: Sample[]) {
    const s = new Set<string>();
    samples.forEach((sp) => {
      if (['REGISTERED', 'RETURNED', 'PENDING_HANDOVER'].includes(sp.status)) s.add(sp.id);
      if (sp.status === 'IN_TRANSIT') s.add(sp.id);
    });
    setSelected(s);
  }

  function toggleSelect(sampleId: string) {
    const ns = new Set(selected);
    if (ns.has(sampleId)) ns.delete(sampleId);
    else ns.add(sampleId);
    setSelected(ns);
  }

  function selectAll(filter: (s: Sample) => boolean) {
    const ns = new Set<string>();
    detail?.samples.filter(filter).forEach((s) => ns.add(s.id));
    setSelected(ns);
  }

  function startAction(m: ActionMode) {
    if (!detail) return;
    if (m === 'receive') selectAll((s) => s.status === 'IN_TRANSIT');
    else if (m === 'return') selectAll((s) => s.status === 'IN_TRANSIT' || s.status === 'RECEIVED');
    else if (m === 'handover') selectAll((s) => s.status === 'REGISTERED' || s.status === 'PENDING_HANDOVER');
    else if (m === 're-handover') selectAll((s) => s.status === 'RETURNED' || s.status === 'REGISTERED');

    const tr: Record<string, { temperature: string; location: string }> = {};
    detail.samples.forEach((s) => {
      const lastT = s.temperatureRecords[0];
      tr[s.id] = { temperature: '', location: lastT?.location || detail!.batch.creatorName };
    });
    setTempRecords(tr);
    setMode(m);
  }

  function cancelAction() {
    setMode(null);
    setSelected(new Set());
    setNote('');
    setReturnReason('');
    setVoidReason('');
  }

  function validateAction(): string | null {
    if (selected.size === 0) return '请至少选择一个样本';
    if ((mode === 'handover' || mode === 're-handover') && !receiverId) return '请选择接收人';
    if (mode === 'return' && !returnReason.trim()) return '请填写退回原因';
    if (mode === 'void' && !voidReason.trim()) return '请填写作废原因';

    if (['receive', 'return', 're-handover'].includes(mode!)) {
      for (const sid of selected) {
        const t = tempRecords[sid];
        if (!t || t.temperature === '' || t.temperature === null || isNaN(Number(t.temperature))) {
          const sample = detail?.samples.find((s) => s.id === sid);
          return `样本 ${sample?.sampleCode} 的温度值缺失`;
        }
      }
    }
    return null;
  }

  async function submitAction() {
    if (!detail || !user) return;
    const err = validateAction();
    if (err) {
      showToast(err, 'error');
      return;
    }
    setSubmitting(true);
    const sampleIds = [...selected];

    const buildTempRecs = () =>
      sampleIds.map((sid) => ({
        sampleId: sid,
        temperature: Number(tempRecords[sid].temperature),
        location: tempRecords[sid].location || '交接点',
      }));

    let r: { success: boolean; error?: string };
    if (mode === 'handover') {
      r = await api.initiateHandover(detail.batch.id, receiverId, note);
    } else if (mode === 'receive') {
      r = await api.receiveBatch(detail.batch.id, sampleIds, buildTempRecs());
    } else if (mode === 'return') {
      r = await api.returnBatch(detail.batch.id, sampleIds, returnReason.trim(), buildTempRecs());
    } else if (mode === 're-handover') {
      r = await api.reInitiateHandover(detail.batch.id, sampleIds, receiverId, buildTempRecs(), note);
    } else if (mode === 'void') {
      r = await api.voidBatch(detail.batch.id, sampleIds, voidReason.trim());
    } else {
      r = { success: false, error: '未知操作' };
    }

    setSubmitting(false);
    if (r.success) {
      showToast('操作成功', 'success');
      cancelAction();
      await load();
    } else {
      showToast(r.error || '操作失败', 'error');
    }
  }

  async function resolveAlert(alertId: string) {
    if (!resolutionNote.trim()) {
      showToast('请填写处理说明', 'error');
      return;
    }
    const r = await api.resolveAlert(alertId, resolutionNote.trim());
    if (r.success) {
      showToast('已处理告警', 'success');
      setResolvingAlert(null);
      setResolutionNote('');
      await load();
    } else {
      showToast(r.error || '处理失败', 'error');
    }
  }

  async function submitAddTemp() {
    if (!addingTempFor) return;
    if (!newTemp.value || isNaN(Number(newTemp.value))) {
      showToast('请填写有效的温度值', 'error');
      return;
    }
    const r = await api.addTemperature(addingTempFor, Number(newTemp.value), newTemp.location || '巡检', newTemp.note);
    if (r.success) {
      showToast('温度记录已添加', 'success');
      setAddingTempFor(null);
      setNewTemp({ value: '', location: '', note: '' });
      await load();
    } else {
      showToast(r.error || '添加失败', 'error');
    }
  }

  function doExport() {
    const url = api.buildExportUrl('batches', { keyword: detail?.batch.batchCode });
    window.open(url, '_blank');
  }

  if (loading) {
    return <Loading />;
  }
  if (!detail) {
    return (
      <div className="text-center py-20 text-slate-500">
        批次不存在
        <div className="mt-4">
          <button onClick={() => navigate('/batches')} className="text-blue-600">
            ← 返回批次列表
          </button>
        </div>
      </div>
    );
  }

  const { batch, samples } = detail;
  const canInitiate = user && (user.role === 'SAMPLER' || user.role === 'ADMIN');
  const canReceive = user && (user.role === 'RECEIVER' || user.role === 'ADMIN');
  const canVoid = user && user.role === 'ADMIN';
  const isIntendedReceiver = user && batch.intendedReceiverId === user.id;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 transition">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-slate-800">{batch.batchCode}</h2>
            <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium border ${BATCH_STATUS_COLORS[batch.status]}`}>
              {BATCH_STATUS_LABELS[batch.status]}
            </span>
            <span className="text-xs text-slate-500">{samples.length} 个样本</span>
          </div>
          <div className="text-xs text-slate-500 mt-1">
            创建人 {batch.creatorName} · 创建时间 {formatDate(batch.createdAt)}
            {batch.intendedReceiverName && ` · 指定接收人 ${batch.intendedReceiverName}`}
          </div>
        </div>
        <button onClick={doExport} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 transition">
          <Download className="w-4 h-4" /> 导出
        </button>
        <button onClick={() => load()} className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 transition">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4 text-sm">
          <Info label="批次编号" value={batch.batchCode} />
          <Info label="创建人" value={batch.creatorName} />
          <Info label="创建时间" value={formatDate(batch.createdAt)} />
          <Info label="指定接收人" value={batch.intendedReceiverName || '-'} />
          <Info label="发起交接时间" value={batch.initiatedAt ? formatDate(batch.initiatedAt) : '-'} />
          <Info label="签收时间" value={batch.receivedAt ? formatDate(batch.receivedAt) : '-'} />
        </div>
        {batch.note && (
          <div className="mt-4 pt-4 border-t border-slate-100">
            <div className="text-xs text-slate-500 mb-1">备注：</div>
            <div className="text-sm text-slate-700">{batch.note}</div>
          </div>
        )}
      </div>

      {!mode && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-wrap gap-2">
          {canInitiate && (
            <>
              <button onClick={() => startAction('handover')}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium shadow-sm hover:bg-blue-700 transition">
                <Send className="w-4 h-4" /> 发起交接
              </button>
              <button onClick={() => startAction('re-handover')}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium shadow-sm hover:bg-amber-700 transition">
                <RotateCcw className="w-4 h-4" /> 重新交接
              </button>
            </>
          )}
          {canReceive && (
            <>
              <button
                onClick={() => startAction('receive')}
                disabled={!isIntendedReceiver && user?.role !== 'ADMIN'}
                className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-white text-sm font-medium shadow-sm transition ${
                  isIntendedReceiver || user?.role === 'ADMIN'
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-slate-300 cursor-not-allowed'
                }`}>
                <PackageCheck className="w-4 h-4" /> 签收
              </button>
              <button onClick={() => startAction('return')}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-orange-600 text-white text-sm font-medium shadow-sm hover:bg-orange-700 transition">
                <XCircle className="w-4 h-4" /> 退回
              </button>
            </>
          )}
          {canVoid && (
            <button onClick={() => startAction('void')}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium shadow-sm hover:bg-red-700 transition">
              <ShieldAlert className="w-4 h-4" /> 作废
            </button>
          )}
          {!isIntendedReceiver && user?.role === 'RECEIVER' && (
            <span className="text-xs text-orange-600 flex items-center gap-1 ml-2">
              <AlertTriangle className="w-4 h-4" /> 非指定接收人，禁止替人签收
            </span>
          )}
        </div>
      )}

      {mode && (
        <ActionPanel
          mode={mode}
          receivers={receivers}
          receiverId={receiverId}
          setReceiverId={setReceiverId}
          note={note}
          setNote={setNote}
          returnReason={returnReason}
          setReturnReason={setReturnReason}
          voidReason={voidReason}
          setVoidReason={setVoidReason}
          tempRecords={tempRecords}
          setTempRecords={setTempRecords}
          samples={samples.filter((s) => selected.has(s.id))}
          submitting={submitting}
          onSubmit={submitAction}
          onCancel={cancelAction}
        />
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-semibold text-slate-800">样本列表（{samples.length}）</h3>
          {mode && (
            <div className="text-sm">
              已选择 <span className="text-blue-600 font-semibold">{selected.size}</span> 项
            </div>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                {mode && <th className="px-3 py-3 w-10"></th>}
                <th className="px-4 py-3 text-left font-medium">样本编号</th>
                <th className="px-4 py-3 text-left font-medium">类型</th>
                <th className="px-4 py-3 text-left font-medium">采样人</th>
                <th className="px-4 py-3 text-left font-medium">保管人</th>
                <th className="px-4 py-3 text-center font-medium">温度范围</th>
                <th className="px-4 py-3 text-center font-medium">最新温度</th>
                <th className="px-4 py-3 text-center font-medium">状态</th>
                <th className="px-4 py-3 text-center font-medium">异常</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {samples.map((s) => {
                const lastT = s.temperatureRecords[0];
                const unresolved = s.temperatureAlerts.filter((a) => !a.resolved);
                const selectedForAction = mode ? isSampleSelectableForAction(s, mode) : true;
                return (
                  <tr key={s.id} className="hover:bg-slate-50/70">
                    {mode && (
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          checked={selected.has(s.id)}
                          disabled={!selectedForAction}
                          onChange={() => toggleSelect(s.id)}
                          className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-400"
                        />
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <button onClick={() => navigate(`/samples/${s.id}`)} className="font-medium text-blue-600 hover:text-blue-700">
                        {s.sampleCode}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{s.type}</td>
                    <td className="px-4 py-3 text-slate-600">{s.collectorName}</td>
                    <td className="px-4 py-3 text-slate-600">{s.currentHolderName}</td>
                    <td className="px-4 py-3 text-center text-slate-600">
                      {s.minTemp}℃ ~ {s.maxTemp}℃
                    </td>
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
                        <span className="text-red-500 text-xs">缺失</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium border ${STATUS_COLORS[s.status]}`}>
                        {STATUS_LABELS[s.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {unresolved.length > 0 ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                          <AlertTriangle className="w-3 h-3" />
                          {unresolved.length}
                        </span>
                      ) : (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 mx-auto" />
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => {
                          setAddingTempFor(s.id);
                          setNewTemp({ value: '', location: lastT?.location || '', note: '' });
                        }}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-slate-600 hover:bg-slate-100 transition"
                      >
                        <Thermometer className="w-3 h-3" /> 测温
                      </button>
                      <button
                        onClick={() => navigate(`/samples/${s.id}`)}
                        className="ml-1 px-2 py-1 rounded text-xs text-blue-600 hover:bg-blue-50 transition"
                      >
                        详情
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h3 className="font-semibold text-slate-800">温控异常告警</h3>
        </div>
        <div className="divide-y divide-slate-100">
          {(() => {
            const allAlerts = samples.flatMap((s) =>
              s.temperatureAlerts.map((a) => ({ ...a, sampleCode: s.sampleCode, sampleId: s.id })),
            ).sort((a, b) => b.timestamp - a.timestamp);
            if (allAlerts.length === 0) {
              return <div className="p-8 text-center text-slate-400 text-sm">暂无温控异常</div>;
            }
            return allAlerts.map((a) => (
              <div key={a.id} className="px-5 py-3">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => navigate(`/samples/${a.sampleId}`)} className="font-medium text-blue-600 text-sm hover:underline">
                        {a.sampleCode}
                      </button>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        a.type === 'TOO_HIGH' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
                      }`}>
                        {a.type === 'TOO_HIGH' ? '温度过高' : '温度过低'}
                      </span>
                      {a.resolved ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-emerald-100 text-emerald-700">
                          <CheckCircle2 className="w-3 h-3" /> 已处理
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-amber-100 text-amber-700">
                          <AlertTriangle className="w-3 h-3" /> 待处理
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      实际值：{a.actualValue}℃ / 阈值：{a.threshold}℃ · {formatDate(a.timestamp)}
                    </div>
                    {a.resolved && (
                      <div className="text-xs text-slate-500 mt-1">
                        处理：{a.resolutionNote} · {formatDate(a.resolvedAt!)}
                      </div>
                    )}
                  </div>
                  {!a.resolved && (
                    resolvingAlert === a.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          value={resolutionNote}
                          onChange={(e) => setResolutionNote(e.target.value)}
                          placeholder="处理说明"
                          className="w-40 px-2 py-1 rounded border border-slate-200 text-xs outline-none focus:border-blue-400"
                        />
                        <button onClick={() => resolveAlert(a.id)} className="px-3 py-1 rounded text-xs bg-emerald-600 text-white hover:bg-emerald-700">
                          确认
                        </button>
                        <button onClick={() => { setResolvingAlert(null); setResolutionNote(''); }} className="px-2 py-1 rounded text-xs text-slate-500 hover:bg-slate-100">
                          取消
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setResolvingAlert(a.id); setResolutionNote(''); }}
                        className="px-3 py-1 rounded text-xs bg-blue-600 text-white hover:bg-blue-700"
                      >
                        处理
                      </button>
                    )
                  )}
                </div>
              </div>
            ));
          })()}
        </div>
      </div>

      {addingTempFor && (
        <Modal title="添加温控记录" onClose={() => setAddingTempFor(null)}>
          <div className="space-y-3">
            <div>
              <label className="block text-sm text-slate-700 mb-1">温度值 (℃) *</label>
              <input
                type="number"
                step="0.1"
                value={newTemp.value}
                onChange={(e) => setNewTemp({ ...newTemp, value: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-400 outline-none"
                placeholder="如 4.5"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-700 mb-1">测温地点</label>
              <input
                value={newTemp.location}
                onChange={(e) => setNewTemp({ ...newTemp, location: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-400 outline-none"
                placeholder="如：检验科冷藏柜"
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
            <button onClick={() => setAddingTempFor(null)} className="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100 text-sm">
              取消
            </button>
            <button onClick={submitAddTemp} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700">
              提交
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function isSampleSelectableForAction(s: Sample, mode: ActionMode): boolean {
  switch (mode) {
    case 'handover': return ['REGISTERED', 'PENDING_HANDOVER'].includes(s.status);
    case 'receive': return s.status === 'IN_TRANSIT';
    case 'return': return ['IN_TRANSIT', 'RECEIVED'].includes(s.status);
    case 're-handover': return ['RETURNED', 'REGISTERED'].includes(s.status);
    case 'void': return s.status !== 'VOIDED';
    default: return true;
  }
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      <div className="text-slate-800 font-medium">{value}</div>
    </div>
  );
}

function Loading() {
  return (
    <div className="flex items-center justify-center h-64 text-slate-500">
      <div className="flex items-center gap-2">
        <Clock className="w-5 h-5 animate-spin" />
        加载中...
      </div>
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-slate-900/40 z-40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-slate-800 mb-4">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function ActionPanel(props: {
  mode: ActionMode;
  receivers: User[];
  receiverId: string;
  setReceiverId: (v: string) => void;
  note: string;
  setNote: (v: string) => void;
  returnReason: string;
  setReturnReason: (v: string) => void;
  voidReason: string;
  setVoidReason: (v: string) => void;
  tempRecords: Record<string, { temperature: string; location: string }>;
  setTempRecords: React.Dispatch<React.SetStateAction<Record<string, { temperature: string; location: string }>>>;
  samples: Sample[];
  submitting: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const {
    mode, receivers, receiverId, setReceiverId,
    note, setNote,
    returnReason, setReturnReason,
    voidReason, setVoidReason,
    tempRecords, setTempRecords,
    samples, submitting, onSubmit, onCancel,
  } = props;

  const titles: Record<string, { title: string; desc: string }> = {
    handover: { title: '发起交接', desc: '选择要交接的样本和接收人' },
    receive: { title: '签收样本', desc: '确认待签收的样本并记录每个的签收温度' },
    return: { title: '退回样本', desc: '退回必须填写原因，且提供退回时的温度记录' },
    're-handover': { title: '重新交接', desc: '将退回样本重新发起交接，必须提供当前温度记录' },
    void: { title: '作废样本', desc: '管理员权限，作废后不可恢复，历史记录保留' },
  };
  const info = titles[mode!];

  function updateTemp(sampleId: string, key: 'temperature' | 'location', value: string) {
    setTempRecords((prev) => ({
      ...prev,
      [sampleId]: { ...prev[sampleId], [key]: value },
    }));
  }

  return (
    <div className="bg-blue-50/50 border border-blue-200 rounded-xl p-5 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold text-slate-800 flex items-center gap-2">
            {mode === 'handover' && <Send className="w-4 h-4 text-blue-600" />}
            {mode === 'receive' && <PackageCheck className="w-4 h-4 text-emerald-600" />}
            {mode === 'return' && <RotateCcw className="w-4 h-4 text-orange-600" />}
            {mode === 're-handover' && <RefreshCw className="w-4 h-4 text-amber-600" />}
            {mode === 'void' && <ShieldAlert className="w-4 h-4 text-red-600" />}
            {info.title}
          </h3>
          <p className="text-xs text-slate-500 mt-1">{info.desc}</p>
        </div>
        <div className="text-sm text-slate-600">
          已选 <span className="text-blue-600 font-semibold">{samples.length}</span> 个样本
        </div>
      </div>

      {(mode === 'handover' || mode === 're-handover') && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-slate-700 mb-1">
              接收人 <span className="text-red-500">*</span>
            </label>
            <select
              value={receiverId}
              onChange={(e) => setReceiverId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-400 outline-none text-sm bg-white"
            >
              <option value="">请选择接收人</option>
              {receivers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}（{u.department}）
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-slate-700 mb-1">备注</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-400 outline-none text-sm"
              placeholder="如：冷藏运输"
            />
          </div>
        </div>
      )}

      {mode === 'return' && (
        <div>
          <label className="block text-sm text-slate-700 mb-1">
            退回原因 <span className="text-red-500">*</span>
          </label>
          <textarea
            value={returnReason}
            onChange={(e) => setReturnReason(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-orange-400 outline-none text-sm"
            placeholder="请填写退回原因，如：样本容器破损、温控异常等"
          />
        </div>
      )}

      {mode === 'void' && (
        <div>
          <label className="block text-sm text-slate-700 mb-1">
            作废原因 <span className="text-red-500">*</span>
          </label>
          <textarea
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-red-400 outline-none text-sm"
            placeholder="作废后不可恢复，历史记录将保留"
          />
        </div>
      )}

      {['receive', 'return', 're-handover'].includes(mode!) && samples.length > 0 && (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-50 text-xs text-slate-600 font-medium border-b border-slate-200 flex items-center gap-1">
            <Thermometer className="w-3.5 h-3.5" />
            温度记录（每个样本必填）
          </div>
          <div className="divide-y divide-slate-100">
            {samples.map((s) => (
              <div key={s.id} className="px-4 py-2.5 grid grid-cols-1 md:grid-cols-4 gap-3 items-center">
                <div className="md:col-span-1 text-sm">
                  <div className="font-medium text-slate-800">{s.sampleCode}</div>
                  <div className="text-xs text-slate-500">
                    范围 {s.minTemp}~{s.maxTemp}℃
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      step="0.1"
                      value={tempRecords[s.id]?.temperature || ''}
                      onChange={(e) => updateTemp(s.id, 'temperature', e.target.value)}
                      placeholder="温度 ℃"
                      className={`w-full px-2.5 py-1.5 rounded-md border text-sm outline-none focus:ring-2 ${
                        tempRecords[s.id]?.temperature !== '' &&
                        (Number(tempRecords[s.id]?.temperature) < s.minTemp ||
                          Number(tempRecords[s.id]?.temperature) > s.maxTemp)
                          ? 'border-red-300 bg-red-50 focus:ring-red-400'
                          : 'border-slate-200 focus:ring-blue-400'
                      }`}
                    />
                    <span className="text-xs text-slate-400">℃</span>
                  </div>
                </div>
                <div className="md:col-span-2">
                  <input
                    value={tempRecords[s.id]?.location || ''}
                    onChange={(e) => updateTemp(s.id, 'location', e.target.value)}
                    placeholder="测温地点"
                    className="w-full px-2.5 py-1.5 rounded-md border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-2">
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded-lg text-slate-600 hover:bg-white text-sm border border-slate-200"
        >
          取消
        </button>
        <button
          onClick={onSubmit}
          disabled={submitting || samples.length === 0}
          className={`inline-flex items-center gap-1.5 px-5 py-2 rounded-lg text-white text-sm font-medium shadow-sm disabled:opacity-50 transition ${
            mode === 'receive'
              ? 'bg-emerald-600 hover:bg-emerald-700'
              : mode === 'return'
              ? 'bg-orange-600 hover:bg-orange-700'
              : mode === 'void'
              ? 'bg-red-600 hover:bg-red-700'
              : 'bg-blue-600 hover:bg-blue-700'
          }`}
        >
          <UserCheck className="w-4 h-4" />
          {submitting ? '提交中...' : '确认'}
        </button>
      </div>
    </div>
  );
}
