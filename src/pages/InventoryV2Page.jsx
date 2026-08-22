import React, { useEffect, useState } from 'react';
import SectionHeading from '../components/common/SectionHeading';
import { listInventoryBalances, INV_STATUSES } from '../lib/wmsV2Api';
import { Box, Layers, Loader2, MapPin, Package, ShieldCheck } from 'lucide-react';

const InventoryV2Page = ({ user }) => {
  const [balances, setBalances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const data = await listInventoryBalances();
      setBalances(data.balances || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <SectionHeading 
          title="全状态库存看板" 
          subtitle="穿透查看可用、锁定、在制、待检、委外等 8 个维度的实时存量"
        />
        <button onClick={load} className="btn-secondary flex items-center gap-2"><Layers size={16} /> 刷新全局快照</button>
      </div>

      {error && <div className="p-4 bg-red-50 text-red-600 rounded-lg text-xs font-bold border border-red-100 flex items-center gap-2 animate-shake"><ShieldCheck size={16} />{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {Object.entries(INV_STATUSES).map(([key, label]) => {
          const total = balances.filter(b => b.status === key).reduce((s, b) => s + Number(b.quantity), 0);
          return (
            <div key={key} className="card p-4 flex items-center justify-between hover:shadow-lg transition-all">
              <div>
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{label}</p>
                <p className="text-xl font-black text-gray-800">{total.toLocaleString()} <span className="text-[10px] font-normal text-gray-400">件</span></p>
              </div>
              <div className={`p-2 rounded-lg ${total > 0 ? 'bg-blue-50 text-blue-600' : 'bg-gray-50 text-gray-300'}`}><Box size={20} /></div>
            </div>
          );
        })}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase">产品信息 / SKU</th>
                <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase">仓库/库位</th>
                <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase">状态属性</th>
                <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase">批次/编号</th>
                <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase text-right">实时余额</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? <tr><td colSpan={5} className="py-20 text-center"><Loader2 className="animate-spin mx-auto text-blue-500" /></td></tr> : balances.length === 0 ? <tr><td colSpan={5} className="py-20 text-center text-gray-400">暂无库存分布记录</td></tr> : balances.map(b => (
                <tr key={b.id} className="hover:bg-gray-50/50 group">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-gray-400 group-hover:bg-blue-600 group-hover:text-white transition-colors"><Package size={16} /></div>
                      <div>
                        <p className="text-sm font-bold text-gray-800">{b.sku_code}</p>
                        <p className="text-[10px] text-gray-400">{b.v2_product_main?.formal_name || '未定义主数据'}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 text-xs font-bold text-gray-600">
                      <MapPin size={14} className="text-gray-300" />
                      {b.warehouse} · {b.bin_location}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${b.status === 'available' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>
                      {INV_STATUSES[b.status]}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-xs font-mono text-gray-400">{b.batch_no}</td>
                  <td className="px-6 py-4 text-right">
                    <p className="text-sm font-black text-blue-600">{Number(b.quantity).toLocaleString()}</p>
                    <p className="text-[9px] text-gray-400 uppercase">{b.v2_product_main?.base_unit || '件'}</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default InventoryV2Page;
