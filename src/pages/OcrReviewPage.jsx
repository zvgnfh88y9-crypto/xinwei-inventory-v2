// v3.0.3-REDIRECT-TO-INBOUND
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Tesseract from 'tesseract.js';
import { getSourceDocument, updateOcrResult, matchSkuAlias, saveProductAlias, listProductsMain, DOC_STATUSES } from '../lib/wmsV2Api';
import { listInventory, getSignedUrl } from '../lib/inventoryApi';
import { ArrowLeft, CheckCircle2, ChevronRight, Cpu, Eye, Loader2, Save, Search, Sparkles, XCircle, Plus } from 'lucide-react';
import SectionHeading from '../components/common/SectionHeading';

const OcrReviewPage = ({ user }) => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [ocrText, setOcrText] = useState('');
  const [structuredLines, setStructuredLines] = useState([]);
  const [products, setProducts] = useState([]);
  const [resolvedImageUrl, setResolvedImageUrl] = useState('');
  const [error, setError] = useState('');

  const resolveUrl = async (path) => {
    if (!path) return '';
    if (path.startsWith('http')) return path;
    try {
      return await getSignedUrl(path);
    } catch (e) {
      console.error('解析图片链接失败', e);
      return '';
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const [docData, productsData] = await Promise.all([getSourceDocument(id), listProductsMain()]);
      const document = docData.document;
      setDoc(document);
      setProducts(productsData.products || []);
      
      const url = await resolveUrl(document.file_url);
      setResolvedImageUrl(url);

      if (document.raw_ocr_text) setOcrText(document.raw_ocr_text);
      if (document.structured_data?.lines) setStructuredLines(document.structured_data.lines);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  const runOcr = async () => {
    if (!resolvedImageUrl) return setError('缺少有效的图片链接，无法识别');
    setProcessing(true);
    setError('');
    try {
      const { data: { text } } = await Tesseract.recognize(resolvedImageUrl, 'chi_sim+eng', {
        logger: m => { if (m.status === 'recognizing text') setProgress(Math.round(m.progress * 100)); }
      });
      setOcrText(text);
      
      // 简单结构化逻辑：按行拆分，尝试匹配 SKU
      const lines = text.split('\n').filter(l => l.trim().length > 1).map((line, idx) => ({
        id: idx,
        raw: line,
        sku_code: '',
        qty: 0,
        unit: '',
        confidence: 0
      }));
      setStructuredLines(lines);
      setProgress(0);
    } catch (e) {
      setError('识别失败：' + e.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleMatch = async (lineIdx, text) => {
    try {
      const { matches } = await matchSkuAlias(text);
      if (matches && matches.length > 0) {
        const newLines = [...structuredLines];
        newLines[lineIdx].sku_code = matches[0].sku_code;
        newLines[lineIdx].confidence = 1.0;
        setStructuredLines(newLines);
      }
    } catch (e) { console.error('匹配失败', e); }
  };

  const handleSave = async () => {
    setProcessing(true);
    try {
      await updateOcrResult(id, {
        raw_text: ocrText,
        structured_data: { lines: structuredLines },
        status: 'pending_match',
        confidence: 0.9
      });
      navigate('/inbound');
    } catch (e) {
      setError(e.message);
    } finally {
      setProcessing(false);
    }
  };

  const addManualLine = () => {
    setStructuredLines([...structuredLines, {
      id: Date.now(),
      raw: '手动新增行',
      sku_code: '',
      qty: 0,
      unit: '件',
      confidence: 1.0
    }]);
  };

  if (loading) return <div className="p-20 text-center"><Loader2 className="animate-spin mx-auto text-blue-500" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <button onClick={() => navigate('/v2/inbox')} className="flex items-center gap-2 text-gray-500 hover:text-gray-800 font-bold text-sm"><ArrowLeft size={16} /> 返回收件箱</button>
        <div className="flex gap-3">
          <button onClick={runOcr} disabled={processing} className="btn-secondary flex items-center gap-2">
            {processing ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} className="text-amber-500" />}
            {doc.raw_ocr_text ? '重新识别' : '开始智能识别'}
          </button>
          <button onClick={handleSave} disabled={processing || !structuredLines.length} className="btn-primary flex items-center gap-2 px-8">
            <Save size={16} /> 保存校对结果
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="card overflow-hidden bg-gray-900 flex flex-col h-[70vh]">
          <div className="p-4 border-b border-white/10 flex justify-between items-center">
            <h3 className="text-white text-xs font-bold flex items-center gap-2"><Eye size={14} /> 原始凭证预览</h3>
            <span className="text-[10px] text-white/40 font-mono">{doc.file_hash.slice(0,16)}</span>
          </div>
          <div className="flex-grow overflow-auto p-4 flex items-center justify-center">
             {resolvedImageUrl ? (
               <img src={resolvedImageUrl} className="max-w-full h-auto shadow-2xl" alt="凭证预览" />
             ) : (
               <div className="text-gray-600 text-xs flex flex-col items-center gap-2">
                 <Loader2 className="animate-spin" size={20} />
                 正在加载高清原图...
               </div>
             )}
          </div>
        </div>

        <div className="card h-[70vh] flex flex-col">
          <div className="p-4 border-b flex justify-between items-center bg-gray-50">
             <h3 className="font-bold text-sm flex items-center gap-2"><Cpu size={16} className="text-blue-600" /> 结构化校对工作台</h3>
             <div className="flex items-center gap-3">
               {progress > 0 && <div className="text-[10px] font-black text-blue-600 animate-pulse">正在识别: {progress}%</div>}
               <button onClick={addManualLine} className="p-1 px-2 rounded bg-white border border-blue-200 text-blue-600 text-[10px] font-bold flex items-center gap-1 hover:bg-blue-50 transition-colors"><Plus size={10} /> 手动加行</button>
             </div>
          </div>
          
          <div className="flex-grow overflow-auto">
             {structuredLines.length === 0 ? (
               <div className="p-20 text-center text-gray-400">
                 <Sparkles size={40} className="mx-auto mb-4 opacity-20" />
                 <p className="text-sm">尚未执行 OCR 识别，请点击上方按钮开始</p>
               </div>
             ) : (
               <table className="w-full text-xs text-left">
                 <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-4 py-2 text-gray-500">识别文本 (Raw)</th>
                      <th className="px-4 py-2 text-gray-500">匹配标准 SKU</th>
                      <th className="px-4 py-2 text-gray-500 w-32">数量</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {structuredLines.map((line, idx) => (
                      <tr key={idx} className="hover:bg-blue-50/30 group">
                        <td className="px-4 py-4 max-w-xs">
                          <p className="font-medium text-gray-700">{line.raw}</p>
                          <button onClick={() => handleMatch(idx, line.raw)} className="text-[9px] text-blue-500 font-bold mt-1 hover:underline flex items-center gap-1"><Search size={10} /> 智能匹配别名库</button>
                        </td>
                        <td className="px-4 py-4">
                          <select 
                            className={`input-field py-1 text-xs ${line.sku_code ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50'}`}
                            value={line.sku_code}
                            onChange={(e) => {
                              const newLines = [...structuredLines];
                              newLines[idx].sku_code = e.target.value;
                              setStructuredLines(newLines);
                            }}
                          >
                            <option value="">-- 请选择标准 SKU --</option>
                            {products.map(p => <option key={p.sku_code} value={p.sku_code}>{p.sku_code} · {p.formal_name}</option>)}
                          </select>
                          {line.sku_code && <p className="text-[8px] text-emerald-500 mt-1 font-bold flex items-center gap-1"><CheckCircle2 size={10} /> 已建立物理关联</p>}
                        </td>
                        <td className="px-4 py-4">
                          <input 
                            type="number"
                            className="input-field py-1 text-xs font-bold w-full"
                            value={line.qty}
                            onChange={(e) => {
                              const newLines = [...structuredLines];
                              newLines[idx].qty = Number(e.target.value);
                              setStructuredLines(newLines);
                            }}
                          />
                        </td>
                      </tr>
                    ))}

                 </tbody>
               </table>
             )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default OcrReviewPage;
