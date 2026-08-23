import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import SectionHeading from '../components/common/SectionHeading';
import {
  listProductionOrders,
  createProductionOrder,
  listProductsMain,
  listSalesOrders,
  issueMaterials,
  completeProduction
} from '../lib/wmsV2Api';
import { Factory, Plus, Play, CheckCircle2, AlertTriangle, Loader2, ListTree, X, Link2, Info, Boxes, PackageSearch, Activity, ShieldCheck, ArrowRight, TrendingUp, BarChart3, Search, AlertCircle } from 'lucide-react';
import { useSearchParams, useNavigate } from 'react-router-dom';

const number = (value) => Number(value || 0);
const openProductionQty = (line) => (line.v2_production_orders || []).reduce((sum, item) => {
  if (!['draft', 'in_progress'].includes(item.status)) return sum;
  return sum + Math.max(0, number(item.plan_qty) - number(item.actual_qty) - number(item.scrap_qty));
}, 0);
const unplannedShortage = (line) => Math.max(0, number(line.quantity) - number(line.shipped_qty) - number(line.locked_qty) - openProductionQty(line));

const ProductionPage = ({ user }) => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [orders, setOrders] = useState([]);
  const [salesOrders, setSalesOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [form, setForm] = useState({ sales_order_id: '', sales_order_line_id: '', sku_code: '', plan_qty: '', workshop: '', due_date: '', bom: [] });
  const [newBom, setNewBom] = useState({ sku: '', qty: '' });
  const canManage = ['admin', 'inv_manager'].includes(user.role);

  const selectedProduct = useMemo(() => products.find(p => p.sku_code === form.sku_code), [form.sku_code, products]);

  const load = async () => {
    setLoading(true);
    try {
      const [productionResult, productResult, salesResult] = await Promise.all([
        listProductionOrders(),
        listProductsMain(),
        listSalesOrders()
      ]);
      const currentOrders = productionResult.orders || [];
      const currentProducts = productResult.products || [];
      const currentSales = salesResult.orders || [];
      
      setOrders(currentOrders);
      setProducts(currentProducts);
      setSalesOrders(currentSales);

      // 如果带了参数，自动打开弹窗并选中对应的销售行
      const fromLineId = searchParams.get('create_from_line');
      if (fromLineId && currentSales.length > 0) {
        const allShortageLines = currentSales.flatMap((order) => (order.v2_sales_order_lines || [])
          .map((line) => ({ ...line, sales_order_id: order.id, order_no: order.order_no, due_date: order.due_date, shortage_qty: unplannedShortage(line) }))
          .filter((line) => line.shortage_qty > 0 && !['cancelled', 'completed'].includes(order.status)));
        
        const target = allShortageLines.find(l => l.id === fromLineId);
        if (target) {
          setForm({
            sales_order_id: target.sales_order_id,
            sales_order_line_id: target.id,
            sku_code: target.sku_code,
            plan_qty: target.shortage_qty,
            due_date: target.due_date || '',
            workshop: '',
            bom: []
          });
          setIsAdding(true);
        }
        // 清理参数，避免刷新页面再次触发
        setSearchParams({}, { replace: true });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const shortageLines = useMemo(() => salesOrders.flatMap((order) => (order.v2_sales_order_lines || [])
    .map((line) => ({ ...line, sales_order_id: order.id, order_no: order.order_no, due_date: order.due_date, shortage_qty: unplannedShortage(line) }))
    .filter((line) => line.shortage_qty > 0 && !['cancelled', 'completed'].includes(order.status))), [salesOrders]);

  const resetForm = () => {
    setForm({ sales_order_id: '', sales_order_line_id: '', sku_code: '', plan_qty: '', workshop: '', due_date: '', bom: [] });
    setNewBom({ sku: '', qty: '' });
  };

  const selectSalesLine = (lineId) => {
    if (!lineId) {
      setForm({ ...form, sales_order_id: '', sales_order_line_id: '', sku_code: '', plan_qty: '', due_date: '' });
      return;
    }
    const line = shortageLines.find((item) => item.id === lineId);
    if (!line) return;
    setForm({
      ...form,
      sales_order_id: line.sales_order_id,
      sales_order_line_id: line.id,
      sku_code: line.sku_code,
      plan_qty: line.shortage_qty,
      due_date: line.due_date || ''
    });
  };

  const addBom = () => {
    if (!newBom.sku || number(newBom.qty) <= 0) return;
    if (form.bom.some((item) => item.sku === newBom.sku)) {
      alert('BOM 中相同物料请合并数量');
      return;
    }
    const product = products.find(p => p.sku_code === newBom.sku);
    setForm({
      ...form,
      bom: [...form.bom, { 
        ...newBom, 
        qty: number(newBom.qty), 
        unit: product?.base_unit || '件',
        available_stock: product?.available_stock || 0
      }]
    });
    setNewBom({ sku: '', qty: '' });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.bom.some(item => item.qty > item.available_stock)) {
       if (!window.confirm('检测到部分原材料库存不足，确认强制下达工单吗？\n下达后可能导致开工领料失败。')) return;
    }
    setProcessing(true);
    try {
      await createProductionOrder(form, form.bom);
      resetForm();
      setIsAdding(false);
      await load();
    } catch (e) {
      alert(e.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleIssue = async (id) => {
    if (!window.confirm('确认执行领料？将立即扣减原材料可用库存并转入在制 (WIP)。')) return;
    setProcessing(true);
    try {
      await issueMaterials(id, '主仓库');
      await load();
    } catch (e) {
      alert(e.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleComplete = async (order) => {
    const remaining = Math.max(0, number(order.plan_qty) - number(order.actual_qty) - number(order.scrap_qty));
    const passInput = window.prompt(`请输入本次完工待检数量（剩余计划 ${remaining}）：`, String(remaining));
    if (passInput === null || passInput === '' || Number.isNaN(Number(passInput))) return;
    const failInput = window.prompt('请输入本次生产报废/直接不良数量：', '0');
    if (failInput === null || failInput === '' || Number.isNaN(Number(failInput))) return;
    const passQty = number(passInput);
    const failQty = number(failInput);
    if (passQty < 0 || failQty < 0 || passQty + failQty <= 0) return alert('本次报工数量必须大于 0');
    if (passQty + failQty > remaining) return alert(`本次报工不能超过剩余计划 ${remaining}`);

    setProcessing(true);
    try {
      await completeProduction(order.id, passQty, failQty, '主仓库');
      alert(passQty > 0 ? `报工成功：${passQty} 件已进入“待检”，质检合格后会自动优先锁定给关联销售订单。` : '报工成功。');
      await load();
    } catch (e) {
      alert(e.message);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <SectionHeading title="生产与作业中心" subtitle="销售缺口排产 → BOM 领料 → 在制 → 完工待检 → 质检后自动回补订单" />
        {canManage && <button onClick={() => setIsAdding(true)} className="btn-primary flex items-center justify-center gap-2 px-6"><Plus size={18} /> 下达生产工单</button>}
      </div>

      {canManage && shortageLines.length > 0 && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <p className="text-sm font-black text-amber-800">还有 {shortageLines.length} 个销售订单 SKU 未完成排产</p>
            <p className="text-xs text-amber-700 mt-1">合计待排产 {shortageLines.reduce((sum, line) => sum + line.shortage_qty, 0).toLocaleString()} 件，可直接在新建工单时关联销售订单。</p>
          </div>
          <button onClick={() => setIsAdding(true)} className="btn-secondary bg-white flex items-center justify-center gap-2"><Link2 size={15} /> 从订单缺口排产</button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6">
        {loading ? <div className="py-20 text-center"><Loader2 className="animate-spin mx-auto text-blue-500" /></div> : orders.length === 0 ? <div className="card p-20 text-center text-gray-400">暂无生产工单记录</div> : orders.map((order) => {
          const remaining = Math.max(0, number(order.plan_qty) - number(order.actual_qty) - number(order.scrap_qty));
          return (
            <div key={order.id} className="card p-6 border-l-4 border-indigo-500">
              <div className="flex flex-col lg:flex-row justify-between gap-6">
                <div className="flex-grow">
                  <div className="flex items-center gap-3 mb-2 flex-wrap">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${order.status === 'in_progress' ? 'bg-amber-100 text-amber-700' : (order.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500')}`}>{order.status}</span>
                    <p className="text-sm font-black text-gray-800">{order.order_no}</p>
                    {order.v2_sales_orders?.order_no && <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px] font-bold flex items-center gap-1"><Link2 size={10} /> {order.v2_sales_orders.order_no}</span>}
                  </div>
                  <h3 className="text-xl font-black text-blue-600 mb-4">{order.sku_code} <span className="text-xs font-normal text-gray-400">× {number(order.plan_qty).toLocaleString()} 件</span></h3>

                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-6">
                    <div className="p-3 bg-gray-50 rounded-lg"><p className="text-[9px] font-bold text-gray-400 uppercase">待检产出</p><p className="text-lg font-black text-emerald-600">{number(order.actual_qty).toLocaleString()}</p></div>
                    <div className="p-3 bg-gray-50 rounded-lg"><p className="text-[9px] font-bold text-gray-400 uppercase">生产报废</p><p className="text-lg font-black text-red-500">{number(order.scrap_qty).toLocaleString()}</p></div>
                    <div className="p-3 bg-gray-50 rounded-lg"><p className="text-[9px] font-bold text-gray-400 uppercase">剩余计划</p><p className="text-lg font-black text-amber-600">{remaining.toLocaleString()}</p></div>
                    <div className="p-3 bg-gray-50 rounded-lg"><p className="text-[9px] font-bold text-gray-400 uppercase">生产车间</p><p className="text-xs font-bold">{order.workshop || '未指定'}</p></div>
                    <div className="p-3 bg-gray-50 rounded-lg"><p className="text-[9px] font-bold text-gray-400 uppercase">预计交付</p><p className="text-xs font-bold">{order.due_date || '-'}</p></div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2"><ListTree size={12} /> BOM 物料耗用</p>
                    <div className="flex flex-wrap gap-2">
                      {(order.v2_production_bom_lines || []).length === 0 && <span className="text-xs text-gray-400">未配置 BOM</span>}
                      {(order.v2_production_bom_lines || []).map((item) => (
                        <div key={item.id} className="px-3 py-1 rounded bg-indigo-50 border border-indigo-100 text-[10px] font-bold text-indigo-700">
                          {item.material_sku}: {number(item.issued_qty).toLocaleString()} / {number(item.standard_qty).toLocaleString()} {item.unit}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {canManage && (
                  <div className="flex flex-col gap-3 min-w-[200px] border-l lg:pl-6">
                    {order.status === 'draft' && <button onClick={() => handleIssue(order.id)} disabled={processing} className="btn-primary w-full py-3 flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 border-none"><Play size={16} /> 确认领料开工</button>}
                    {order.status === 'in_progress' && <button onClick={() => handleComplete(order)} disabled={processing} className="btn-primary w-full py-3 flex items-center justify-center gap-2 shadow-lg shadow-blue-100"><CheckCircle2 size={16} /> 汇报生产完工</button>}
                    <button className="btn-secondary w-full py-2 text-xs" disabled>工艺卡片（下一阶段）</button>
                    <button className="btn-secondary w-full py-2 text-xs text-red-400" disabled>异常终止（下一阶段）</button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {isAdding && canManage && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[110] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-4xl p-0 shadow-2xl animate-in zoom-in-95 max-h-[94vh] overflow-hidden flex flex-col">
            <div className="bg-[var(--color-primary)] p-6 text-white flex justify-between items-center shrink-0">
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 rounded-2xl bg-white/20 flex items-center justify-center">
                  <Factory size={28} />
                </div>
                <div>
                  <h3 className="text-xl font-black">下达正式生产工单</h3>
                  <p className="text-blue-100 text-xs mt-0.5 opacity-80 uppercase tracking-widest font-bold">优先满足销售订单缺口，质检后自动锁定回补</p>
                </div>
              </div>
              <button onClick={() => { setIsAdding(false); resetForm(); }} className="p-3 hover:bg-white/10 rounded-full transition-colors text-white/70 hover:text-white"><X size={24} /></button>
            </div>

            <form onSubmit={handleSubmit} className="flex-grow overflow-y-auto p-6 space-y-6">
              {/* 第一部分：计划决策层 */}
              <section className="space-y-4">
                <div className="flex items-center gap-2 px-1">
                   <div className="w-1 h-4 bg-blue-600 rounded-full" />
                   <h4 className="text-xs font-black text-gray-500 uppercase tracking-widest">第一步：确认生产目标与来源</h4>
                </div>
                
                <div className="p-4 rounded-2xl border border-blue-100 bg-blue-50/30">
                  <label className="block">
                    <span className="text-[10px] font-black text-blue-600 uppercase flex items-center gap-1.5"><Link2 size={12} /> 关联销售订单缺口（强烈推荐）</span>
                    <select className="input-field mt-2 bg-white border-blue-100 focus:ring-blue-200" value={form.sales_order_line_id} onChange={(e) => selectSalesLine(e.target.value)}>
                      <option value="">-- 计划外生产 / 不关联销售订单 --</option>
                      {shortageLines.map((line) => <option key={line.id} value={line.id}>{line.order_no} · {line.sku_code} · 待排产 {line.shortage_qty}</option>)}
                    </select>
                  </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
                  <div className="md:col-span-5">
                    <label className="block"><span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">目标产品 SKU</span>
                      <select className="input-field mt-2 bg-gray-50 border-transparent focus:bg-white transition-all font-bold text-blue-600" value={form.sku_code} onChange={(e) => setForm({ ...form, sku_code: e.target.value })} required disabled={Boolean(form.sales_order_line_id)}>
                        <option value="">-- 点击选择成品 --</option>
                        {products.map((p) => <option key={p.sku_code} value={p.sku_code}>{p.sku_code} · {p.formal_name || p.name}</option>)}
                      </select>
                    </label>
                    
                    {selectedProduct && (
                      <div className="mt-3 p-3 rounded-xl border border-dashed border-gray-200 flex gap-3 animate-in fade-in slide-in-from-top-2">
                         <div className="h-14 w-14 rounded-lg bg-gray-50 flex items-center justify-center border shrink-0 overflow-hidden">
                            {selectedProduct.image_path ? <img src={selectedProduct.image || ''} className="w-full h-full object-contain" /> : <PackageSearch size={20} className="text-gray-300" />}
                         </div>
                         <div className="min-w-0">
                            <p className="text-[10px] font-black text-blue-600 uppercase">{selectedProduct.primary_category || '未分类'}</p>
                            <p className="text-xs font-bold text-gray-700 truncate">{selectedProduct.name}</p>
                            <p className="text-[9px] text-gray-400 mt-0.5 truncate">{selectedProduct.spec || '无规格说明'}</p>
                         </div>
                      </div>
                    )}
                  </div>

                  <div className="md:col-span-7 grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <label className="block"><span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">计划生产数量</span><input type="number" min="0" step="0.001" className="input-field mt-2 font-black text-lg text-emerald-700" value={form.plan_qty} onChange={(e) => setForm({ ...form, plan_qty: e.target.value })} required /></label>
                    <label className="block"><span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">生产车间/机台</span><input className="input-field mt-2 font-bold" value={form.workshop} onChange={(e) => setForm({ ...form, workshop: e.target.value })} placeholder="如：一号车间" /></label>
                    <label className="block"><span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">预计完工日</span><input type="date" className="input-field mt-2 font-bold" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></label>
                  </div>
                </div>
              </section>

              {/* 第二部分：物料资源层 */}
              <section className="space-y-4">
                <div className="flex items-center justify-between px-1">
                   <div className="flex items-center gap-2">
                     <div className="w-1 h-4 bg-indigo-600 rounded-full" />
                     <h4 className="text-xs font-black text-gray-500 uppercase tracking-widest">第二步：配置 BOM 定额配料 (齐套性检查)</h4>
                   </div>
                   <span className="text-[9px] text-amber-600 font-bold flex items-center gap-1 bg-amber-50 px-2 py-0.5 rounded-full"><AlertCircle size={10} /> 确认开工后将立即预扣可用库存</span>
                </div>

                <div className="p-5 bg-gray-50 rounded-2xl space-y-4 border border-gray-100">
                  <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr_auto] gap-3">
                    <select className="input-field bg-white border-transparent shadow-sm" value={newBom.sku} onChange={(e) => setNewBom({ ...newBom, sku: e.target.value })}>
                      <option value="">-- 选择消耗的原材料 --</option>
                      {products.map((p) => <option key={p.sku_code} value={p.sku_code}>{p.sku_code} · {p.name}</option>)}
                    </select>
                    <div className="relative">
                       <input type="number" min="0" step="0.001" placeholder="本批次计划耗用量" className="input-field bg-white border-transparent shadow-sm pr-10" value={newBom.qty} onChange={(e) => setNewBom({ ...newBom, qty: e.target.value })} />
                       <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-gray-400 uppercase">Qty</span>
                    </div>
                    <button type="button" onClick={addBom} className="btn-secondary h-10 px-6 flex items-center justify-center gap-2 bg-white hover:bg-indigo-50 hover:text-indigo-600 transition-all border-none shadow-sm font-black text-xs"><Plus size={16} /> 加入配料表</button>
                  </div>

                  <div className="rounded-xl overflow-hidden border border-gray-100 bg-white">
                    {form.bom.length === 0 ? (
                       <div className="p-10 text-center flex flex-col items-center gap-2">
                          <Boxes size={32} className="text-gray-200" />
                          <p className="text-[10px] font-black text-gray-300 uppercase tracking-widest">尚未添加任何配料明细</p>
                       </div>
                    ) : (
                      <table className="w-full text-xs text-left">
                         <thead className="bg-gray-50 text-[10px] font-black text-gray-400 uppercase">
                            <tr>
                               <th className="px-4 py-3">物料 SKU</th>
                               <th className="px-4 py-3 text-right">计划用量</th>
                               <th className="px-4 py-3 text-right">当前可用库存</th>
                               <th className="px-4 py-3 text-center">齐套状态</th>
                               <th className="px-4 py-3 w-16"></th>
                            </tr>
                         </thead>
                         <tbody className="divide-y">
                            {form.bom.map((item, index) => {
                               const isShortage = item.qty > item.available_stock;
                               return (
                                <tr key={`${item.sku}-${index}`} className="hover:bg-blue-50/30 transition-colors">
                                  <td className="px-4 py-4 font-bold text-gray-700">{item.sku}</td>
                                  <td className="px-4 py-4 text-right font-black text-indigo-600">{number(item.qty).toLocaleString()} {item.unit}</td>
                                  <td className="px-4 py-4 text-right font-black text-gray-400">{number(item.available_stock).toLocaleString()} {item.unit}</td>
                                  <td className="px-4 py-4 text-center">
                                     <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${isShortage ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                        {isShortage ? <AlertTriangle size={10} /> : <CheckCircle2 size={10} />}
                                        {isShortage ? `缺料 ${(item.qty - item.available_stock).toLocaleString()}` : '库存充足'}
                                     </span>
                                  </td>
                                  <td className="px-4 py-4 text-right">
                                    <button type="button" className="text-red-400 hover:text-red-600 p-1 rounded-lg hover:bg-red-50 transition-colors" onClick={() => setForm({ ...form, bom: form.bom.filter((_, i) => i !== index) })}><Trash2 size={14} /></button>
                                  </td>
                                </tr>
                               );
                            })}
                         </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </section>

              <div className="pt-4 flex flex-col md:flex-row items-center justify-between gap-6 border-t shrink-0">
                  <div className="flex items-center gap-3">
                     <div className="h-10 w-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600">
                        <ShieldCheck size={24} />
                     </div>
                     <div className="text-[10px] text-gray-500 leading-relaxed max-w-sm font-medium">
                        <p className="font-black text-gray-700 uppercase tracking-tighter">MES 生产执行指令说明：</p>
                        <p>工单下达后将进入“待产”队列。此时不会锁定库存。实际原材料将在质检员或组长点击“领料开工”时正式从仓库扣减并转入车间 WIP 在制品状态。</p>
                     </div>
                  </div>
                  
                  <button type="submit" disabled={processing || loading} className="btn-primary w-full md:w-auto px-16 py-4 flex items-center justify-center gap-3 shadow-2xl shadow-blue-500/20 text-lg group rounded-2xl">
                     {processing ? <Loader2 size={24} className="animate-spin" /> : <ClipboardCheck size={24} className="group-hover:scale-110 transition-transform" />}
                     确认下达工单
                  </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProductionPage;
