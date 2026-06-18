import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api';
import { useAppStore } from '@/store';
import type { RegisterSampleInput } from '@/types';
import { Plus, X, Save, AlertCircle, ArrowRight } from 'lucide-react';

interface RowData extends RegisterSampleInput {
  _id: string;
}

const SAMPLE_TYPES = ['血液样本', '尿液样本', '组织样本', '细胞样本', '唾液样本', '核酸样本', '其他'];

export default function RegisterSamples() {
  const [rows, setRows] = useState<RowData[]>([createRow()]);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const navigate = useNavigate();
  const showToast = useAppStore((s) => s.showToast);

  function createRow(): RowData {
    return {
      _id: Math.random().toString(36).slice(2),
      sampleCode: '',
      type: '血液样本',
      description: '',
      sourceLocation: '',
      minTemp: 2,
      maxTemp: 8,
      initialTemperature: 4,
      tempLocation: '采样现场',
    };
  }

  function addRow() {
    setRows([...rows, createRow()]);
  }

  function removeRow(id: string) {
    if (rows.length <= 1) return;
    setRows(rows.filter((r) => r._id !== id));
    const ne = { ...errors };
    delete ne[id];
    setErrors(ne);
  }

  function updateRow(id: string, key: keyof RowData, value: unknown) {
    setRows(rows.map((r) => (r._id === id ? { ...r, [key]: value } : r)));
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    for (const r of rows) {
      const msgs: string[] = [];
      if (!r.sampleCode.trim()) msgs.push('样本编号不能为空');
      if (!r.type) msgs.push('类型不能为空');
      if (!r.sourceLocation.trim()) msgs.push('采样地点不能为空');
      if (Number(r.minTemp) >= Number(r.maxTemp)) msgs.push('温度范围错误');
      if (r.initialTemperature === undefined || r.initialTemperature === null || isNaN(Number(r.initialTemperature))) {
        msgs.push('初始温度缺失');
      }
      if (msgs.length) errs[r._id] = msgs.join('; ');
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function submit() {
    if (!validate()) {
      showToast('请修正表单错误', 'error');
      return;
    }
    setSubmitting(true);
    const inputs: RegisterSampleInput[] = rows.map(({ _id, ...rest }) => ({
      ...rest,
      minTemp: Number(rest.minTemp),
      maxTemp: Number(rest.maxTemp),
      initialTemperature: Number(rest.initialTemperature),
    }));
    const r = await api.registerSamples(inputs);
    setSubmitting(false);
    if (r.success && r.data) {
      showToast(`成功登记 ${inputs.length} 个样本，批次 ${r.data.batch.batchCode}`, 'success');
      navigate(`/batches/${r.data.batch.id}`);
    } else {
      showToast(r.error || '登记失败', 'error');
    }
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">批量登记样本</h2>
            <p className="text-sm text-slate-500 mt-0.5">填写样本信息后创建批次，初始温度记录必填。</p>
          </div>
          <div className="text-xs text-slate-500">样本数：{rows.length}</div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 sticky top-0">
              <tr>
                <th className="px-4 py-3 text-left font-medium w-10">#</th>
                <th className="px-4 py-3 text-left font-medium">样本编号 *</th>
                <th className="px-4 py-3 text-left font-medium">类型</th>
                <th className="px-4 py-3 text-left font-medium">描述</th>
                <th className="px-4 py-3 text-left font-medium">采样地点 *</th>
                <th className="px-4 py-3 text-center font-medium">最小温度</th>
                <th className="px-4 py-3 text-center font-medium">最大温度</th>
                <th className="px-4 py-3 text-center font-medium">初始温度 *</th>
                <th className="px-4 py-3 text-left font-medium">温控地点</th>
                <th className="px-4 py-3 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r, idx) => (
                <tr key={r._id} className={errors[r._id] ? 'bg-red-50/40' : ''}>
                  <td className="px-4 py-3 text-slate-400">{idx + 1}</td>
                  <td className="px-4 py-2">
                    <input
                      value={r.sampleCode}
                      onChange={(e) => updateRow(r._id, 'sampleCode', e.target.value)}
                      placeholder="如 S202501001"
                      className="w-full px-2.5 py-1.5 rounded-md border border-slate-200 focus:ring-2 focus:ring-blue-400 focus:border-blue-400 outline-none"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <select
                      value={r.type}
                      onChange={(e) => updateRow(r._id, 'type', e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-md border border-slate-200 focus:ring-2 focus:ring-blue-400 outline-none"
                    >
                      {SAMPLE_TYPES.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2">
                    <input
                      value={r.description}
                      onChange={(e) => updateRow(r._id, 'description', e.target.value)}
                      placeholder="备注"
                      className="w-full px-2.5 py-1.5 rounded-md border border-slate-200 focus:ring-2 focus:ring-blue-400 outline-none"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      value={r.sourceLocation}
                      onChange={(e) => updateRow(r._id, 'sourceLocation', e.target.value)}
                      placeholder="如：门诊3楼"
                      className="w-full px-2.5 py-1.5 rounded-md border border-slate-200 focus:ring-2 focus:ring-blue-400 outline-none"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="number"
                      value={r.minTemp}
                      onChange={(e) => updateRow(r._id, 'minTemp', e.target.value)}
                      className="w-20 px-2.5 py-1.5 rounded-md border border-slate-200 focus:ring-2 focus:ring-blue-400 outline-none text-center"
                    />
                    <span className="text-xs text-slate-400 ml-1">℃</span>
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="number"
                      value={r.maxTemp}
                      onChange={(e) => updateRow(r._id, 'maxTemp', e.target.value)}
                      className="w-20 px-2.5 py-1.5 rounded-md border border-slate-200 focus:ring-2 focus:ring-blue-400 outline-none text-center"
                    />
                    <span className="text-xs text-slate-400 ml-1">℃</span>
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="number"
                      step="0.1"
                      value={r.initialTemperature}
                      onChange={(e) => updateRow(r._id, 'initialTemperature', e.target.value)}
                      className={`w-20 px-2.5 py-1.5 rounded-md border focus:ring-2 outline-none text-center ${
                        r.initialTemperature < r.minTemp || r.initialTemperature > r.maxTemp
                          ? 'border-red-300 bg-red-50 focus:ring-red-400'
                          : 'border-slate-200 focus:ring-blue-400'
                      }`}
                    />
                    <span className="text-xs text-slate-400 ml-1">℃</span>
                  </td>
                  <td className="px-4 py-2">
                    <input
                      value={r.tempLocation}
                      onChange={(e) => updateRow(r._id, 'tempLocation', e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-md border border-slate-200 focus:ring-2 focus:ring-blue-400 outline-none"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <button
                      onClick={() => removeRow(r._id)}
                      disabled={rows.length <= 1}
                      className="p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-30 transition"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {Object.keys(errors).length > 0 && (
          <div className="px-6 pt-4">
            {Object.entries(errors).map(([id, msg]) => (
              <div key={id} className="flex items-start gap-2 text-xs text-red-600 mb-1.5">
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>第 {rows.findIndex((r) => r._id === id) + 1} 行：{msg}</span>
              </div>
            ))}
          </div>
        )}

        <div className="px-6 py-5 border-t border-slate-100 flex items-center justify-between">
          <button
            onClick={addRow}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-dashed border-slate-300 text-slate-600 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition text-sm"
          >
            <Plus className="w-4 h-4" />
            添加样本
          </button>

          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(-1)}
              className="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100 transition text-sm"
            >
              取消
            </button>
            <button
              onClick={submit}
              disabled={submitting || rows.length === 0}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-sm font-medium shadow-md hover:shadow-lg disabled:opacity-50 transition"
            >
              <Save className="w-4 h-4" />
              {submitting ? '提交中...' : '登记并创建批次'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
