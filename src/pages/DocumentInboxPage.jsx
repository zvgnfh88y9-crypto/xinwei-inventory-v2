import React, { useEffect, useState } from 'react';
import SectionHeading from '../components/common/SectionHeading';
import { listSourceDocuments, uploadSourceDocument, DOC_STATUSES, deleteSourceDocument, updateSourceDocument } from '../lib/wmsV2Api';
import { getSignedUrl } from '../lib/inventoryApi';
import { Camera, FileUp, Hash, Inbox, Loader2, MessageSquare, Search, ShieldCheck, Tag, Trash2, Pencil } from 'lucide-react';

import { useNavigate } from 'react-router-dom';

const DocImage = ({ path }) => {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!path) return;
    if (path.startsWith('http')) {
      setUrl(path);
      return;
    }
    getSignedUrl(path).then(setUrl).catch(console.error);
  }, [path]);

  if (!url) return <div className="w-full h-full bg-gray-100 flex items-center justify-center"><Loader2 className="animate-spin text-gray-300" size={16} /></div>;
  return <img src={url} className="w-full h-full object-cover" alt="凭证缩略图" />;
};

const DocumentInboxPage = ({ user }) => {
  const navigate = useNavigate();
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const data = await listSourceDocuments();
      setDocs(data.documents || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const channel = window.prompt('请输入文件来源（如：鑫成对接群）', '手动上传');
      await uploadSourceDocument(file, channel);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleEditChannel = async (e, doc) => {
    e.stopPropagation();
    const newChannel = window.prompt('修改来源名称/渠道：', doc.source_channel);
    if (newChannel === null || newChannel === doc.source_channel) return;
    setLoading(true);
    try {
      await updateSourceDocument(doc.id, { source_channel: newChannel });
      await load();
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (e, id) => {
    e.stopPropagation();
    if (!window.confirm('确定要永久删除这份原始凭证吗？此操作不可撤销。')) return;
    setLoading(true);
    try {
      await deleteSourceDocument(id);
      await load();
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeading 
        title="群文件智能收件箱" 
        subtitle="集中处理微信群截图、Excel、PDF 等各类原始业务凭证"
        badge={docs.filter(d => d.status === 'pending_ocr').length + ' 待处理'}
      />

      {error && <div className="p-4 bg-red-50 text-red-600 rounded-lg text-xs font-bold border border-red-100 flex items-center gap-2 animate-shake"><ShieldCheck size={16} />{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-1 space-y-4">
          <div className="card p-6 bg-blue-600 text-white shadow-xl shadow-blue-100">
            <h3 className="font-bold flex items-center gap-2 mb-2"><FileUp size={20} /> 智能导入</h3>
            <p className="text-xs text-blue-100 mb-6 leading-relaxed">上传后系统将自动计算文件哈希防重，并排队进入 OCR 识别中心。</p>
            <label className="btn-secondary w-full py-3 flex items-center justify-center gap-2 cursor-pointer bg-white text-blue-600 border-none hover:bg-blue-50">
              {uploading ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />}
              立即上传文件
              <input type="file" className="hidden" onChange={handleUpload} disabled={uploading} />
            </label>
          </div>
          
          <div className="card p-4 space-y-3">
             <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">快捷筛选</h4>
             <button className="flex items-center justify-between w-full p-2 rounded-lg bg-blue-50 text-blue-600 font-bold text-xs"><span className="flex items-center gap-2"><Inbox size={14} /> 全部凭证</span> <span>{docs.length}</span></button>
             <button className="flex items-center justify-between w-full p-2 rounded-lg hover:bg-gray-50 text-gray-500 text-xs"><span className="flex items-center gap-2"><Tag size={14} /> 销售订单</span> <span>0</span></button>
          </div>
        </div>

        <div className="lg:col-span-3 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {loading ? Array(6).fill(0).map((_, i) => <div key={i} className="h-40 card animate-pulse bg-gray-100"></div>) : docs.length === 0 ? (
              <div className="col-span-full py-20 text-center text-gray-400"><Inbox size={48} className="mx-auto mb-4 opacity-20" /><p>收件箱空空如也，快去上传第一份凭证吧</p></div>
            ) : docs.map(doc => (
              <div 
                key={doc.id} 
                onClick={() => navigate(`/v2/ocr-review/${doc.id}`)}
                className="card overflow-hidden hover:ring-2 ring-blue-400 transition-all cursor-pointer group"
              >
                <div className="h-32 bg-gray-100 relative">
                  <DocImage path={doc.file_url} />
                  <div className="absolute top-2 right-2 px-2 py-0.5 rounded bg-black/60 text-white text-[8px] font-bold backdrop-blur-md uppercase">{DOC_STATUSES[doc.status]}</div>
                </div>
                <div className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div 
                        onClick={(e) => handleEditChannel(e, doc)}
                        className="p-2 rounded-lg bg-gray-50 text-gray-400 group-hover:bg-blue-50 group-hover:text-blue-500 transition-colors shrink-0 cursor-edit"
                        title="修改来源名称"
                      >
                        <MessageSquare size={16} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-gray-800 truncate">{doc.source_channel || '未知群聊'}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">{new Date(doc.created_at).toLocaleString()}</p>
                      </div>
                    </div>
                    {user.role === 'admin' && (
                      <button 
                        onClick={(e) => handleDelete(e, doc.id)}
                        className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors shrink-0"
                        title="删除凭证"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[9px] font-bold text-gray-400 uppercase tracking-tighter">
                    <Hash size={10} /> {doc.file_hash.slice(0, 12)}...
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DocumentInboxPage;
