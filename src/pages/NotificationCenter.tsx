import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '@/api';
import { useAppStore } from '@/store';
import type { ImportNotification, ImportNotificationType, ImportNotificationStatus } from '@/types';
import {
  NOTIFICATION_TYPE_LABELS,
  NOTIFICATION_STATUS_COLORS,
  NOTIFICATION_STATUS_LABELS,
  formatDate,
} from '@/types';
import {
  Bell,
  Clock,
  Filter,
  X,
  CheckCheck,
  AlertTriangle,
  RotateCcw,
  ChevronRight,
  Eye,
  Search,
} from 'lucide-react';

const TYPE_OPTIONS: (ImportNotificationType | '')[] = [
  '',
  'IMPORT_SUCCESS',
  'IMPORT_FAILURE',
  'EXPORT_SUCCESS',
  'EXPORT_FAILURE',
  'DRAFT_SAVE',
  'DRAFT_UPDATE',
  'DRAFT_SUBMIT',
  'DRAFT_CANCEL',
  'DRAFT_CONFLICT',
  'TEMPLATE_APPLY',
  'UNDO_SUCCESS',
  'UNDO_FAILURE',
];

const STATUS_OPTIONS: (ImportNotificationStatus | '')[] = [
  '',
  'SUCCESS',
  'FAILURE',
  'ROLLED_BACK',
  'PENDING',
];

