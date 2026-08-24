import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import SectionHeading from '../components/common/SectionHeading';
import {
  listProductionOrders,
  createProductionOrder,
  listProductsMain,
  listSalesOrders,
  issueMaterials,
  completeProduction,
  quickCreateProduct
} from '../lib/wmsV2Api';
import { listInventory } from '../lib/inventoryApi';
import { Factory, Plus, Play, CheckCircle2, AlertTriangle, Loader2, ListTree, X, Link2, Info, Boxes, PackageSearch, ShieldCheck, ClipboardCheck, AlertCircle, Trash2, Search, UserPlus, ArrowRight } from 'lucide-react';

const number = (value) => Number(value || 0);

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
  
  // 搜索与快速创建状态
  const [skuSearch, setSkuSearch] = useState('');
  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const [quickCreateForm, setQuickCreateForm] = useState({ name: '', category: '生产成品', unit: '条' });

  const canManage = ['admin', 'inv_manager'].includes(user.role);

  const selectedProduct = useMemo(() => products.find(p => (p.sku_code || p.sku) === form.sku_code), [form.sku_code, products]);

  const filteredProducts = useMemo(() => {
    if (!skuSearch) return products.slice(0, 100);
    const s = skuSearch.toLowerCase();
    return products.filter(p => (p.sku_code || p.sku || '').toLowerCase().includes(s) || (p.name || '').toLowerCase().includes(s)).slice(0, 100);
  }, [skuSearch, products]);

  const load = async () => {
    setLoading(true);
    try {
      const [productionResult, productResult, salesResult, v1Inventory] = await Promise.all([
        listProductionOrders().catch(() => ({ orders: [] })),
        listProductsMain().catch(() => ({ products: [] })),
        listSalesOrders().catch(() => ({ orders: [] })),
        listInventory().catch(() => [])
      ]);

      const currentOrders = productionResult?.orders || productionResult || [];
      const currentSales = salesResult?.orders || salesResult || [];
      const v2Products = productResult?.products || productResult || [];
      const v1Products = v1Inventory?.products || v1Inventory || [];
      
      const productMap = new Map();
      v1Products.forEach(p => {
        const sku = p.sku || p.sku_code;
        if (sku) productMap.set(sku, { sku_code: sku, name: p.name || '未命名产品', available_stock: number(p.available_stock), base_unit: p.unit || '条', spec: p.spec || '', category: p.category || '' });
      });
      v2Products.forEach(p => {
        const sku = p.sku_code || p.sku;
        if (!sku) return;
        const existing = productMap.get(sku) || {};
        productMap.set(sku, { ...existing, sku_code: sku, name: p.name || p.formal_name || existing.name || '未命名产品', available_stock: p.available_stock !== undefined ? number(p.available_stock) : existing.available_stock, base_unit: p.base_unit || p.unit || existing.base_unit, spec: p.spec || existing.spec, category: p.primary_category || p.category || existing.category, image_path: p.image_path || existing.image_path });
      });

      const mergedProducts = Array.from(productMap.values()).sort((a, b) => a.sku_code.localeCompare(b.sku_code));
      
      setOrders(Array.isArray(currentOrders) ? currentOrders : []);
      setSalesOrders(Array.isArray(currentSales) ? currentSales : []);
      setProducts(mergedProducts);
    } catch (e) { console.error('Load Error:', e); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const openProductionQty = (line, allOrders) => {
    return (allOrders || []).filter(o => o.sales_order_line_id === line.id).reduce((sum, item) => {
        if (!['draft', 'in_progress'].includes(item.status)) return sum;
        return sum + Math.max(0, number(item.plan_qty) - number(item.actual_qty) - number(item.scrap_qty));
    }, 0);
  }

  const unplannedShortage = (line, allOrders) => {
    return Math.max(0, number(line.quantity) - number(line.shipped_qty) - number(line.locked_qty) - openProductionQty(line, allOrders));
  }

  const handleQuickCreate = async () => {
    if (!skuSearch || !quickCreateForm.name) return alert('请先填写产品编码和名称');
    setProcessing(true);
    try {
      await quickCreateProduct({ sku_code: skuSearch, ...quickCreateForm });
      await load();
      setForm({ ...form, sku_code: skuSearch });
      setShowQuickCreate(false);
    } catch (e) { alert(e.message); }
    finally { setProcessing(false); }
  };

  const resetForm = () => {
    setForm({ sales_order_id: '', sales_order_line_id: '', sku_code: '', plan_qty: '', workshop: '', due_date: '', bom: [] });
    setNewBom({ sku: '', qty: '' });
    setSkuSearch('');
    setShowQuickCreate(false);
  };

  const selectSalesLine = (lineId) => {
    if (!lineId) { resetForm(); return; }
    const line = shortageLines.find((item) => item.id === lineId);
    if (!line) return;
    setForm({ ...form, sales_order_id: line.sales_order_id, sales_order_line_id: line.id, sku_code: line.sku_code, plan_qty: line.shortage_qty, due_date: line.due_date || '' });
    setSkuSearch(line.sku_code);
  };

  const addBom = () => {
    if (!newBom.sku || number(newBom.qty) <= 0) return;
    if (form.bom.some((item) => item.sku === newBom.sku)) return alert('BOM 中相同物料请合并数量');
    const product = products.find(p => (p.sku_code || p.sku) === newBom.sku);
    setForm({ ...form, bom: [...form.bom, { sku: newBom.sku, qty: number(newBom.qty), unit: product?.base_unit || product?.unit || '条', available_stock: product?.available_stock || 0 }] });
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
    } catch (e) { alert(e.message); }
    finally { setProcessing(false); }
  };

  const handleIssue = async (id) => {
    if (!window.confirm('确认执行领料？将立即扣减原材料可用库存并转入在制 (WIP)。')) return;
    setProcessing(true);
    try { await issueMaterials(id, '主仓库'); await load(); } catch (e) { alert(e.message); }
    finally { setProcessing(false); }
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
    try { await completeProduction(order.id, passQty, failQty, '主仓库'); alert(passQty > 0 ? `报工成功：${passQty} 件已进入“待检”，质检合格后会自动优先锁定给关联销售订单。` : '报工成功。'); await load(); } catch (e) { alert(e.message); }
    finally { setProcessing(false); }
  };

  const shortageLines = useMemo(() => salesOrders.flatMap((order) => (order.v2_sales_order_lines || [])
    .map((line) => ({ ...line, sales_order_id: order.id, order_no: order.order_no, due_date: order.due_date, shortage_qty: unplannedShortage(line, orders) }))
    .filter((line) => line.shortage_qty > 0 && !['cancelled', 'completed'].includes(order.status))), [salesOrders, orders]);

  return (
    <div className="space-y-6 text-slate-800">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <SectionHeading title="生产与作业中心" subtitle="销售缺口排产 → BOM 领料 → 在制 → 完工待检 → 质检后自动回补订单" />
        {canManage && <button onClick={() => setIsAdding(true)} className="btn-primary flex items-center justify-center gap-2 px-6 shadow-lg shadow-blue-500/20"><Plus size={18} /> 下达生产工单</button>}
      </div>

      <div className="grid grid-cols-1 gap-6">
        {loading ? <div className="py-20 text-center"><Loader2 className="animate-spin mx-auto text-blue-500" /></div> : orders.length === 0 ? (
          <div className="card p-20 text-center text-gray-400">
            <Boxes size={48} className="mx-auto mb-4 opacity-10" />
            <p className="font-bold">暂无生产工单记录</p>
          </div>
        ) : orders.map((order) => {
          const remaining = Math.max(0, number(order.plan_qty) - number(order.actual_qty) - number(order.scrap_qty));
          return (
            <div key={order.id} className="card p-6 border-l-4 border-indigo-500 hover:shadow-md transition-shadow">
              <div className="flex flex-col lg:flex-row justify-between gap-6">
                <div className="flex-grow">
                  <div className="flex items-center gap-3 mb-2 flex-wrap">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${order.status === 'in_progress' ? 'bg-amber-100 text-amber-700' : (order.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500')}`}>{order.status}</span>
                    <p className="text-sm font-black text-gray-800">{order.order_no}</p>
                    {order.v2_sales_orders?.order_no && <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px] font-bold flex items-center gap-1"><Link2 size={10} /> {order.v2_sales_orders.order_no}</span>}
                  </div>
                  <h3 className="text-xl font-black text-blue-600 mb-4">{order.sku_code} <span className="text-xs font-normal text-gray-400 ml-2 italic">× {number(order.plan_qty).toLocaleString()} 件</span></h3>

                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-6">
                    <div className="p-3 bg-gray-50 rounded-xl border border-gray-100"><p className="text-[9px] font-bold text-gray-400 uppercase">待检产出</p><p className="text-lg font-black text-emerald-600">{number(order.actual_qty).toLocaleString()}</p></div>
                    <div className="p-3 bg-gray-50 rounded-xl border border-gray-100"><p className="text-[9px] font-bold text-gray-400 uppercase">生产报废</p><p className="text-lg font-black text-red-500">{number(order.scrap_qty).toLocaleString()}</p></div>
                    <div className="p-3 bg-gray-50 rounded-xl border border-gray-100"><p className="text-[9px] font-bold text-gray-400 uppercase">剩余计划</p><p className="text-lg font-black text-amber-600">{remaining.toLocaleString()}</p></div>
                    <div className="p-3 bg-gray-50 rounded-xl border border-gray-100"><p className="text-[9px] font-bold text-gray-400 uppercase">生产车间</p><p className="text-xs font-bold truncate">{order.workshop || '未指定'}</p></div>
                    <div className="p-3 bg-gray-50 rounded-xl border border-gray-100"><p className="text-[9px] font-bold text-gray-400 uppercase">预计交付</p><p className="text-xs font-bold">{order.due_date || '-'}</p></div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2"><ListTree size={12} /> BOM 物料耗用</p>
                    <div className="flex flex-wrap gap-2">
                      {(order.v2_production_bom_lines || []).length === 0 && <span className="text-xs text-gray-400">未配置 BOM</span>}
                      {(order.v2_production_bom_lines || []).map((item) => (
                        <div key={item.id} className="px-3 py-1 rounded-lg bg-indigo-50 border border-indigo-100 text-[10px] font-bold text-indigo-700">
                          {item.material_sku}: {number(item.issued_qty).toLocaleString()} / {number(item.standard_qty).toLocaleString()} {item.unit}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {canManage && (
                  <div className="flex flex-col gap-3 min-w-[200px] border-l lg:pl-6">
                    {order.status === 'draft' && <button onClick={() => handleIssue(order.id)} disabled={processing} className="btn-primary w-full py-4 flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 border-none shadow-lg shadow-amber-200"><Play size={18} /> 确认领料开工</button>}
                    {order.status === 'in_progress' && <button onClick={() => handleComplete(order)} disabled={processing} className="btn-primary w-full py-4 flex items-center justify-center gap-2 shadow-lg shadow-blue-200"><CheckCircle2 size={18} /> 汇报生产完工</button>}
                    <button className="btn-secondary w-full py-2.5 text-xs font-black text-gray-400" disabled>打印工艺流转单</button>
                    <button className="btn-secondary w-full py-2.5 text-xs text-red-300 font-bold" disabled>撤销并终止工单</button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {isAdding && canManage && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-md z-[110] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-4xl p-0 shadow-2xl animate-in zoom-in-95 max-h-[96vh] overflow-hidden flex flex-col border border-white/20">
            <div className="bg-blue-600 p-7 text-white flex justify-between items-center shrink-0">
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 rounded-2xl bg-white/20 flex items-center justify-center border border-white/10"><Factory size={28} /></div>
                <div><h3 className="text-2xl font-black tracking-tight">下达正式生产工单</h3><p className="text-blue-100 text-xs mt-0.5 opacity-80 uppercase tracking-widest font-black">成品制造、物料齐套核验与工序排产</p></div>
              </div>
              <button onClick={() => setIsAdding(false)} className="p-3 hover:bg-white/10 rounded-full transition-all text-white/70 hover:text-white hover:rotate-90"><X size={28} /></button>
            </div>

            <form onSubmit={handleSubmit} className="flex-grow overflow-y-auto p-8 space-y-8">
              <section className="space-y-5">
                <div className="flex items-center gap-2 px-1">
                   <div className="w-1.5 h-4 bg-blue-600 rounded-full" />
                   <h4 className="text-xs font-black text-gray-500 uppercase tracking-widest">STEP 1. 计划决策与生产目标</h4>
                </div>
                
                <div className="p-5 rounded-2xl border border-blue-100 bg-blue-50/40 shadow-inner">
                  <label className="block">
                    <span className="text-[11px] font-black text-blue-700 uppercase flex items-center gap-2"><Link2 size={14} /> 关联待排产的销售单缺口</span>
                    <select className="input-field mt-3 bg-white border-blue-200 focus:ring-4 focus:ring-blue-100 text-sm font-bold" value={form.sales_order_line_id} onChange={(e) => selectSalesLine(e.target.value)}>
                      <option value="">-- 自主计划生产 / 非关联订单 --</option>
                      {shortageLines.map((line) => <option key={line.id} value={line.id}>【缺口 {line.shortage_qty}】{line.order_no} · {line.sku_code}</option>)}
                    </select>
                  </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
                  <div className="md:col-span-6">
                    <label className="block"><span className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">目标产品 (输入 SKU 或名称搜索)</span>
                      <div className="relative mt-2 group">
                        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-600 transition-colors"><Search size={18} /></div>
                        <input className="input-field pl-12 bg-gray-50 border-gray-100 focus:bg-white transition-all font-black text-blue-700 text-base" placeholder="输入并搜索..." value={skuSearch} onChange={(e) => { setSkuSearch(e.target.value); setForm({...form, sku_code: ''}); }} disabled={Boolean(form.sales_order_line_id)} />
                        
                        {skuSearch && !form.sku_code && (
                          <div className="absolute left-0 right-0 top-full mt-2 bg-white rounded-2xl shadow-2xl border border-gray-100 z-50 max-h-60 overflow-y-auto p-2 animate-in fade-in slide-in-from-top-2">
                             {filteredProducts.length > 0 ? (
                                filteredProducts.map((p, i) => (
                                  <button key={i} type="button" onClick={() => { setForm({...form, sku_code: p.sku_code}); setSkuSearch(p.sku_code); }} className="w-full text-left px-4 py-3 rounded-xl hover:bg-blue-50 flex justify-between items-center group transition-colors">
                                     <div className="min-w-0 flex-grow"><p className="font-black text-gray-800 text-sm">{p.sku_code}</p><p className="text-[10px] text-gray-400 truncate">{p.name}</p></div>
                                     <div className="text-right ml-4 shrink-0"><p className="text-[9px] font-black text-gray-400 uppercase">现存</p><p className="text-xs font-black text-blue-600">{number(p.available_stock)} {p.base_unit}</p></div>
                                  </button>
                                ))
                             ) : (
                                <button type="button" onClick={() => setShowQuickCreate(true)} className="w-full p-4 text-center rounded-xl bg-emerald-50 text-emerald-700 border border-dashed border-emerald-200 hover:bg-emerald-100 transition-all flex flex-col items-center gap-2 group">
                                   <UserPlus size={24} className="group-hover:scale-110 transition-transform" />
                                   <div className="font-black text-sm">库中无“{skuSearch}”，点击立即建立新档案？</div>
                                </button>
                             )}
                          </div>
                        )}
                      </div>
                    </label>
                    
                    {selectedProduct && (
                      <div className="mt-4 p-5 rounded-2xl border-2 border-blue-600 bg-blue-600 text-white flex gap-5 shadow-xl shadow-blue-600/20 animate-in zoom-in-95">
                         <div className="h-16 w-16 rounded-xl bg-white/10 flex items-center justify-center border border-white/20 shrink-0"><PackageSearch size={32} /></div>
                         <div className="min-w-0 flex-grow">
                            <div className="flex justify-between items-start">
                               <div><p className="text-[10px] font-black text-blue-200 uppercase tracking-tighter">当前成品可用库存</p><p className="text-2xl font-black leading-tight">{number(selectedProduct.available_stock).toLocaleString()} <span className="text-sm font-bold opacity-60 uppercase">{selectedProduct.base_unit}</span></p></div>
                               <button type="button" onClick={() => setForm({...form, sku_code: ''})} className="p-1 hover:bg-white/20 rounded-lg"><X size={14}/></button>
                            </div>
                            <div className="mt-2 pt-2 border-t border-white/10 flex items-center gap-2 overflow-hidden"><span className="text-[9px] font-black bg-white/20 px-1.5 py-0.5 rounded uppercase shrink-0">{selectedProduct.category || '生产成品'}</span><p className="text-[11px] font-bold truncate opacity-90">{selectedProduct.name}</p></div>
                         </div>
                      </div>
                    )}

                    {showQuickCreate && (
                      <div className="mt-4 p-5 rounded-2xl bg-emerald-50 border border-emerald-100 space-y-4 animate-in slide-in-from-left-2">
                        <div className="flex justify-between items-center"><h5 className="text-sm font-black text-emerald-800 flex items-center gap-2"><UserPlus size={16}/> 快速创建基础档案</h5><button type="button" onClick={()=>setShowQuickCreate(false)} className="text-emerald-400"><X size={16}/></button></div>
                        <div className="grid grid-cols-2 gap-3">
                           <input className="input-field bg-white border-emerald-100 text-xs py-2" placeholder="产品正式名称" value={quickCreateForm.name} onChange={e=>setQuickCreateForm({...quickCreateForm, name: e.target.value})} />
                           <select className="input-field bg-white border-emerald-100 text-xs py-2" value={quickCreateForm.unit} onChange={e=>setQuickCreateForm({...quickCreateForm, unit: e.target.value})}><option value="条">单位：条</option><option value="件">单位：件</option><option value="个">单位：个</option><option value="卷">单位：卷</option></select>
                        </div>
                        <button type="button" onClick={handleQuickCreate} className="w-full btn-primary bg-emerald-600 hover:bg-emerald-700 py-2.5 text-xs shadow-lg shadow-emerald-200">确认建立档案并选中</button>
                      </div>
                    )}
                  </div>

                  <div className="md:col-span-6 grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <label className="block sm:col-span-2"><span className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">本次计划下达数量</span><div className="relative mt-2"><input type="number" min="0" step="0.001" className="input-field py-4 font-black text-2xl text-emerald-700 pr-16" value={form.plan_qty} onChange={(e) => setForm({ ...form, plan_qty: e.target.value })} required /><span className="absolute right-4 top-1/2 -translate-y-1/2 font-black text-gray-300">QTY</span></div></label>
                    <label className="block"><span className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">生产车间/生产线</span><input className="input-field mt-2 font-bold py-2.5" value={form.workshop} onChange={(e) => setForm({ ...form, workshop: e.target.value })} placeholder="如：一号车间" /></label>
                    <label className="block"><span className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">期望交付日期</span><input type="date" className="input-field mt-2 font-bold py-2.5" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></label>
                  </div>
                </div>
              </section>

              <section className="space-y-5">
                <div className="flex items-center justify-between px-1">
                   <div className="flex items-center gap-2">
                     <div className="w-1.5 h-4 bg-indigo-600 rounded-full" />
                     <h4 className="text-xs font-black text-gray-500 uppercase tracking-widest">STEP 2. BOM 定额配料与库存锁定核验</h4>
                   </div>
                   <span className="text-[9px] text-amber-600 font-bold flex items-center gap-1 bg-amber-50 px-3 py-1 rounded-full border border-amber-100 animate-pulse"><AlertCircle size={10} /> 确认开工后将立即预扣可用库存</span>
                </div>

                <div className="p-6 bg-gray-50 rounded-3xl space-y-5 border border-gray-100 shadow-inner">
                  <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_auto] gap-4">
                    <select className="input-field bg-white border-transparent shadow-sm text-sm font-bold h-12" value={newBom.sku} onChange={(e) => setNewBom({ ...newBom, sku: e.target.value })}>
                      <option value="">-- 选择消耗的原材料 --</option>
                      {products.map((p, i) => <option key={i} value={p.sku_code || p.sku}>{p.sku_code || p.sku} · {p.name}</option>)}
                    </select>
                    <div className="relative">
                       <input type="number" min="0" step="0.001" placeholder="计划耗用量" className="input-field bg-white border-transparent shadow-sm h-12 pr-12 font-black" value={newBom.qty} onChange={(e) => setNewBom({ ...newBom, qty: e.target.value })} />
                       <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-black text-gray-300">Unit</span>
                    </div>
                    <button type="button" onClick={addBom} className="btn-primary h-12 px-8 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 transition-all border-none shadow-lg shadow-indigo-200 font-black text-xs uppercase tracking-wider"><Plus size={18} /> 加入配料</button>
                  </div>

                  <div className="rounded-2xl overflow-hidden border border-gray-100 bg-white">
                    {form.bom.length === 0 ? (
                       <div className="p-12 text-center flex flex-col items-center gap-3">
                          <div className="h-16 w-16 rounded-full bg-gray-50 flex items-center justify-center"><Boxes size={32} className="text-gray-200" /></div>
                          <p className="text-[10px] font-black text-gray-300 uppercase tracking-widest">当前无物料配比清单</p>
                       </div>
                    ) : (
                      <table className="w-full text-xs text-left">
                         <thead className="bg-gray-50 text-[10px] font-black text-gray-400 uppercase">
                            <tr>
                               <th className="px-6 py-4">原材料 SKU</th>
                               <th className="px-6 py-4 text-right">计划配额</th>
                               <th className="px-6 py-4 text-right">实时可用库存</th>
                               <th className="px-6 py-4 text-center">状态预警</th>
                               <th className="px-6 py-4 w-16"></th>
                            </tr>
                         </thead>
                         <tbody className="divide-y divide-gray-50">
                            {form.bom.map((item, index) => {
                               const isShortage = Number(item.qty) > Number(item.available_stock || 0);
                               return (
                                <tr key={`${item.sku}-${index}`} className="hover:bg-blue-50/40 transition-colors">
                                  <td className="px-6 py-5 font-bold text-gray-700">{item.sku}</td>
                                  <td className="px-6 py-5 text-right font-black text-indigo-600 text-sm">{number(item.qty).toLocaleString()} {item.unit}</td>
                                  <td className="px-6 py-5 text-right font-black text-gray-400">{number(item.available_stock).toLocaleString()} {item.unit}</td>
                                  <td className="px-6 py-5 text-center">
                                     <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tight ${isShortage ? 'bg-red-50 text-red-600 border border-red-100' : 'bg-emerald-50 text-emerald-600 border border-emerald-100'}`}>
                                        {isShortage ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />}
                                        {isShortage ? `缺料 ${Math.abs(Number(item.qty) - Number(item.available_stock || 0)).toLocaleString()}` : '资源齐套'}
                                     </span>
                                  </td>
                                  <td className="px-6 py-5 text-right">
                                    <button type="button" className="text-gray-300 hover:text-red-500 p-2 rounded-xl hover:bg-red-50 transition-all" onClick={() => setForm({ ...form, bom: form.bom.filter((_, i) => i !== index) })}><Trash2 size={16} /></button>
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

              <div className="pt-8 flex flex-col md:flex-row items-center justify-between gap-8 border-t shrink-0 border-gray-100">
                  <div className="flex items-start gap-4">
                     <div className="h-12 w-12 rounded-2xl bg-blue-50 flex items-center justify-center text-blue-600 shrink-0 shadow-inner">
                        <ShieldCheck size={28} />
                     </div>
                     <div className="text-[11px] text-gray-500 leading-relaxed max-w-sm font-medium">
                        <p className="font-black text-gray-800 uppercase tracking-tight text-xs mb-1">MES 指令执行确认：</p>
                        <p>确认下单后，此批次将进入生产中心待命。原材料将在正式“领料”时从仓库实物核减。完工后通过汇报入口进入质检，系统将根据检验结论自动更新成品库存。</p>
                     </div>
                  </div>
                  
                  <button type="submit" disabled={processing || loading} className="btn-primary w-full md:w-auto px-20 py-5 flex items-center justify-center gap-3 shadow-2xl shadow-blue-500/30 text-xl font-black rounded-2xl group transition-all hover:-translate-y-1 active:scale-95">
                     {processing ? <Loader2 size={28} className="animate-spin" /> : <ClipboardCheck size={28} className="group-hover:rotate-12 transition-transform" />}
                     立即下达工单
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