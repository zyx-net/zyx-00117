import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useAppStore } from '@/store';
import { ROLE_LABELS } from '@/types';
import {
  LayoutDashboard,
  FlaskConical,
  ClipboardList,
  Users,
  FileBarChart,
  LogOut,
  Bell,
  UserCircle2,
  ShieldCheck,
  Send,
  PackageCheck,
  RotateCcw,
  MessageSquare,
} from 'lucide-react';

export default function MainLayout() {
  const user = useAppStore((s) => s.user);
  const logout = useAppStore((s) => s.logout);
  const init = useAppStore((s) => s.init);
  const initialized = useAppStore((s) => s.initialized);
  const unreadCount = useAppStore((s) => s.unreadNotificationCount);
  const refreshUnreadCount = useAppStore((s) => s.refreshUnreadCount);
  const navigate = useNavigate();
  const toast = useAppStore((s) => s.toast);
  const clearToast = useAppStore((s) => s.clearToast);

  useEffect(() => {
    if (!initialized) init();
  }, [initialized, init]);

  useEffect(() => {
    if (initialized && user) {
      refreshUnreadCount();
      const interval = setInterval(refreshUnreadCount, 30000);
      return () => clearInterval(interval);
    }
  }, [initialized, user, refreshUnreadCount]);

  useEffect(() => {
    if (initialized && !user) {
      navigate('/login', { replace: true, state: { from: location.pathname } });
    }
  }, [user, initialized, navigate]);

  if (!user) return null;

  const isSampler = user.role === 'SAMPLER';
  const isReceiver = user.role === 'RECEIVER';
  const isAdmin = user.role === 'ADMIN';

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  function goToNotifications() {
    navigate('/notifications');
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="flex min-h-screen">
        <aside className="w-64 bg-white border-r border-slate-200 flex flex-col shrink-0">
          <div className="h-16 px-6 border-b border-slate-100 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-md">
              <FlaskConical className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="font-bold text-slate-800 text-sm leading-tight">样本交接看板</div>
              <div className="text-xs text-slate-500">Labs Handover</div>
            </div>
          </div>

          <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
            <NavItem to="/" icon={LayoutDashboard} label="总览看板" end />

            {(isSampler || isAdmin) && (
              <NavItem to="/register" icon={ClipboardList} label="样本登记" />
            )}

            {(isSampler || isAdmin) && (
              <NavItem to="/handover" icon={Send} label="发起交接" />
            )}

            {(isReceiver || isAdmin) && (
              <NavItem to="/receive" icon={PackageCheck} label="签收管理" />
            )}

            {(isReceiver || isAdmin) && (
              <NavItem to="/return" icon={RotateCcw} label="退回重交" />
            )}

            <NavItem to="/batches" icon={FileBarChart} label="批次查询" />
            <NavItem to="/samples" icon={FlaskConical} label="样本追溯" />

            <NavItem to="/notifications" icon={MessageSquare} label="通知中心" badge={unreadCount} />

            {isAdmin && (
              <NavItem to="/audit" icon={ShieldCheck} label="审计历史" />
            )}

            {isAdmin && (
              <NavItem to="/users" icon={Users} label="用户列表" />
            )}
          </nav>

          <div className="p-3 border-t border-slate-100">
            <div className="bg-slate-50 rounded-lg p-3 mb-2">
              <div className="flex items-center gap-2">
                <UserCircle2 className="w-5 h-5 text-slate-500" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-800 truncate">{user.name}</div>
                  <div className="text-xs text-slate-500">{ROLE_LABELS[user.role]} · {user.department}</div>
                </div>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-600 hover:bg-red-50 hover:text-red-600 transition"
            >
              <LogOut className="w-4 h-4" />
              <span>退出登录</span>
            </button>
          </div>
        </aside>

        <main className="flex-1 flex flex-col min-w-0">
          <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between sticky top-0 z-20">
            <h1 className="text-lg font-semibold text-slate-800">
              欢迎回来，<span className="text-blue-600">{user.name}</span>
            </h1>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100">
                {ROLE_LABELS[user.role]}
              </span>
              <button
                onClick={goToNotifications}
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 transition relative"
                title="通知中心"
              >
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>
            </div>
          </header>

          <div className="flex-1 p-6 overflow-auto">
            <Outlet />
          </div>
        </main>
      </div>

      {toast && (
        <div className="fixed top-5 right-5 z-50 animate-[fadeIn_.2s_ease-out]">
          <div
            className={`px-4 py-3 rounded-lg shadow-lg border min-w-72 ${
              toast.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : toast.type === 'error'
                ? 'bg-red-50 text-red-800 border-red-200'
                : 'bg-blue-50 text-blue-800 border-blue-200'
            }`}
            onClick={clearToast}
          >
            {toast.message}
          </div>
        </div>
      )}
    </div>
  );
}

function NavItem({
  to,
  icon: Icon,
  label,
  end,
  badge,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  end?: boolean;
  badge?: number;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition ${
          isActive
            ? 'bg-blue-50 text-blue-700 font-medium'
            : 'text-slate-600 hover:bg-slate-50 hover:text-slate-800'
        }`
      }
    >
      <Icon className="w-4 h-4" />
      <span className="flex-1">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="min-w-[20px] h-5 px-1.5 bg-red-500 text-white text-[11px] font-bold rounded-full flex items-center justify-center">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </NavLink>
  );
}
