import React, { useEffect, useState } from 'react';
import SectionHeading from '../components/common/SectionHeading';
import { listReceipts, finalizeInspection } from '../lib/wmsV2Api';
import { PackageCheck, CheckCircle, XCircle, AlertCircle, Loader2, ListTodo, ShieldCheck, ClipboardCheck, X } from 'lucide-react';

const QualityControlPage = ({ user }) => {
  const [receipts, setReceipts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [viewingReceipt, setViewingReceipt] = useState(null);
  const [inspectLines, setInspectLines] = useState([]);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await listReceipts();
      setReceipts(data.receipts || []);
    } catch (e) { setError(e.message || '质检数据加载失败'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const openInspect = (r) => {
    setViewingReceipt(r);
    setInspectLines((r.v2_warehouse_receipt_lines || []).map(l => ({
      receipt_line_id: l.id,
      sku_code: l.sku_code,
      received_qty: l.received_qty,
      pass_qty: l.received_qty,
      fail_qty: 0,
      fail_reason: ''
    })));
  };

  const handleSubmit = async () => {
    const invalid = inspectLines.find((line) => Number(line.pass_qty) < 0 || Number(line.fail_qty) < 0 || Number(line.pass_qty) + Number(line.fail_qty) !== Number(line.received_qty));
    if (invalid) return alert(`SKU ${invalid.sku_code} 的合格数量 + 不良数量必须等于待检数量`);
    const missingReason = inspectLines.find((line) => Number(line.fail_qty) > 0 && !String(line.fail_reason || '').trim());
    if (missingReason) return alert(`SKU ${missingReason.sku_code} 存在不良品，请填写不良原因`);
    setProcessing(true);
    try {
      const notes = inspectLines.some((line) => Number(line.fail_qty) > 0) ? '质检完成（含不良品）' : '质检全部合格';
      await finalizeInspection(viewingReceipt.id, inspectLines, notes);
      setViewingReceipt(null);
      await load();
    } catch (e) { alert(e.message); }
    finally { setProcessing(false); }
  };

  const pendingReceipts = receipts.filter((receipt) => receipt.status === 'received');

  return (
    <div className="space-y-6">
      <SectionHeading title="质检与入库中心" subtitle="对仓库收货及车间完工产品进行品质终审，驱动可用库存生效" />

      {error && (
        <div className="card p-4 border-red-100 bg-red-50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3 text-red-600"><AlertCircle size={20} className="mt-0.5 flex-shrink-0" /><div><p className="text-sm font-bold">质检数据加载失败</p><p className="text-xs mt-1">{error}</p></div></div>
          <button onClick={load} className="btn-secondary bg-white text-red-600 border-red-200 px-4 py-2 text-xs font-bold">重新加载</button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4">
        {loading ? <div className="py-20 text-center"><Loader2 className="animate-spin mx-auto text-blue-500" /><p className="text-xs text-gray-400 mt-3">正在加载质检记录…</p></div> : error ? null : pendingReceipts.length === 0 ? <div className="card p-20 text-center text-gray-400">暂无待质检记录</div> : pendingReceipts.map(r => (
          <div key={r.id} className="card p-5 hover:shadow-md transition-all border-l-4 border-emerald-500 flex flex-col md:flex-row justify-between items-center gap-4">
             <div className="flex items-center gap-4">
                <div className="h-10 w-10 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600"><PackageCheck size={20} /></div>
                <div>
                   <p className="text-sm font-black text-gray-800">{r.receipt_no}</p>
                   <p className="text-[10px] text-gray-400 uppercase tracking-widest">收货时间：{new Date(r.received_at).toLocaleString()}</p>
                </div>
             </div>
             <div className="flex items-center gap-4">
                <div className="text-right mr-4"><p className="text-[10px] font-bold text-gray-400 uppercase">明细项</p><p className="text-xs font-black">{r.v2_warehouse_receipt_lines?.length || 0}</p></div>
                <button onClick={() => openInspect(r)} className="btn-primary flex items-center gap-2 px-6"><ClipboardCheck size={16} /> 执行质检</button>
             </div>
          </div>
        ))}
      </div>

      {viewingReceipt && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-4xl p-6 shadow-2xl animate-in zoom-in-95">
             <div className="flex justify-between items-center mb-6">
                <div>
                   <h3 className="text-xl font-bold">品质检验终审</h3>
                   <p className="text-xs text-gray-500">正在核验单据：{viewingReceipt.receipt_no}</p>
                </div>
                <button onClick={() => setViewingReceipt(null)} className="p-2 hover:bg-gray-100 rounded-full"><X size={20} /></button>
             </div>

             <div className="border rounded-xl overflow-hidden mb-6">
                <table className="w-full text-xs text-left">
                   <thead className="bg-gray-50 text-gray-500 uppercase">
                      <tr>
                        <th className="px-4 py-3">SKU</th>
                        <th className="px-4 py-3">待检数量</th>
                        <th className="px-4 py-3 w-32">合格数量</th>
                        <th className="px-4 py-3 w-32">不良数量</th>
                        <th className="px-4 py-3">差异原因/备注</th>
                      </tr>
                   </thead>
                   <tbody className="divide-y">
                      {inspectLines.map((l, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                           <td className="px-4 py-4 font-bold">{l.sku_code}</td>
                           <td className="px-4 py-4 font-black text-gray-400">{l.received_qty}</td>
                           <td className="px-4 py-4">
                              <input type="number" min="0" max={l.received_qty} step="0.001" className="input-field py-1 px-2 border-emerald-200 bg-emerald-50/30 font-black text-emerald-700" value={l.pass_qty} onChange={e => {
                                 const val = Math.min(Number(l.received_qty), Math.max(0, Number(e.target.value || 0)));
                                 const newLines = [...inspectLines];
                                 newLines[i].pass_qty = val;
                                 newLines[i].fail_qty = l.received_qty - val;
                                 setInspectLines(newLines);
                              }} />
                           </td>
                           <td className="px-4 py-4">
                              <input type="number" min="0" max={l.received_qty} step="0.001" className="input-field py-1 px-2 border-red-200 bg-red-50/30 font-black text-red-700" value={l.fail_qty} onChange={e => {
                                 const val = Math.min(Number(l.received_qty), Math.max(0, Number(e.target.value || 0)));
                                 const newLines = [...inspectLines];
                                 newLines[i].fail_qty = val;
                                 newLines[i].pass_qty = l.received_qty - val;
                                 setInspectLines(newLines);
                              }} />
                           </td>
                           <td className="px-4 py-4"><input className="input-field py-1" value={l.fail_reason} onChange={e => {
                              const newLines = [...inspectLines];
                              newLines[i].fail_reason = e.target.value;
                              setInspectLines(newLines);
                           }} placeholder="合格不填" /></td>
                        </tr>
                      ))}
                   </tbody>
                </table>
             </div>

             <div className="p-4 bg-amber-50 border border-amber-100 rounded-xl flex items-start gap-3 mb-6">
                <ShieldCheck size={20} className="text-amber-600 mt-1" />
                <div className="text-xs text-amber-800 leading-relaxed">
                   <p className="font-bold mb-1">财务一致性说明：</p>
                   <ul className="list-disc pl-4 space-y-1">
                     <li>合格品先进入可用库存；如来自关联销售订单的生产工单，会自动优先锁定给对应订单。</li>
                     <li>不良品自动划转到不良品状态，等待后续退货、返工或报废处理。</li>
                     <li>同一收货单只能正式质检入账一次，请核对实物后再确认。</li>
                   </ul>
                </div>
             </div>

             <button onClick={handleSubmit} disabled={processing} className="w-full btn-primary py-4 flex items-center justify-center gap-2 shadow-xl shadow-blue-100">
                {processing ? <Loader2 size={20} className="animate-spin" /> : <CheckCircle size={20} />}
                确认质检结果并正式入库
             </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default QualityControlPage;
