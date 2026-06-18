import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '@/api';
import { useAppStore } from '@/store';
import type { ImportNotification, Batch, ImportDraft, SampleTemplate, AuditEntry } from '@/types';
import {
  NOTIFICATION_TYPE_LABELS,
  NOTIFICATION_STATUS_COLORS,
  NOTIFICATION_STATUS_LABELS,
  BATCH_STATUS_LABELS,
  formatDate,
} from '@/types';
import {
  ArrowLeft,
  Bell,
  Clock,
  User,
  Package,
  FileText,
  LayoutTemplate,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  History,
  ChevronRight,
  Eye,
} from 'lucide-react';

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
  CREATE_TEMPLATE: '创建模板',
  UPDATE_TEMPLATE: '更新模板',
  DEACTIVATE_TEMPLATE: '停用模板',
  CREATE_DRAFT: '创建草稿',
  UPDATE_DRAFT: '更新草稿',
  DELETE_DRAFT: '删除草稿',
  CANCEL_DRAFT: '取消草稿',
  SUBMIT_DRAFT: '提交草稿',
  DRAFT_CONFLICT_BLOCKED: '草稿冲突拦截',
  UNDO_IMPORT: '撤销导入',
  UNAUTHORIZED_UNDO_ATTEMPT: '越权撤销尝试',
  UNDO_BLOCKED: '撤销阻断',
  UNDO_REVERT_DRAFT: '撤销回退草稿',
  UNDO_CLEANUP_EXPORT_CONFIGS: '撤销清理导出配置',
  ROLLBACK_NOTIFICATIONS: '回退通知',
  APPLY_TEMPLATE: '套用模板',
};

