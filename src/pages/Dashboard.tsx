import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api';
import type { Batch, Sample } from '@/types';
import {
  BATCH_STATUS_LABELS,
  STATUS_LABELS,
  BATCH_STATUS_COLORS,
  STATUS_COLORS,
  formatDate,
} from '@/types';
import { useAppStore } from '@/store';
import {
  Package,
  ClipboardCheck,
  RotateCcw,
  AlertTriangle,
  ArrowRight,
  Clock,
  TrendingUp,
  Shield,
} from 'lucide-react';

export default function Dashboard() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [loading, setLoading] = useState(true);
  const user = useAppStore((s) => s.user);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    const [br, sr] = await Promise.all([api.listBatches(), api.listSamples()]);
    if (br.success && br.data) setBatches(br.data.batches);
    if (sr.success && sr.data) setSamples(sr.data.samples);
    setLoading(false);
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

  const totalBatches = batches.length;
  const inTransit = batches.filter((b) => b.status === 'IN_TRANSIT').length;
  const received = batches.filter((b) => b.status === 'FULLY_RECEIVED').length;
  const returned = batches.filter((b) => b.status === 'RETURNED').length;
  const totalSamples = samples.length;
  const samplesWithAlert = samples.filter((s) => s.temperatureAlerts?.some((a) => !a.resolved)).length;

  const stats = [
    { label: '总批次数', value: totalBatches, icon: Package, color: 'from-blue-500 to-blue-600', text: 'text-blue-500', bg: 'bg-blue-50' },
    { label: '交接中', value: inTransit, icon: TrendingUp, color: 'from-amber-500 to-amber-600', text: 'text-amber-500', bg: 'bg-amber-50' },
    { label: '已签收', value: received, icon: ClipboardCheck, color: 'from-emerald-500 to-emerald-600', text: 'text-emerald-500', bg: 'bg-emerald-50' },
    { label: '退回批次', value: returned, icon: RotateCcw, color: 'from-orange-500 to-orange-600', text: 'text-orange-500', bg: 'bg-orange-50' },
    { label: '样本总数', value: totalSamples, icon: Shield, color: 'from-indigo-500 to-indigo-600', text: 'text-indigo-500', bg: 'bg-indigo-50' },
    { label: '温控异常', value: samplesWithAlert, icon: AlertTriangle, color: 'from-red-500 to-red-600', text: 'text-red-500', bg: 'bg-red-50' },
  ];

  const recentBatches = [...batches].sort((a, b) => b.createdAt - a.createdAt).slice(0, 8);
  const alertSamples = samples
    .filter((s) => s.temperatureAlerts?.some((a) => !a.resolved))
    .slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
            <div className="flex items-start justify-between mb-3">
              <div className={`w-10 h-10 rounded-lg ${s.bg} flex items-center justify-center`}>
                <s.icon className={`w-5 h-5 ${s.text}`} />
              </div>
            </div>
            <div className="text-2xl font-bold text-slate-800">{s.value}</div>
            <div className="text-sm text-slate-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-semibold text-slate-800">最近批次</h3>
            <Link to="/batches" className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1">
              查看全部 <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="divide-y divide-slate-100">
            {recentBatches.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-sm">暂无批次数据</div>
            ) : (
              recentBatches.map((b) => (
                <Link
                  key={b.id}
                  to={`/batches/${b.id}`}
                  className="px-5 py-3 flex items-center justify-between hover:bg-slate-50 transition"
                >
                  <div>
                    <div className="font-medium text-slate-800 text-sm">{b.batchCode}</div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {b.creatorName} · {formatDate(b.createdAt)} · {b.sampleCount || 0} 个样本
                    </div>
                  </div>
                  <span
                    className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium border ${
                      BATCH_STATUS_COLORS[b.status]
                    }`}
                  >
                    {BATCH_STATUS_LABELS[b.status]}
                  </span>
                </Link>
              ))
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-semibold text-slate-800 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              温控异常样本
            </h3>
            <Link to="/samples" className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1">
              查看全部 <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="divide-y divide-slate-100">
            {alertSamples.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-sm">
                <div className="mb-2">✅</div>
                暂无温控异常
              </div>
            ) : (
              alertSamples.map((s) => {
                const alerts = s.temperatureAlerts.filter((a) => !a.resolved);
                return (
                  <Link
                    key={s.id}
                    to={`/samples/${s.id}`}
                    className="px-5 py-3 hover:bg-red-50/40 transition"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-medium text-slate-800 text-sm">{s.sampleCode}</div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {s.type} · {STATUS_LABELS[s.status]} · 保管人 {s.currentHolderName}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-red-600 font-medium">{alerts.length} 项异常</div>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {alerts.map((a) => (
                        <span
                          key={a.id}
                          className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700"
                        >
                          {a.type === 'TOO_HIGH' ? '温度过高' : a.type === 'TOO_LOW' ? '温度过低' : '缺失'}
                          {a.actualValue != null && ` ${a.actualValue}℃`}
                        </span>
                      ))}
                    </div>
                  </Link>
                );
              })
            )}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-semibold text-slate-800">所有批次</h3>
          <div className="text-xs text-slate-500">
            当前用户：{user?.name}（{user?.department}）
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-5 py-3 text-left font-medium">批次编号</th>
                <th className="px-5 py-3 text-left font-medium">创建人</th>
                <th className="px-5 py-3 text-left font-medium">创建时间</th>
                <th className="px-5 py-3 text-left font-medium">接收人</th>
                <th className="px-5 py-3 text-center font-medium">数量</th>
                <th className="px-5 py-3 text-center font-medium">签收</th>
                <th className="px-5 py-3 text-center font-medium">退回</th>
                <th className="px-5 py-3 text-center font-medium">状态</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {batches.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-5 py-12 text-center text-slate-400">
                    暂无批次，前往"样本登记"创建新批次
                  </td>
                </tr>
              ) : (
                batches.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50/70 transition">
                    <td className="px-5 py-3 font-medium text-slate-800">{b.batchCode}</td>
                    <td className="px-5 py-3 text-slate-600">{b.creatorName}</td>
                    <td className="px-5 py-3 text-slate-500">{formatDate(b.createdAt)}</td>
                    <td className="px-5 py-3 text-slate-600">{b.intendedReceiverName || '-'}</td>
                    <td className="px-5 py-3 text-center text-slate-700">{b.sampleCount || 0}</td>
                    <td className="px-5 py-3 text-center text-emerald-600 font-medium">{b.receivedCount || 0}</td>
                    <td className="px-5 py-3 text-center text-orange-600 font-medium">{b.returnedCount || 0}</td>
                    <td className="px-5 py-3 text-center">
                      <span
                        className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium border ${
                          BATCH_STATUS_COLORS[b.status]
                        }`}
                      >
                        {BATCH_STATUS_LABELS[b.status]}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Link
                        to={`/batches/${b.id}`}
                        className="text-blue-600 hover:text-blue-700 text-sm font-medium"
                      >
                        详情
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
