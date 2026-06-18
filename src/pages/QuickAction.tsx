import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api';
import { useAppStore } from '@/store';
import type { Batch } from '@/types';
import { BATCH_STATUS_LABELS, BATCH_STATUS_COLORS, formatDate } from '@/types';
import { Clock, AlertTriangle } from 'lucide-react';

type Mode = 'handover' | 'receive' | 'return';

interface Props {
  mode: Mode;
}

export default function QuickActionPage({ mode }: Props) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Batch[]>([]);
  const user = useAppStore((s) => s.user);
  const navigate = useNavigate();

  const title =
    mode === 'handover' ? { title: '发起交接', desc: '选择草稿或退回批次发起交接' } :
    mode === 'receive' ? { title: '签收管理', desc: '查看指定给你的交接批次进行签收' } :
    { title: '退回与重交', desc: '退回异常批次或重新交接退回样本' };

  useEffect(() => {
    load();
  }, [mode, user?.id]);

  async function load() {
    setLoading(true);
    const filters: Record<string, string> = {};
    if (mode === 'receive') filters.receiverId = user?.id || '';
    const r = await api.listBatches(filters);
    if (r.success && r.data) {
      let list = r.data.batches;
      if (mode === 'handover') {
        list = list.filter((b) => ['DRAFT', 'RETURNED', 'PENDING'].includes(b.status));
      } else if (mode === 'receive') {
        list = list.filter((b) => ['IN_TRANSIT', 'PARTIAL_RECEIVED'].includes(b.status));
      } else {
        list = list.filter((b) => ['IN_TRANSIT', 'PARTIAL_RECEIVED', 'RETURNED'].includes(b.status));
      }
      setItems(list);
    }
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

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <h2 className="text-lg font-semibold text-slate-800">{title.title}</h2>
        <p className="text-sm text-slate-500 mt-1">{title.desc}</p>

        {mode === 'receive' && (
          <div className="mt-4 p-3 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-800 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              只能签收<strong>指定给您</strong>的批次。尝试替其他接收员签收将被系统拒绝，并写入失败审计记录。
            </div>
          </div>
        )}

        {mode === 'return' && (
          <div className="mt-4 p-3 rounded-lg bg-orange-50 border border-orange-200 text-sm text-orange-800 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              退回必须填写<strong>原因</strong>并提供温度记录。退回后样本会返还给采样员，可重新发起交接。
            </div>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {items.length === 0 ? (
          <div className="px-5 py-16 text-center text-slate-400 text-sm">
            暂无需要处理的批次
            <div className="mt-3 text-xs">
              {mode === 'handover' && '请先到"样本登记"创建新批次'}
              {mode === 'receive' && '当前没有指定给你的交接批次'}
              {mode === 'return' && '当前没有可退回的批次'}
            </div>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {items.map((b) => (
              <button
                key={b.id}
                onClick={() => navigate(`/batches/${b.id}`)}
                className="w-full px-5 py-4 flex items-center justify-between hover:bg-slate-50 transition text-left"
              >
                <div>
                  <div className="flex items-center gap-3">
                    <div className="font-medium text-slate-800">{b.batchCode}</div>
                    <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium border ${BATCH_STATUS_COLORS[b.status]}`}>
                      {BATCH_STATUS_LABELS[b.status]}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    创建人 {b.creatorName} · {formatDate(b.createdAt)} · {b.sampleCount || 0} 个样本
                  </div>
                  {b.intendedReceiverName && (
                    <div className="text-xs text-slate-500 mt-0.5">
                      指定接收人：{b.intendedReceiverName}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-5 text-xs text-slate-500">
                  <div>已签收：<span className="text-emerald-600 font-semibold">{b.receivedCount || 0}</span>/{b.sampleCount || 0}</div>
                  {(b.returnedCount || 0) > 0 && (
                    <div>退回：<span className="text-orange-600 font-semibold">{b.returnedCount}</span></div>
                  )}
                  <div className="text-blue-600 font-medium">操作 →</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