export default function NotificationCenter() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState<ImportNotification[]>([]);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [stats, setStats] = useState<{ total: number; successCount: number; failureCount: number; rolledBackCount: number; byType: Record<string, number> } | null>(null);
  const user = useAppStore((s) => s.user);
  const showToast = useAppStore((s) => s.showToast);

  const [type, setType] = useState<ImportNotificationType | ''>('');
  const [status, setStatus] = useState<ImportNotificationStatus | ''>('');
  const [rolledBack, setRolledBack] = useState<string>('');
  const [keyword, setKeyword] = useState('');
  const [appliedType, setAppliedType] = useState<ImportNotificationType | ''>('');
  const [appliedStatus, setAppliedStatus] = useState<ImportNotificationStatus | ''>('');
  const [appliedRolledBack, setAppliedRolledBack] = useState<string>('');
  const [appliedKeyword, setAppliedKeyword] = useState('');

  useEffect(() => {
    load();
    loadStats();
  }, [appliedType, appliedStatus, appliedRolledBack, appliedKeyword]);

  async function load() {
    setLoading(true);
    const filters: Record<string, string | boolean> = {};
    if (appliedType) filters.type = appliedType;
    if (appliedStatus) filters.status = appliedStatus;
    if (appliedRolledBack !== '') filters.rolledBack = appliedRolledBack === 'true';
    if (appliedKeyword) filters.keyword = appliedKeyword;
    const r = await api.listNotifications(filters);
    if (r.success && r.data) {
      setNotifications(r.data.notifications);
      setTotal(r.data.total);
      setUnreadCount(r.data.unreadCount);
    }
    setLoading(false);
  }

  async function loadStats() {
    const r = await api.getNotificationStats();
    if (r.success && r.data) {
      setStats(r.data.stats);
    }
  }

  function apply() {
    setAppliedType(type);
    setAppliedStatus(status);
    setAppliedRolledBack(rolledBack);
    setAppliedKeyword(keyword);
  }

  function reset() {
    setType('');
    setStatus('');
    setRolledBack('');
    setKeyword('');
    setAppliedType('');
    setAppliedStatus('');
    setAppliedRolledBack('');
    setAppliedKeyword('');
  }

  async function handleMarkAllRead() {
    const r = await api.markAllNotificationsRead();
    if (r.success) {
      showToast(`已标记 ${r.data?.readCount || 0} 条通知为已读`, 'success');
      await load();
      await loadStats();
    } else {
      showToast(r.error || '操作失败', 'error');
    }
  }

  async function handleNotificationClick(notification: ImportNotification) {
    if (!notification.isRead) {
      await api.markNotificationRead(notification.id);
    }
    navigate(`/notifications/${notification.id}`);
  }

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
              <Bell className="w-5 h-5 text-blue-600" />
              通知中心
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">
              导入、导出、草稿、模板、撤销相关的全流程通知
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-sm text-slate-600">
              共 <span className="font-medium text-slate-800">{total}</span> 条，
              <span className="text-amber-600 font-medium">{unreadCount}</span> 条未读
            </div>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 transition"
              >
                <CheckCheck className="w-4 h-4" />
                全部已读
              </button>
            )}
          </div>
        </div>

        {stats && (
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-slate-50 rounded-lg p-3">
              <div className="text-xs text-slate-500">总数</div>
              <div className="text-xl font-semibold text-slate-800 mt-1">{stats.total}</div>
            </div>
            <div className="bg-emerald-50 rounded-lg p-3">
              <div className="text-xs text-emerald-600">成功</div>
              <div className="text-xl font-semibold text-emerald-700 mt-1">{stats.successCount}</div>
            </div>
            <div className="bg-red-50 rounded-lg p-3">
              <div className="text-xs text-red-600">失败</div>
              <div className="text-xl font-semibold text-red-700 mt-1">{stats.failureCount}</div>
            </div>
            <div className="bg-slate-100 rounded-lg p-3">
              <div className="text-xs text-slate-500">已回退</div>
              <div className="text-xl font-semibold text-slate-700 mt-1">{stats.rolledBackCount}</div>
            </div>
          </div>
        )}

        <div className="mt-5 grid grid-cols-1 md:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs text-slate-500 mb-1">通知类型</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as ImportNotificationType | '')}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-400 outline-none text-sm bg-white"
            >
              {TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>{t ? NOTIFICATION_TYPE_LABELS[t] : '全部类型'}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">状态</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as ImportNotificationStatus | '')}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-400 outline-none text-sm bg-white"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{s ? NOTIFICATION_STATUS_LABELS[s] : '全部状态'}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">回退状态</label>
            <select
              value={rolledBack}
              onChange={(e) => setRolledBack(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-400 outline-none text-sm bg-white"
            >
              <option value="">全部</option>
              <option value="false">未回退</option>
              <option value="true">已回退</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">关键字</label>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="标题/消息/批次号"
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-400 outline-none text-sm"
              />
            </div>
          </div>
          <div className="flex gap-2 items-end">
            <button
              onClick={apply}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 transition"
            >
              <Filter className="w-4 h-4" />
              筛选
            </button>
            <button
              onClick={reset}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-slate-600 text-sm hover:bg-slate-50 transition"
            >
              <X className="w-4 h-4" />
              重置
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
        ) : notifications.length === 0 ? (
          <div className="py-16 text-center">
            <Bell className="w-12 h-12 text-slate-300 mx-auto" />
            <div className="mt-3 text-slate-500">暂无通知</div>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {notifications.map((n) => (
              <div
                key={n.id}
                onClick={() => handleNotificationClick(n)}
                className={`p-4 cursor-pointer transition hover:bg-slate-50/70 ${
                  !n.isRead ? 'bg-blue-50/30' : ''
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`w-2 h-2 mt-2 rounded-full shrink-0 ${
                    !n.isRead ? 'bg-blue-500' : 'bg-transparent'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${NOTIFICATION_STATUS_COLORS[n.status]}`}>
                        {NOTIFICATION_STATUS_LABELS[n.status]}
                      </span>
                      <span className="text-xs text-slate-500">
                        {NOTIFICATION_TYPE_LABELS[n.type]}
                      </span>
                      {n.rolledBack && (
                        <span className="inline-flex items-center gap-0.5 text-xs text-slate-500">
                          <RotateCcw className="w-3 h-3" />
                          已回退
                        </span>
                      )}
                      {n.type === 'DRAFT_CONFLICT' && (
                        <span className="inline-flex items-center gap-0.5 text-xs text-amber-600">
                          <AlertTriangle className="w-3 h-3" />
                          冲突
                        </span>
                      )}
                    </div>
                    <div className="font-medium text-slate-800 text-sm">
                      {n.title}
                    </div>
                    <div className="text-sm text-slate-600 mt-1 line-clamp-1">
                      {n.message}
                    </div>
                    <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDate(n.createdAt)}
                      </span>
                      <span>操作人：{n.operatorName}</span>
                      {n.batchCode && (
                        <span>批次：{n.batchCode}</span>
                      )}
                      {n.templateName && (
                        <span>模板：{n.templateName}</span>
                      )}
                    </div>
                    {n.status === 'FAILURE' && n.result?.error && (
                      <div className="mt-2 text-xs text-red-600 bg-red-50 rounded px-2 py-1 inline-block">
                        失败原因：{String(n.result.error)}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0">
                    <ChevronRight className="w-5 h-5 text-slate-300" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
