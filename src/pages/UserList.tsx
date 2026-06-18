import { useEffect, useState } from 'react';
import { api } from '@/api';
import type { User } from '@/types';
import { ROLE_LABELS } from '@/types';
import { Clock, User as UserIcon, FlaskConical, ClipboardList, Shield } from 'lucide-react';

export default function UserList() {
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<User[]>([]);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const r = await api.listUsers();
    if (r.success && r.data) setUsers(r.data);
    setLoading(false);
  }

  const roleIcon = (role: User['role']) => {
    switch (role) {
      case 'SAMPLER': return <FlaskConical className="w-5 h-5 text-amber-500" />;
      case 'RECEIVER': return <ClipboardList className="w-5 h-5 text-emerald-500" />;
      case 'ADMIN': return <Shield className="w-5 h-5 text-indigo-500" />;
    }
  };

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
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <h2 className="text-lg font-semibold text-slate-800">用户列表</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          系统预置账号。账号信息详见 README.md。
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {users.map((u) => (
          <div key={u.id} className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 hover:shadow-md transition">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center shrink-0">
                {roleIcon(u.role)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-slate-800">{u.name}</div>
                <div className="text-xs text-slate-500 mt-0.5">{u.department}</div>
              </div>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${
                u.role === 'ADMIN' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' :
                u.role === 'RECEIVER' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                'bg-amber-50 text-amber-700 border-amber-200'
              }`}>
                {ROLE_LABELS[u.role]}
              </span>
            </div>
            <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-2 gap-3 text-xs">
              <div>
                <div className="text-slate-500 mb-0.5">用户名</div>
                <div className="font-mono text-slate-700 bg-slate-50 px-2 py-1 rounded">{u.username}</div>
              </div>
              <div>
                <div className="text-slate-500 mb-0.5">密码</div>
                <div className="font-mono text-slate-700 bg-slate-50 px-2 py-1 rounded">
                  {u.role === 'SAMPLER' ? 'sampler123' :
                   u.role === 'RECEIVER' ? 'receiver123' : 'admin123'}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
        <strong>⚠️ 安全提示：</strong>本系统为本地演示用途，密码已明文展示。生产环境请使用强密码、bcrypt 加密存储，并启用 HTTPS。
      </div>
    </div>
  );
}
