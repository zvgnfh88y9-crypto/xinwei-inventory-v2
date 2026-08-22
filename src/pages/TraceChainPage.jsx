import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getTraceChain, DOC_STATUSES } from '../lib/wmsV2Api';
import { ArrowLeft, ArrowRight, Box, ClipboardList, Factory, Loader2, PackageCheck, Truck } from 'lucide-react';
import SectionHeading from '../components/common/SectionHeading';

const TraceChainPage = ({ user }) => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [chain, setChain] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const data = await getTraceChain(id);
      setChain(data.chain || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [id]);

  const getTypeIcon = (type) => {
    if (type === 'receipt') return <PackageCheck size={20} />;
    if (type === 'production_in') return <Factory size={20} />;
    if (type === 'shipment') return <Truck size={20} />;
    return <ClipboardList size={20} />;
  };

  return (
    <div className="space-y-6">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-gray-500 hover:text-gray-800 font-bold text-sm mb-4">
        <ArrowLeft size={16} /> 返回上一级
      </button>

      <SectionHeading 
        title="单据全链路溯源" 
        subtitle="可视化追踪单据的业务生命周期，从订单下达到物流交付的每一环"
      />

      <div className="flex flex-col items-center py-10">
        {loading ? <Loader2 className="animate-spin text-blue-500" size={32} /> : chain.length === 0 ? (
          <div className="text-gray-400">未找到关联的溯源链</div>
        ) : (
          <div className="flex flex-col md:flex-row items-center gap-6">
            {chain.map((item, idx) => (
              <React.Fragment key={item.id}>
                <div className="group relative">
                  <div className="card p-6 min-w-[220px] hover:ring-2 ring-blue-500 transition-all cursor-pointer">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="p-2 rounded-lg bg-blue-50 text-blue-600">{getTypeIcon(item.type)}</div>
                      <span className="text-[10px] font-black text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full uppercase">{item.type}</span>
                    </div>
                    <p className="text-sm font-black text-gray-800">{item.doc_no}</p>
                    <p className="text-[10px] text-gray-500 mt-1">{item.date} · {DOC_STATUSES[item.status] || item.status}</p>
                  </div>
                  {idx < chain.length - 1 && (
                    <div className="hidden md:flex absolute -right-6 top-1/2 -translate-y-1/2 text-gray-300">
                      <ArrowRight size={24} />
                    </div>
                  )}
                  {idx < chain.length - 1 && (
                    <div className="md:hidden flex justify-center py-4 text-gray-300">
                      <ArrowLeft size={24} className="rotate-[-90deg]" />
                    </div>
                  )}
                </div>
              </React.Fragment>
            ))}
          </div>
        )}
      </div>

      <div className="p-6 bg-blue-50 rounded-2xl border border-blue-100 mt-10">
        <h4 className="text-sm font-bold text-blue-800 mb-2 flex items-center gap-2"><Box size={16} /> 溯源链合规说明</h4>
        <p className="text-xs text-blue-600 leading-relaxed">
          上述链路展示了当前单据的物理流转路径。每一节点均关联了正式的库存流水、操作人数字签名及原始凭证哈希，符合企业级 WMS 财务审计标准。
        </p>
      </div>
    </div>
  );
};

export default TraceChainPage;
