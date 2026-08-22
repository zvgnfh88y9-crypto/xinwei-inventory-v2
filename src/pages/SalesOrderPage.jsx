import React, { useEffect, useMemo, useState } from 'react';
import SectionHeading from '../components/common/SectionHeading';
import {
  listSalesOrders,
  createSalesOrder,
  listPartners,
  listProductsMain,
  lockInventoryForPlan,
  shipSalesOrder,
  confirmShipmentDelivery
} from '../lib/wmsV2Api';
import { ClipboardList, Plus, Truck, Loader2, User, UserCheck, X, Lock, CheckCircle2, Factory, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const STATUS_LABELS = {
  draft: '草稿',
  confirmed: '待备货',
  in_production: '生产中',
  ready_to_ship: '可出货',
  partially_shipped: '部分出货',
  completed: '已全部出货',
  cancelled: '已取消'
};

const statusClass = (status) => {
  if (status === 'ready_to_ship') return 'bg-emerald-100 text-emerald-700';
  if (status === 'completed') return 'bg-gray-100 text-gray-600';
  if (status === 'partially_shipped') return 'bg-cyan-100 text-cyan-700';
  if (status === 'in_production') return 'bg-amber-100 text-amber-700';
  if (status === 'cancelled') return 'bg-red-100 text-red-700';
  return 'bg-blue-100 text-blue-700';
};

const number = (value) => Number(value || 0);
const openProductionQty = (line) => (line.v2_production_orders || []).reduce((sum, item) => {
  if (!['draft', 'in_progress'].includes(item.status)) return sum;
  return sum + Math.max(0, number(item.plan_qty) - number(item.actual_qty) - number(item.scrap_qty));
}, 0);
const lineShortage = (line) => Math.max(0, number(line.quantity) - number(line.shipped_qty) - number(line.locked_qty) - openProductionQty(line));

const SalesOrderPage = ({ user }) => {
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [partners, setPartners] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [form, setForm] = useState({ customer_id: '', sales_person: user.label, due_date: '', lines: [] });
  const [newLine, setNewLine] = useState({ sku_code: '', quantity: '', unit_price: '' });
  const canManage = ['admin', 'inv_manager'].includes(user.role);

  const viewInventoryForSku = (sku) => navigate(`/inventory?search=${encodeURIComponent(sku)}`);
  const openProductionForShortage = (lineId) => navigate(`/v2/production?create_from_line=${encodeURIComponent(lineId)}`);

  const load = async () => {
    setLoading(true);
    try {
      const [o, p, pr] = await Promise.all([listSalesOrders(), listPartners(), listProductsMain()]);
      setOrders(o.orders || []);
      setPartners(p.partners || []);
      setProducts(pr.products || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const summary = useMemo(() => orders.reduce((acc, order) => {
    for (const line of order.v2_sales_order_lines || []) {
      acc.orderQty += number(line.quantity);
      acc.lockedQty += number(line.locked_qty);
      acc.shippedQty += number(line.shipped_qty);
      acc.shortageQty += lineShortage(line);
    }
    return acc;
  }, { orderQty: 0, lockedQty: 0, shippedQty: 0, shortageQty: 0 }), [orders]);

  const addLine = () => {
    if (!newLine.sku_code || number(newLine.quantity) <= 0) return;
    if (form.lines.some((line) => line.sku_code === newLine.sku_code)) {
      alert('同一订单请合并相同 SKU 的数量');
      return;
    }
    setForm({
      ...form,
      lines: [...form.lines, {
        ...newLine,
        quantity: number(newLine.quantity),
        unit_price: number(newLine.unit_price),
        unit: products.find((p) => p.sku_code === newLine.sku_code)?.base_unit || '件'
      }]
    });
    setNewLine({ sku_code: '', quantity: '', unit_price: '' });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.lines.length) return alert('请添加订单明细');
    setLoading(true);
    try {
      await createSalesOrder(form, form.lines);
      setForm({ customer_id: '', sales_person: user.label, due_date: '', lines: [] });
      setIsAdding(false);
      await load();
    } catch (e) {
      alert(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLock = async (order) => {
    if (!window.confirm(`确认按销售订单 ${order.order_no} 锁定当前可用成品库存？\n库存不足部分会保留为“待排产缺口”，不会超额扣库存。`)) return;
    setProcessingId(`lock-${order.id}`);
    try {
      const result = await lockInventoryForPlan(order.id, '主仓库');
      const shortageText = (result.shortages || []).length
        ? `\n仍缺：${result.shortages.map((item) => `${item.sku_code} × ${item.shortage_qty}`).join('、')}`
        : '\n当前订单已无未锁定的现货缺口。';
      alert(`本次成功锁定 ${number(result.locked_qty).toLocaleString()} 件。${shortageText}`);
      await load();
    } catch (e) {
      alert(e.message);
    } finally {
      setProcessingId('');
    }
  };

  const handleShip = async (order) => {
    const locked = (order.v2_sales_order_lines || []).reduce((sum, line) => sum + number(line.locked_qty), 0);
    if (locked <= 0) return alert('当前订单没有已锁定库存可以出货');
    if (!window.confirm(`确认本次出库 ${locked.toLocaleString()} 件？\n系统会把“已锁定”转为“已发货待签收”，并生成出货单。`)) return;
    setProcessingId(`ship-${order.id}`);
    try {
      const result = await shipSalesOrder(order.id, '主仓库');
      alert(`出货成功：${result.shipment_no || ''}\n本次出库 ${number(result.shipped_qty).toLocaleString()} 件。`);
      await load();
    } catch (e) {
      alert(e.message);
    } finally {
      setProcessingId('');
    }
  };

  const handleConfirmDelivery = async (shipment) => {
    if (!window.confirm(`确认客户已签收出货单 ${shipment.shipment_no}？\n确认后“已发货待签收”库存将从系统在途状态清除。`)) return;
    setProcessingId(`delivery-${shipment.id}`);
    try {
      await confirmShipmentDelivery(shipment.id);
      await load();
    } catch (e) {
      alert(e.message);
    } finally {
      setProcessingId('');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <SectionHeading title="销售订单中心" subtitle="订单 → 锁库 → 缺口排产 → 质检入库 → 出货签收" />
        <button onClick={() => setIsAdding(true)} className="btn-primary flex items-center justify-center gap-2 px-6"><Plus size={18} /> 新建正式订单</button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          ['累计订货', summary.orderQty],
          ['当前锁定', summary.lockedQty],
          ['累计已发', summary.shippedQty],
          ['待排产缺口', summary.shortageQty]
        ].map(([label, value]) => (
          <div key={label} className="card p-4">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{label}</p>
            <p className="text-xl font-black text-gray-800 mt-1">{number(value).toLocaleString()} <span className="text-[10px] text-gray-400 font-normal">件</span></p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4">
        {loading ? <div className="py-20 text-center"><Loader2 className="animate-spin mx-auto text-blue-500" /></div> : orders.length === 0 ? <div className="card p-20 text-center text-gray-400">暂无销售订单记录</div> : orders.map((order) => {
          const lines = order.v2_sales_order_lines || [];
          const locked = lines.reduce((sum, line) => sum + number(line.locked_qty), 0);
          const shortage = lines.reduce((sum, line) => sum + lineShortage(line), 0);
          const shipments = [...(order.v2_shipments || [])].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
          return (
            <div key={order.id} className="card p-6 hover:shadow-md transition-all border-l-4 border-blue-500">
              <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 mb-6">
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600"><ClipboardList size={24} /></div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-lg font-black text-gray-800">{order.order_no}</p>
                      <span className={`px-3 py-1 rounded-full text-[10px] font-black ${statusClass(order.status)}`}>{STATUS_LABELS[order.status] || order.status}</span>
                    </div>
                    <p className="text-xs text-gray-500 flex items-center gap-2 mt-1"><User size={12} /> {order.v2_business_partners?.name || '未知客户'} · <UserCheck size={12} /> {order.sales_person}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="text-right mr-2"><p className="text-[10px] font-bold text-gray-400">承诺交期</p><p className="text-xs font-black text-amber-600">{order.due_date || '-'}</p></div>
                  {canManage && !['cancelled', 'completed'].includes(order.status) && (
                    <button onClick={() => handleLock(order)} disabled={Boolean(processingId)} className="btn-secondary flex items-center gap-2"><Lock size={15} /> 锁定现货</button>
                  )}
                  {canManage && locked > 0 && (
                    <button onClick={() => handleShip(order)} disabled={Boolean(processingId)} className="btn-primary flex items-center gap-2"><Truck size={15} /> 出库已锁定 {locked.toLocaleString()}</button>
                  )}
                </div>
              </div>

              <div className="border rounded-xl overflow-x-auto">
                <table className="w-full text-xs text-left min-w-[780px]">
                  <thead className="bg-gray-50 text-gray-500">
                    <tr>
                      <th className="px-4 py-2">标准 SKU</th>
                      <th className="px-4 py-2 text-right">订货</th>
                      <th className="px-4 py-2 text-right">已锁定</th>
                      <th className="px-4 py-2 text-right">在产</th>
                      <th className="px-4 py-2 text-right">已发</th>
                      <th className="px-4 py-2 text-right">待排产缺口</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {lines.map((line) => {
                      const production = openProductionQty(line);
                      const shortageQty = lineShortage(line);
                      return (
                        <tr key={line.id} className="hover:bg-gray-50 group">
                          <td className="px-4 py-3">
                            <button onClick={() => viewInventoryForSku(line.sku_code)} className="font-bold text-left hover:text-blue-600 hover:underline flex items-center gap-1">
                               {line.sku_code}
                               <Search size={10} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                            </button>
                          </td>
                          <td className="px-4 py-3 text-right font-black">{number(line.quantity).toLocaleString()} {line.unit}</td>
                          <td className="px-4 py-3 text-right text-blue-600 font-black">{number(line.locked_qty).toLocaleString()}</td>
                          <td className="px-4 py-3 text-right text-amber-600 font-bold">{production.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right text-emerald-600 font-bold">{number(line.shipped_qty).toLocaleString()}</td>
                          <td className="px-4 py-3 text-right">
                             {shortageQty > 0 ? (
                               <button onClick={() => openProductionForShortage(line.id)} className="font-black text-red-600 hover:underline decoration-double underline-offset-2">
                                 {shortageQty.toLocaleString()}
                               </button>
                             ) : (
                               <span className="font-black text-gray-400">0</span>
                             )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {shortage > 0 && (
                <div className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-100 text-xs text-amber-800 flex items-center gap-2">
                  <Factory size={15} /> 
                  当前仍有 {shortage.toLocaleString()} 件未被库存或生产计划覆盖，
                  <button onClick={() => navigate('/v2/production')} className="font-bold underline">前往“生产计划”</button>
                  关联此销售订单排产。
                </div>
              )}

              {shipments.length > 0 && (
                <div className="mt-4 space-y-2">
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">出货记录</p>
                  {shipments.map((shipment) => (
                    <div key={shipment.id} className="flex flex-col md:flex-row md:items-center justify-between gap-2 p-3 border rounded-lg bg-gray-50/60 text-xs">
                      <div className="flex items-center gap-3">
                        <Truck size={15} className="text-blue-500" />
                        <span className="font-black">{shipment.shipment_no}</span>
                        <span className="text-gray-500">{shipment.status === 'delivered' ? '客户已签收' : '已发货待签收'}</span>
                        <span className="text-gray-400">{(shipment.v2_shipment_lines || []).reduce((sum, line) => sum + number(line.quantity), 0).toLocaleString()} 件</span>
                      </div>
                      {canManage && shipment.status === 'shipped' && (
                        <button onClick={() => handleConfirmDelivery(shipment)} disabled={Boolean(processingId)} className="btn-secondary flex items-center justify-center gap-2 py-1.5"><CheckCircle2 size={14} /> 确认客户签收</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {isAdding && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl p-6 shadow-2xl animate-in zoom-in-95">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold">录入销售订单</h3>
              <button onClick={() => setIsAdding(false)} className="p-2 hover:bg-gray-100 rounded-full"><X size={20} /></button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <label className="block"><span className="text-[10px] font-bold text-gray-400 uppercase">选择客户</span>
                  <select className="input-field mt-1" value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })} required>
                    <option value="">-- 请选择 --</option>
                    {partners.filter((p) => p.partner_type === 'customer').map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <label className="block"><span className="text-[10px] font-bold text-gray-400 uppercase">业务员</span><input className="input-field mt-1" value={form.sales_person} onChange={(e) => setForm({ ...form, sales_person: e.target.value })} /></label>
                <label className="block"><span className="text-[10px] font-bold text-gray-400 uppercase">承诺交期</span><input type="date" className="input-field mt-1" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} required /></label>
              </div>

              <div className="p-4 bg-gray-50 rounded-xl space-y-4">
                <p className="text-xs font-black text-gray-400 uppercase tracking-widest">订单明细</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <select className="input-field" value={newLine.sku_code} onChange={(e) => setNewLine({ ...newLine, sku_code: e.target.value })}>
                    <option value="">-- 选择 SKU --</option>
                    {products.map((p) => <option key={p.sku_code} value={p.sku_code}>{p.sku_code} · {p.formal_name}</option>)}
                  </select>
                  <input type="number" min="0" step="0.001" placeholder="订货数量" className="input-field" value={newLine.quantity} onChange={(e) => setNewLine({ ...newLine, quantity: e.target.value })} />
                  <input type="number" min="0" step="0.01" placeholder="单价 (选填)" className="input-field" value={newLine.unit_price} onChange={(e) => setNewLine({ ...newLine, unit_price: e.target.value })} />
                  <button type="button" onClick={addLine} className="btn-secondary h-10 flex items-center justify-center gap-2"><Plus size={16} /> 添加行</button>
                </div>
                <div className="divide-y bg-white rounded-lg border">
                  {form.lines.map((line, index) => (
                    <div key={`${line.sku_code}-${index}`} className="p-3 flex justify-between items-center text-xs">
                      <span className="font-bold">{line.sku_code}</span>
                      <div className="flex items-center gap-4">
                        <span className="font-black text-blue-600">{number(line.quantity).toLocaleString()} {line.unit}</span>
                        <button type="button" className="text-red-500" onClick={() => setForm({ ...form, lines: form.lines.filter((_, i) => i !== index) })}>删除</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <button type="submit" disabled={loading} className="w-full btn-primary py-4 flex items-center justify-center gap-2 shadow-xl shadow-blue-100">确认下单并进入备货/排产队列</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default SalesOrderPage;
