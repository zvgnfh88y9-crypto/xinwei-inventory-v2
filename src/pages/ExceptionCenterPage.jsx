import React, { useEffect, useState } from 'react';
import SectionHeading from '../components/common/SectionHeading';
import { listExceptions, mergePartner } from '../lib/wmsV2Api';
import { AlertCircle, AlertTriangle, FileWarning, Loader2, ShieldAlert, Trash2, XCircle, PackageSearch, ClipboardList, ArrowRight, Building2, CheckCircle2, UserPlus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const ExceptionCenterPage = ({ user }) => {
  const navigate = useNavigate();
  const [exceptions, setExceptions] = useState({ ocr_failed: [], duplicated: [], qc_discrepancies: [], temporary_skus: [], negative_stock: [], partner_exceptions: [] });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('ocr'); // ocr, duplication, qc, temp_sku, negative_stock, partners

  const load = async () => {
    setLoading(true);
    try {
      const data = await listExceptions();
      setExceptions(data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleFixSku = (sku) => {
    localStorage.setItem('xinwei_pending_edit', sku);
    navigate('/inventory');
  };

  const handleMergePartner = async (oldName, standardName) => {
    if (!window.confirm(`确定将单据中的“${oldName}”合并为“${standardName}”吗？`)) return;
    setLoading(true);
    try {
      await mergePartner(oldName, standardName);
      await load();
    } catch (e) { alert('合并失败：' + e.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-6">
      <SectionHeading 
        title="异常与风险处理中心" 
        subtitle="集中监控单据识别失败、重复凭证及质检差异，确保系统数据绝对洁净"
      />

      <div className="flex items-center gap-2 p-1 bg-gray-100 rounded-xl w-fit overflow-x-auto max-w-full">
        <button onClick={() => setActiveTab('ocr')} className={`shrink-0 px-4 py-2 text-xs font-bold rounded-lg transition-all ${activeTab === 'ocr' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}>识别失败 ({exceptions.ocr_failed.length})</button>
        <button onClick={() => setActiveTab('duplication')} className={`shrink-0 px-4 py-2 text-xs font-bold rounded-lg transition-all ${activeTab === 'duplication' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}>疑似重复 ({exceptions.duplicated.length})</button>
        <button onClick={() => setActiveTab('qc')} className={`shrink-0 px-4 py-2 text-xs font-bold rounded-lg transition-all ${activeTab === 'qc' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}>质检差异 ({exceptions.qc_discrepancies.length})</button>
        <button onClick={() => setActiveTab('temp_sku')} className={`shrink-0 px-4 py-2 text-xs font-bold rounded-lg transition-all ${activeTab === 'temp_sku' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}>临时 SKU ({exceptions.temporary_skus.length})</button>
        <button onClick={() => setActiveTab('negative_stock')} className={`shrink-0 px-4 py-2 text-xs font-bold rounded-lg transition-all ${activeTab === 'negative_stock' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}>负库存 ({exceptions.negative_stock.length})</button>
        <button onClick={() => setActiveTab('partners')} className={`shrink-0 px-4 py-2 text-xs font-bold rounded-lg transition-all ${activeTab === 'partners' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}>单位冲突 ({exceptions.partner_exceptions.length})</button>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {loading ? <div className="py-20 text-center"><Loader2 className="animate-spin mx-auto text-blue-500" /></div> : (
          <>
            {/* ... other tabs ... */}
            {activeTab === 'ocr' && (
              exceptions.ocr_failed.length === 0 ? <div className="card p-20 text-center text-gray-400">零识别异常，单据处理非常健康</div> : exceptions.ocr_failed.map(ex => (
                <div key={ex.id} className="card p-4 border-l-4 border-amber-500 flex justify-between items-center">
                   <div className="flex items-center gap-4">
                      <div className="h-10 w-10 rounded-full bg-amber-50 flex items-center justify-center text-amber-600"><FileWarning size={20} /></div>
                      <div>
                         <p className="text-sm font-bold text-gray-800">识别失败凭证：{ex.source_channel}</p>
                         <p className="text-[10px] text-gray-400">上传时间：{new Date(ex.created_at).toLocaleString()}</p>
                      </div>
                   </div>
                   <button className="btn-secondary text-xs">重新提交 OCR</button>
                </div>
              ))
            )}

            {activeTab === 'duplication' && (
              exceptions.duplicated.length === 0 ? <div className="card p-20 text-center text-gray-400">未发现重复上传的文件</div> : exceptions.duplicated.map(ex => (
                <div key={ex.id} className="card p-4 border-l-4 border-red-500 flex justify-between items-center">
                   <div className="flex items-center gap-4">
                      <div className="h-10 w-10 rounded-full bg-red-50 flex items-center justify-center text-red-600"><ShieldAlert size={20} /></div>
                      <div>
                         <p className="text-sm font-bold text-gray-800">文件哈希冲突：{ex.file_hash.slice(0,16)}</p>
                         <p className="text-[10px] text-gray-400">来源：{ex.source_channel}</p>
                      </div>
                   </div>
                   <div className="flex gap-2">
                      <button className="btn-secondary text-xs">对比原单</button>
                      <button className="btn-secondary text-xs text-red-500">标记作废</button>
                   </div>
                </div>
              ))
            )}

            {activeTab === 'qc' && (
              exceptions.qc_discrepancies.length === 0 ? <div className="card p-20 text-center text-gray-400">所有质检均已 100% 合格入库</div> : exceptions.qc_discrepancies.map(ex => (
                <div key={ex.id} className="card p-4 border-l-4 border-rose-500 flex justify-between items-center">
                   <div className="flex items-center gap-4">
                      <div className="h-10 w-10 rounded-full bg-rose-50 flex items-center justify-center text-rose-600"><AlertTriangle size={20} /></div>
                      <div>
                         <p className="text-sm font-bold text-gray-800">质检不合格拦截：{ex.sku_code}</p>
                         <p className="text-[10px] text-gray-400">异常数量：<span className="font-bold text-red-500">{ex.fail_qty}</span> 件 · 原因：{ex.fail_reason || '未注明'}</p>
                      </div>
                   </div>
                   <button className="btn-secondary text-xs">下达补货/退货指令</button>
                </div>
              ))
            )}

            {activeTab === 'temp_sku' && (
              exceptions.temporary_skus.length === 0 ? <div className="card p-20 text-center text-gray-400">暂无待完善资料的临时 SKU</div> : exceptions.temporary_skus.map(item => (
                <div key={item.sku} className="card p-4 border-l-4 border-blue-500 flex justify-between items-center">
                   <div className="flex items-center gap-4">
                      <div className="h-10 w-10 rounded-full bg-blue-50 flex items-center justify-center text-blue-600"><PackageSearch size={20} /></div>
                      <div>
                         <p className="text-sm font-bold text-gray-800">临时 SKU：{item.sku}</p>
                         <p className="text-[10px] text-gray-400">暂定名：{item.name} · 创建于 {new Date(item.created_at).toLocaleDateString()}</p>
                      </div>
                   </div>
                   <button onClick={() => handleFixSku(item.sku)} className="btn-primary text-xs flex items-center gap-1">补全主数据 <ArrowRight size={14} /></button>
                </div>
              ))
            )}

            {activeTab === 'negative_stock' && (
              exceptions.negative_stock.length === 0 ? <div className="card p-20 text-center text-gray-400">当前没有负库存产品，账实相符情况良好</div> : exceptions.negative_stock.map(item => (
                <div key={item.sku} className="card p-4 border-l-4 border-purple-500 flex justify-between items-center">
                   <div className="flex items-center gap-4">
                      <div className="h-10 w-10 rounded-full bg-purple-50 flex items-center justify-center text-purple-600"><ClipboardList size={20} /></div>
                      <div>
                         <p className="text-sm font-bold text-gray-800">负库存预警：{item.name}</p>
                         <p className="text-[10px] text-gray-400">当前可用：<span className="font-bold text-red-600">{item.available_stock}</span> {item.unit} · <span className="text-purple-600 font-bold">需盘点补齐</span></p>
                      </div>
                   </div>
                   <div className="flex gap-2">
                     <button onClick={() => navigate(`/inventory-count?sku=${item.sku}`)} className="btn-primary text-xs bg-purple-600 hover:bg-purple-700">去盘点</button>
                     <button onClick={() => navigate(`/inventory?search=${item.sku}`)} className="btn-secondary text-xs">查流水</button>
                   </div>
                </div>
              ))
            )}

            {activeTab === 'partners' && (
              exceptions.partner_exceptions.length === 0 ? <div className="card p-20 text-center text-gray-400">往来单位名称与标准库完全匹配</div> : exceptions.partner_exceptions.map(ex => (
                <div key={ex.unmatchedName} className="card p-5 border-l-4 border-indigo-500 flex flex-col gap-4">
                   <div className="flex justify-between items-start">
                      <div className="flex items-center gap-4">
                        <div className="h-10 w-10 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600"><Building2 size={20} /></div>
                        <div>
                          <p className="text-sm font-bold text-gray-800">未识别单位：{ex.unmatchedName}</p>
                          <p className="text-[10px] text-gray-400">该名称在单据中使用，但未在标准往来单位库建档</p>
                        </div>
                      </div>
                      <button onClick={() => handleMergePartner(ex.unmatchedName, ex.unmatchedName)} className="btn-secondary text-[10px] py-1 px-3 flex items-center gap-1"><UserPlus size={12} /> 以此名称建档</button>
                   </div>

                   {ex.suggestions.length > 0 && (
                     <div className="bg-slate-50 rounded-lg p-3">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">相似名称合并建议</p>
                        <div className="flex flex-wrap gap-2">
                           {ex.suggestions.map(s => (
                             <button 
                               key={s.id} 
                               onClick={() => handleMergePartner(ex.unmatchedName, s.name)}
                               className="flex items-center gap-2 bg-white border border-indigo-100 hover:border-indigo-400 px-3 py-1.5 rounded-lg transition-all group"
                             >
                               <span className="text-xs font-bold text-gray-700">{s.name}</span>
                               <span className="text-[9px] bg-indigo-50 text-indigo-600 px-1 rounded font-black group-hover:bg-indigo-600 group-hover:text-white">匹配 {Math.round(s.score * 100)}%</span>
                               <CheckCircle2 size={12} className="text-indigo-400" />
                             </button>
                           ))}
                        </div>
                     </div>
                   )}
                </div>
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default ExceptionCenterPage;
