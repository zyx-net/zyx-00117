import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAppStore } from '@/store';
import { ROLE_LABELS } from '@/types';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const login = useAppStore((s) => s.login);
  const user = useAppStore((s) => s.user);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (user) {
      const from = (location.state as { from?: string })?.from || '/';
      navigate(from, { replace: true });
    }
  }, [user, navigate, location.state]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setLoading(true);
    const r = await login(username.trim(), password);
    setLoading(false);
    if (!r.success) {
      setErr(r.error || '登录失败');
    }
  }

  const accounts = [
    { role: 'SAMPLER', u: 'sampler1', p: 'sampler123', name: '张采样' },
    { role: 'RECEIVER', u: 'receiver1', p: 'receiver123', name: '王接收' },
    { role: 'RECEIVER', u: 'receiver2', p: 'receiver123', name: '赵接收' },
    { role: 'ADMIN', u: 'admin1', p: 'admin123', name: '孙管理' },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl border border-slate-100 p-8">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 mb-4 shadow-lg">
              <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-slate-800">实验室样本交接看板</h1>
            <p className="text-sm text-slate-500 mt-2">安全登录 · 全程追溯 · 审计留痕</p>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">用户名</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                placeholder="请输入用户名"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">密码</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                placeholder="请输入密码"
              />
            </div>
            {err && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2.5 rounded-lg text-sm">
                {err}
              </div>
            )}
            <button
              type="submit"
              disabled={loading || !username || !password}
              className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg shadow-md transition"
            >
              {loading ? '登录中...' : '登 录'}
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-slate-100">
            <p className="text-xs text-slate-500 mb-3 font-medium">测试账号（点击填入）：</p>
            <div className="grid grid-cols-2 gap-2">
              {accounts.map((a) => (
                <button
                  key={a.u}
                  type="button"
                  onClick={() => { setUsername(a.u); setPassword(a.p); }}
                  className="text-left text-xs p-2.5 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50 transition"
                >
                  <div className="font-medium text-slate-700">{a.name}</div>
                  <div className="text-slate-500">{ROLE_LABELS[a.role as keyof typeof ROLE_LABELS]} · {a.u}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="text-center text-xs text-slate-400 mt-4">© 2025 实验室样本管理系统</p>
      </div>
    </div>
  );
}