export default function NotificationDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [notification, setNotification] = useState<ImportNotification | null>(null);
  const [relatedBatch, setRelatedBatch] = useState<Batch | null>(null);
  const [relatedDraft, setRelatedDraft] = useState<ImportDraft | null>(null);
  const [relatedTemplate, setRelatedTemplate] = useState<SampleTemplate | null>(null);
  const [auditTimeline, setAuditTimeline] = useState<AuditEntry[]>([]);
  const showToast = useAppStore((s) => s.showToast);

  useEffect(() => {
    if (id) load(id);
  }, [id]);

  async function load(notifId: string) {
    setLoading(true);
    const r = await api.getNotificationDetail(notifId);
    if (r.success && r.data) {
      setNotification(r.data.notification);
      setRelatedBatch(r.data.relatedBatch);
      setRelatedDraft(r.data.relatedDraft);
      setRelatedTemplate(r.data.relatedTemplate);
      setAuditTimeline(r.data.auditTimeline || []);
    } else {
      showToast(r.error || '加载通知详情失败', 'error');
      navigate('/notifications');
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

  if (!notification) return null;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/notifications')}
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 transition"
        >
          <ArrowLeft className="w-4 h-4" />
          返回通知列表
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
            <Bell className="w-5 h-5 text-blue-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-semibold text-slate-800">{notification.title}</h2>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${NOTIFICATION_STATUS_COLORS[notification.status]}`}>
                {NOTIFICATION_STATUS_LABELS[notification.status]}
              </span>
              {notification.rolledBack && (
                <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
                  <RotateCcw className="w-3 h-3" />
                  已回退
                </span>
              )}
              {notification.type === 'DRAFT_CONFLICT' && (
                <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                  <AlertTriangle className="w-3 h-3" />
                  冲突提示
                </span>
              )}
            </div>
            <div className="text-sm text-slate-500 mt-1">
              {NOTIFICATION_TYPE_LABELS[notification.type]}
            </div>
          </div>
        </div>

        <div className="mt-4 p-4 bg-slate-50 rounded-lg">
          <p className="text-sm text-slate-700">{notification.message}</p>
        </div>

        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-xs text-slate-500">操作者</div>
            <div className="flex items-center gap-1.5 mt-1 font-medium text-slate-700">
              <User className="w-4 h-4 text-slate-400" />
              {notification.operatorName}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">创建时间</div>
            <div className="flex items-center gap-1.5 mt-1 font-medium text-slate-700">
              <Clock className="w-4 h-4 text-slate-400" />
              {formatDate(notification.createdAt)}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">通知ID</div>
            <div className="mt-1 font-mono text-xs text-slate-600 truncate" title={notification.id}>
              {notification.id.slice(0, 24)}...
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">阅读状态</div>
            <div className="flex items-center gap-1.5 mt-1">
              {notification.isRead ? (
                <span className="text-slate-500 text-sm">已读</span>
              ) : (
                <span className="text-blue-600 text-sm font-medium">未读</span>
              )}
            </div>
          </div>
        </div>

        {notification.rolledBack && notification.rolledBackByName && (
          <div className="mt-4 p-3 bg-slate-50 border border-slate-200 rounded-lg">
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <RotateCcw className="w-4 h-4" />
              <span>
                由 <span className="font-medium">{notification.rolledBackByName}</span> 于
                <span className="font-medium"> {formatDate(notification.rolledBackAt!)}</span> 回退
              </span>
            </div>
          </div>
        )}

        {notification.status === 'FAILURE' && notification.result?.error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-start gap-2">
              <XCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
              <div>
                <div className="text-sm font-medium text-red-800">失败原因</div>
                <div className="text-sm text-red-700 mt-1">{String(notification.result.error)}</div>
              </div>
            </div>
          </div>
        )}

        {notification.result && (
          <div className="mt-4">
            <div className="text-xs text-slate-500 mb-2">处理结果</div>
            <details className="text-sm">
              <summary className="cursor-pointer text-slate-600 hover:text-slate-800">查看详细数据</summary>
              <pre className="mt-2 p-3 bg-slate-50 rounded-lg text-xs overflow-x-auto max-h-60">
                {JSON.stringify(notification.result, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <h3 className="text-base font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <Package className="w-4 h-4 text-blue-600" />
          关联对象
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {relatedBatch ? (
            <Link
              to={`/batches/${relatedBatch.id}`}
              className="p-4 border border-slate-200 rounded-lg hover:border-blue-300 hover:bg-blue-50/30 transition block"
            >
              <div className="flex items-center gap-2 mb-2">
                <Package className="w-4 h-4 text-blue-500" />
                <span className="text-xs text-slate-500">关联批次</span>
              </div>
              <div className="font-medium text-slate-800 text-sm truncate">{relatedBatch.batchCode}</div>
              <div className="text-xs text-slate-500 mt-1">
                状态：{BATCH_STATUS_LABELS[relatedBatch.status]}
              </div>
            </Link>
          ) : notification.batchCode ? (
            <div className="p-4 border border-slate-200 border-dashed rounded-lg bg-slate-50">
              <div className="flex items-center gap-2 mb-2">
                <Package className="w-4 h-4 text-slate-400" />
                <span className="text-xs text-slate-500">关联批次</span>
              </div>
              <div className="font-medium text-slate-600 text-sm">{notification.batchCode}</div>
              <div className="text-xs text-slate-400 mt-1">已删除（可能被撤销）</div>
            </div>
          ) : (
            <div className="p-4 border border-slate-200 border-dashed rounded-lg opacity-50">
              <div className="flex items-center gap-2 mb-2">
                <Package className="w-4 h-4 text-slate-300" />
                <span className="text-xs text-slate-400">无关联批次</span>
              </div>
            </div>
          )}

          {relatedDraft ? (
            <div className="p-4 border border-slate-200 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <FileText className="w-4 h-4 text-indigo-500" />
                <span className="text-xs text-slate-500">关联草稿</span>
              </div>
              <div className="font-medium text-slate-800 text-sm truncate">{relatedDraft.name}</div>
              <div className="text-xs text-slate-500 mt-1">
                状态：{relatedDraft.status} · 版本 {relatedDraft.version}
              </div>
            </div>
          ) : notification.draftId ? (
            <div className="p-4 border border-slate-200 border-dashed rounded-lg bg-slate-50">
              <div className="flex items-center gap-2 mb-2">
                <FileText className="w-4 h-4 text-slate-400" />
                <span className="text-xs text-slate-500">关联草稿</span>
              </div>
              <div className="font-mono text-xs text-slate-500 truncate">{notification.draftId}</div>
              <div className="text-xs text-slate-400 mt-1">已删除</div>
            </div>
          ) : (
            <div className="p-4 border border-slate-200 border-dashed rounded-lg opacity-50">
              <div className="flex items-center gap-2 mb-2">
                <FileText className="w-4 h-4 text-slate-300" />
                <span className="text-xs text-slate-400">无关联草稿</span>
              </div>
            </div>
          )}

          {relatedTemplate ? (
            <div className="p-4 border border-slate-200 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <LayoutTemplate className="w-4 h-4 text-emerald-500" />
                <span className="text-xs text-slate-500">关联模板</span>
              </div>
              <div className="font-medium text-slate-800 text-sm truncate">{relatedTemplate.name}</div>
              <div className="text-xs text-slate-500 mt-1">
                {relatedTemplate.isActive ? '启用中' : '已停用'} · 版本 {relatedTemplate.version}
              </div>
            </div>
          ) : notification.templateName ? (
            <div className="p-4 border border-slate-200 border-dashed rounded-lg bg-slate-50">
              <div className="flex items-center gap-2 mb-2">
                <LayoutTemplate className="w-4 h-4 text-slate-400" />
                <span className="text-xs text-slate-500">关联模板</span>
              </div>
              <div className="font-medium text-slate-600 text-sm">{notification.templateName}</div>
              <div className="text-xs text-slate-400 mt-1">快照版本</div>
            </div>
          ) : (
            <div className="p-4 border border-slate-200 border-dashed rounded-lg opacity-50">
              <div className="flex items-center gap-2 mb-2">
                <LayoutTemplate className="w-4 h-4 text-slate-300" />
                <span className="text-xs text-slate-400">无关联模板</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <h3 className="text-base font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <History className="w-4 h-4 text-blue-600" />
          审计时间线
        </h3>
        {auditTimeline.length === 0 ? (
          <div className="py-8 text-center text-slate-400 text-sm">
            暂无相关审计记录
          </div>
        ) : (
          <div className="relative pl-6">
            <div className="absolute left-2 top-1 bottom-1 w-0.5 bg-slate-200" />
            {auditTimeline.map((audit, idx) => (
              <div key={audit.id} className="relative pb-5 last:pb-0">
                <div className={`absolute -left-[22px] w-4 h-4 rounded-full border-2 ${
                  audit.success
                    ? 'border-emerald-500 bg-emerald-50'
                    : 'border-red-500 bg-red-50'
                }`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${
                    audit.success ? 'bg-emerald-500' : 'bg-red-500'
                  } absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2`} />
                </div>
                <div className="bg-slate-50 rounded-lg p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium text-sm text-slate-800">
                      {ACTION_LABELS[audit.action] || audit.action}
                    </div>
                    {audit.success ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                    <span>{audit.operatorName}</span>
                    <span>{formatDate(audit.timestamp)}</span>
                  </div>
                  {audit.failureReason && (
                    <div className="mt-2 text-xs text-red-600 bg-red-50 rounded px-2 py-1">
                      {audit.failureReason}
                    </div>
                  )}
                  {audit.afterState && !audit.failureReason && (
                    <details className="mt-2 text-xs">
                      <summary className="cursor-pointer text-slate-500 hover:text-slate-700">变更详情</summary>
                      <pre className="mt-2 p-2 bg-white rounded text-xs overflow-x-auto">
                        {JSON.stringify(audit.afterState, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
