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
import { Factory, Plus, Play, CheckCircle2, AlertTriangle, Loader2, ListTree, X, Link2 } from 'lucide-react';

const number = (value) => Number(value || 0);
const openProductionQty = (line) => (line.v2_production_orders || []).reduce((sum, item) => {
  if (!['draft', 'in_progress'].includes(item.status)) return sum;
  return sum + Math.max(0, number(item.plan_qty) - number(item.actual_qty) - number(item.scrap_qty));
}, 0);
const unplannedShortage = (line) => Math.max(0, number(line.quantity) - number(line.shipped_qty) - number(line.locked_qty) - openProductionQty(line));

const ProductionPage = ({ user }) => {
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
    setForm({
      ...form,
      bom: [...form.bom, { ...newBom, qty: number(newBom.qty), unit: products.find((p) => p.sku_code === newBom.sku)?.base_unit || '件' }]
    });
    setNewBom({ sku: '', qty: '' });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
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
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-3xl p-6 shadow-2xl animate-in zoom-in-95 max-h-[92vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="text-xl font-bold">下达生产工单</h3>
                <p className="text-xs text-gray-500 mt-1">优先从销售订单缺口创建，质检合格后系统会自动把成品锁回对应订单。</p>
              </div>
              <button onClick={() => { setIsAdding(false); resetForm(); }} className="p-2 hover:bg-gray-100 rounded-full"><X size={20} /></button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="p-4 rounded-xl border border-blue-100 bg-blue-50/40">
                <label className="block">
                  <span className="text-[10px] font-black text-blue-600 uppercase">关联销售订单缺口（推荐）</span>
                  <select className="input-field mt-1 bg-white" value={form.sales_order_line_id} onChange={(e) => selectSalesLine(e.target.value)}>
                    <option value="">-- 计划外生产 / 不关联销售订单 --</option>
                    {shortageLines.map((line) => <option key={line.id} value={line.id}>{line.order_no} · {line.sku_code} · 待排产 {line.shortage_qty}</option>)}
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <label className="block"><span className="text-[10px] font-bold text-gray-400 uppercase">目标 SKU</span>
                  <select className="input-field mt-1" value={form.sku_code} onChange={(e) => setForm({ ...form, sku_code: e.target.value })} required disabled={Boolean(form.sales_order_line_id)}>
                    <option value="">-- 选择成品 --</option>
                    {products.map((p) => <option key={p.sku_code} value={p.sku_code}>{p.sku_code} · {p.formal_name}</option>)}
                  </select>
                </label>
                <label className="block"><span className="text-[10px] font-bold text-gray-400 uppercase">计划生产数量</span><input type="number" min="0" step="0.001" className="input-field mt-1" value={form.plan_qty} onChange={(e) => setForm({ ...form, plan_qty: e.target.value })} required /></label>
                <label className="block"><span className="text-[10px] font-bold text-gray-400 uppercase">指定车间</span><input className="input-field mt-1" value={form.workshop} onChange={(e) => setForm({ ...form, workshop: e.target.value })} /></label>
                <label className="block"><span className="text-[10px] font-bold text-gray-400 uppercase">计划完成日</span><input type="date" className="input-field mt-1" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></label>
              </div>

              <div className="p-4 bg-gray-50 rounded-xl space-y-4">
                <div className="flex items-center justify-between"><p className="text-xs font-black text-gray-400 uppercase tracking-widest">BOM 定额配料表</p><span className="text-[10px] text-amber-600 font-bold flex items-center gap-1"><AlertTriangle size={10} /> 开工后扣减可用库存并转入 WIP</span></div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  <select className="input-field" value={newBom.sku} onChange={(e) => setNewBom({ ...newBom, sku: e.target.value })}>
                    <option value="">-- 选择原材料 --</option>
                    {products.map((p) => <option key={p.sku_code} value={p.sku_code}>{p.sku_code} · {p.formal_name}</option>)}
                  </select>
                  <input type="number" min="0" step="0.001" placeholder="本工单计划耗用量" className="input-field" value={newBom.qty} onChange={(e) => setNewBom({ ...newBom, qty: e.target.value })} />
                  <button type="button" onClick={addBom} className="btn-secondary h-10 flex items-center justify-center gap-2"><Plus size={16} /> 添加物料</button>
                </div>
                <div className="divide-y bg-white rounded-lg border">
                  {form.bom.map((item, index) => (
                    <div key={`${item.sku}-${index}`} className="p-3 flex justify-between items-center text-xs">
                      <span className="font-bold">{item.sku}</span>
                      <div className="flex items-center gap-4">
                        <span className="font-black text-indigo-600">{number(item.qty).toLocaleString()} {item.unit}</span>
                        <button type="button" className="text-red-500" onClick={() => setForm({ ...form, bom: form.bom.filter((_, i) => i !== index) })}>删除</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <button type="submit" disabled={processing} className="w-full btn-primary py-4 flex items-center justify-center gap-2 shadow-xl shadow-blue-100">确认下达工单并进入待产队列</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProductionPage;
