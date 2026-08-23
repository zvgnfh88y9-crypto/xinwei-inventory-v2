import React, { useEffect, useMemo, useState } from 'react';
import SectionHeading from '../components/common/SectionHeading';
import { listReceipts, finalizeInspection } from '../lib/wmsV2Api';
import { PackageCheck, CheckCircle, XCircle, AlertCircle, Loader2, ListTodo, ShieldCheck, ClipboardCheck, X, Activity, BarChart3, TrendingUp, History, Factory, ShoppingCart, Image as ImageIcon } from 'lucide-react';
import { getSignedUrls } from '../lib/inventoryApi';

const QualityControlPage = ({ user }) => {
  const [receipts, setReceipts] = useState([]);
  const [imageUrls, setImageUrls] = useState({});
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
      const allReceipts = data.receipts || [];
      setReceipts(allReceipts);
      
      // 提取所有 SKU 的路径进行批量签名
      const paths = [...new Set(allReceipts.flatMap(r => (r.v2_warehouse_receipt_lines || []).map(l => l.image_path)).filter(Boolean))];
      if (paths.length > 0) {
        const urls = await getSignedUrls(paths, { thumbnail: true });
        setImageUrls(urls);
      }
    } catch (e) { setError(e.message || '质检数据加载失败'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const stats = useMemo(() => {
    const pending = receipts.filter(r => r.status === 'received');
    const processed = receipts.filter(r => r.status === 'posted');
    const totalLines = processed.flatMap(r => r.v2_warehouse_receipt_lines || []);
    const passQty = totalLines.reduce((sum, l) => sum + Number(l.pass_qty || 0), 0);
    const failQty = totalLines.reduce((sum, l) => sum + Number(l.fail_qty || 0), 0);
    const rate = passQty + failQty > 0 ? (passQty / (passQty + failQty) * 100).toFixed(1) : '100';
    
    return {
        pendingCount: pending.length,
        passRate: rate,
        failCount: failQty
    };
  }, [receipts]);

  const openInspect = (r) => {
    setViewingReceipt(r);
    setInspectLines((r.v2_warehouse_receipt_lines || []).map(l => ({
      receipt_line_id: l.id,
      sku_code: l.sku_code,
      received_qty: l.received_qty,
      pass_qty: l.received_qty,
      fail_qty: 0,
      fail_reason: '',
      image_path: l.image_path
    })));
  };

  const setAllPass = () => {
    setInspectLines(inspectLines.map(l => ({ ...l, pass_qty: l.received_qty, fail_qty: 0, fail_reason: '' })));
  };

  const handleSubmit = async () => {
    const invalid = inspectLines.find((line) => Number(line.pass_qty) < 0 || Number(line.fail_qty) < 0 || (Number(line.pass_qty) + Number(line.fail_qty)).toFixed(3) !== Number(line.received_qty).toFixed(3));
    if (invalid) return alert(`SKU ${invalid.sku_code} 的合格数量 + 不良数量必须等于待检数量 (${invalid.received_qty})`);
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

      {/* 质检看板模块 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-5 bg-gradient-to-br from-indigo-50 to-white border-indigo-100 relative overflow-hidden">
            <Activity className="absolute -right-4 -bottom-4 w-24 h-24 text-indigo-500/10" />
            <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">待处理任务</p>
            <p className="mt-2 text-3xl font-black text-indigo-600">{stats.pendingCount} <span className="text-sm font-bold text-indigo-300">批次</span></p>
        </div>
        <div className="card p-5 bg-gradient-to-br from-emerald-50 to-white border-emerald-100 relative overflow-hidden">
            <TrendingUp className="absolute -right-4 -bottom-4 w-24 h-24 text-emerald-500/10" />
            <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">平均合格率</p>
            <p className="mt-2 text-3xl font-black text-emerald-600">{stats.passRate}<span className="text-lg font-bold">%</span></p>
        </div>
        <div className="card p-5 bg-gradient-to-br from-rose-50 to-white border-rose-100 relative overflow-hidden">
            <BarChart3 className="absolute -right-4 -bottom-4 w-24 h-24 text-rose-500/10" />
            <p className="text-[10px] font-black text-rose-400 uppercase tracking-widest">本期异常拦截</p>
            <p className="mt-2 text-3xl font-black text-rose-600">{stats.failCount} <span className="text-sm font-bold text-rose-300">件</span></p>
        </div>
      </div>

      {error && (
        <div className="card p-4 border-red-100 bg-red-50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3 text-red-600"><AlertCircle size={20} className="mt-0.5 flex-shrink-0" /><div><p className="text-sm font-bold">质检数据加载失败</p><p className="text-xs mt-1">{error}</p></div></div>
          <button onClick={load} className="btn-secondary bg-white text-red-600 border-red-200 px-4 py-2 text-xs font-bold">重试</button>
        </div>
      )}

      <div className="space-y-4">
        <div className="flex items-center justify-between px-2">
            <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest flex items-center gap-2"><ListTodo size={14} /> 待检任务清单</h3>
            <span className="text-[10px] font-bold text-gray-400">优先处理最早收货的批次</span>
        </div>
        
        <div className="grid grid-cols-1 gap-3">
          {loading ? <div className="py-20 text-center"><Loader2 className="animate-spin mx-auto text-blue-500" /><p className="text-xs text-gray-400 mt-3 font-bold uppercase">正在拉取云端待检数据…</p></div> : error ? null : pendingReceipts.length === 0 ? (
            <div className="card p-16 text-center">
                <CheckCircle className="mx-auto text-emerald-500 mb-3 opacity-20" size={48} />
                <p className="text-sm text-gray-400 font-bold">当前无待检记录</p>
                <p className="text-[10px] text-gray-300 mt-1">所有批次均已完成入库处理</p>
            </div>
          ) : pendingReceipts.map(r => {
            const isProduction = r.v2_warehouse_receipt_lines?.some(l => l.production_id);
            return (
              <div key={r.id} className="card p-0 overflow-hidden group hover:border-blue-200 transition-all">
                <div className="flex flex-col md:flex-row items-stretch">
                   <div className={`w-2 md:w-1.5 ${isProduction ? 'bg-indigo-500' : 'bg-blue-500'}`} />
                   <div className="flex-grow p-4 sm:p-5 flex flex-col md:flex-row justify-between items-center gap-4">
                      <div className="flex items-center gap-4 w-full md:w-auto">
                        <div className={`h-12 w-12 rounded-xl flex items-center justify-center ${isProduction ? 'bg-indigo-50 text-indigo-600' : 'bg-blue-50 text-blue-600'}`}>
                           {isProduction ? <Factory size={24} /> : <ShoppingCart size={24} />}
                        </div>
                        <div className="min-w-0">
                           <div className="flex items-center gap-2 flex-wrap">
                               <p className="text-base font-black text-gray-800">{r.receipt_no}</p>
                               <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${isProduction ? 'bg-indigo-100 text-indigo-700' : 'bg-blue-100 text-blue-700'}`}>
                                 {isProduction ? '车间完工' : '外部收货'}
                               </span>
                           </div>
                           <p className="text-xs text-gray-500 flex items-center gap-1.5 mt-1">
                             <History size={12} className="text-gray-400" />
                             由 {r.v2_business_partners?.name || '未知供方'} 交付于 {new Date(r.received_at).toLocaleString('zh-CN', { hour12: false })}
                           </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-6 w-full md:w-auto justify-between md:justify-end border-t md:border-t-0 pt-3 md:pt-0">
                         <div className="text-right">
                           <p className="text-[10px] font-black text-gray-400 uppercase">检验明细</p>
                           <p className="text-lg font-black text-gray-700">{r.v2_warehouse_receipt_lines?.length || 0} <span className="text-[10px] font-normal text-gray-400">SKUs</span></p>
                         </div>
                         <button onClick={() => openInspect(r)} className="btn-primary flex items-center gap-2 px-8 py-2.5 shadow-lg shadow-blue-100">
                           <ShieldCheck size={18} /> 执行终审
                         </button>
                      </div>
                   </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {viewingReceipt && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[110] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-5xl shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden">
             <div className="bg-[var(--color-primary)] p-6 text-white flex justify-between items-center">
                <div className="flex items-center gap-4">
                   <div className="h-12 w-12 rounded-2xl bg-white/20 flex items-center justify-center">
                      <ClipboardCheck size={28} />
                   </div>
                   <div>
                      <h3 className="text-xl font-black">品质检验与正式入账</h3>
                      <p className="text-blue-100 text-xs mt-0.5 opacity-80 uppercase tracking-widest font-bold">核验单据：{viewingReceipt.receipt_no}</p>
                   </div>
                </div>
                <button onClick={() => setViewingReceipt(null)} className="p-3 hover:bg-white/10 rounded-full transition-colors text-white/70 hover:text-white"><X size={24} /></button>
             </div>

             <div className="p-6">
                <div className="flex items-center justify-between mb-4 px-1">
                   <p className="text-xs font-black text-gray-400 uppercase tracking-widest">待检明细清单</p>
                   <button onClick={setAllPass} className="text-xs font-black text-blue-600 hover:text-blue-700 flex items-center gap-1.5 py-1 px-3 rounded-lg bg-blue-50 hover:bg-blue-100 transition-colors">
                      <CheckCircle size={14} /> 一键全部合格
                   </button>
                </div>
                <div className="border border-slate-100 rounded-2xl overflow-hidden mb-6 shadow-sm">
                   <div className="overflow-x-auto">
                     <table className="w-full text-xs text-left">
                        <thead className="bg-slate-50 text-slate-500 uppercase font-black">
                           <tr>
                             <th className="px-5 py-4 w-16">预览</th>
                             <th className="px-5 py-4">产品 SKU</th>
                             <th className="px-5 py-4 text-right">待检总数</th>
                             <th className="px-5 py-4 w-32 text-center text-emerald-600">合格入库</th>
                             <th className="px-5 py-4 w-32 text-center text-rose-600">不良拦截</th>
                             <th className="px-5 py-4">异常原因/备注</th>
                           </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                           {inspectLines.map((l, i) => (
                             <tr key={i} className="hover:bg-blue-50/20 transition-colors">
                                <td className="px-5 py-4">
                                   <div className="h-10 w-10 rounded-lg border border-slate-100 bg-slate-50 overflow-hidden flex items-center justify-center">
                                      {imageUrls[l.image_path] ? (
                                        <img src={imageUrls[l.image_path]} className="w-full h-full object-contain" />
                                      ) : <ImageIcon size={16} className="text-slate-200" />}
                                   </div>
                                </td>
                                <td className="px-5 py-4">
                                   <p className="font-black text-slate-800 text-sm">{l.sku_code}</p>
                                   <p className="text-[10px] text-slate-400 font-bold mt-0.5">批次已锁定</p>
                                </td>
                                <td className="px-5 py-4 text-right font-black text-slate-400">{Number(l.received_qty).toLocaleString()}</td>
                                <td className="px-5 py-4">
                                   <input type="number" min="0" max={l.received_qty} step="0.001" className="input-field py-2 px-3 text-center border-emerald-100 bg-emerald-50/20 font-black text-emerald-700 focus:bg-white transition-colors" value={l.pass_qty} onChange={e => {
                                      const val = Math.min(Number(l.received_qty), Math.max(0, Number(e.target.value || 0)));
                                      const newLines = [...inspectLines];
                                      newLines[i].pass_qty = val;
                                      newLines[i].fail_qty = Number((l.received_qty - val).toFixed(3));
                                      setInspectLines(newLines);
                                   }} />
                                </td>
                                <td className="px-5 py-4">
                                   <input type="number" min="0" max={l.received_qty} step="0.001" className="input-field py-2 px-3 text-center border-rose-100 bg-rose-50/20 font-black text-rose-700 focus:bg-white transition-colors" value={l.fail_qty} onChange={e => {
                                      const val = Math.min(Number(l.received_qty), Math.max(0, Number(e.target.value || 0)));
                                      const newLines = [...inspectLines];
                                      newLines[i].fail_qty = val;
                                      newLines[i].pass_qty = Number((l.received_qty - val).toFixed(3));
                                      setInspectLines(newLines);
                                   }} />
                                </td>
                                <td className="px-5 py-4">
                                   <input className={`input-field py-2 px-3 text-xs transition-all ${l.fail_qty > 0 ? 'border-rose-200 ring-2 ring-rose-50' : 'border-slate-100'}`} value={l.fail_reason} onChange={e => {
                                      const newLines = [...inspectLines];
                                      newLines[i].fail_reason = e.target.value;
                                      setInspectLines(newLines);
                                   }} placeholder={l.fail_qty > 0 ? "必填：说明缺陷原因" : "点击输入备注"} />
                                </td>
                             </tr>
                           ))}
                        </tbody>
                     </table>
                   </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] items-end gap-6">
                    <div className="p-5 bg-amber-50/50 border border-amber-100 rounded-2xl flex items-start gap-4">
                        <div className="h-10 w-10 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-600 shrink-0 mt-0.5">
                           <ShieldCheck size={24} />
                        </div>
                        <div className="text-xs text-amber-800 leading-relaxed">
                            <p className="font-black text-sm mb-1 uppercase tracking-tight">质检入库规则说明</p>
                            <p className="font-medium opacity-80">合格品将立即激活为“可用库存”，不良品将转入独立“次品区”并触发异常处理流程。该操作具有审计追溯性，确认后不可撤回。</p>
                        </div>
                    </div>
                    
                    <button onClick={handleSubmit} disabled={processing} className="btn-primary px-12 py-4 flex items-center justify-center gap-3 shadow-2xl shadow-blue-500/20 text-lg group">
                        {processing ? <Loader2 size={24} className="animate-spin" /> : <CheckCircle size={24} className="group-hover:scale-110 transition-transform" />}
                        确认发布质检结论
                    </button>
                </div>
             </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default QualityControlPage;
