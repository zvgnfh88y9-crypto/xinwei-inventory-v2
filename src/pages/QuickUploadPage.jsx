import React, { useEffect, useState } from 'react';
import { Camera, CheckCircle, Download, FileUp, Loader2, LogOut, PackageCheck, Truck, X } from 'lucide-react';
import { getArchiveDocumentUrl, listArchiveDocuments, uploadArchiveDocument } from '../lib/inventoryApi';

const TYPES = {
  delivery_note: { label: '送货单', help: '拍摄供应商送来的送货单', icon: Truck, color: 'from-blue-600 to-indigo-600' },
  outbound_note: { label: '出库单', help: '拍摄仓库发出的出库单', icon: PackageCheck, color: 'from-orange-500 to-red-500' }
};
const today = () => new Date().toISOString().slice(0, 10);

export default function QuickUploadPage({ user, onLogout }) {
  const [type, setType] = useState('');
  const [date, setDate] = useState(today());
  const [files, setFiles] = useState([]);
  const [recent, setRecent] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = async () => { try { setRecent((await listArchiveDocuments()).slice(0, 8)); } catch {} };
  useEffect(() => { load(); }, []);

  const upload = async () => {
    if (!type || !files.length) return;
    setBusy(true); setError(''); setMessage('');
    try {
      for (let i = 0; i < files.length; i += 1) {
        setMessage(`正在上传 ${i + 1}/${files.length}…`);
        await uploadArchiveDocument(files[i], { document_kind: type, document_date: date, partner_name: '', notes: '快速上传入口' });
      }
      setMessage(`上传成功！${files.length} 张照片已传给管理员。`); setFiles([]); setType(''); await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const preview = async (id) => { try { const { url } = await getArchiveDocumentUrl(id); window.open(url, '_blank', 'noopener'); } catch (e) { setError(e.message); } };

  return <div className="min-h-screen bg-slate-50">
    <header className="flex items-center justify-between border-b bg-white px-5 py-4 shadow-sm">
      <div className="flex items-center gap-3"><img src="/assets/images/logo-xw.png" className="h-9" /><div><h1 className="font-black text-slate-900">单据快速上传</h1><p className="text-[10px] text-slate-400">拍照后自动传给管理员</p></div></div>
      <button onClick={onLogout} className="flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-bold text-slate-500"><LogOut size={16} />退出</button>
    </header>
    <main className="mx-auto max-w-xl space-y-6 p-5 sm:py-10">
      {!type ? <section>
        <h2 className="mb-2 text-center text-2xl font-black text-slate-900">请选择要上传的单据</h2><p className="mb-7 text-center text-sm text-slate-500">无需录入产品资料，只需拍清楚整张单据</p>
        <div className="grid gap-5">{Object.entries(TYPES).map(([key, item]) => { const Icon = item.icon; return <button key={key} onClick={() => { setType(key); setMessage(''); setError(''); }} className={`min-h-40 rounded-3xl bg-gradient-to-br ${item.color} p-7 text-left text-white shadow-xl transition active:scale-[.98]`}><Icon size={42} /><span className="mt-5 block text-3xl font-black">{item.label}</span><span className="mt-1 block text-sm text-white/80">{item.help}</span></button>; })}</div>
      </section> : <section className="rounded-3xl bg-white p-5 shadow-xl sm:p-7">
        <div className="mb-6 flex items-center justify-between"><div><p className="text-xs font-bold text-blue-600">当前上传类型</p><h2 className="text-2xl font-black">{TYPES[type].label}</h2></div><button onClick={() => { setType(''); setFiles([]); }} className="rounded-full bg-slate-100 p-2 text-slate-500"><X /></button></div>
        <label className="mb-5 block text-sm font-bold text-slate-600">单据日期<input type="date" className="input-field mt-2 text-lg" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="flex min-h-56 cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed border-blue-300 bg-blue-50 p-6 text-center text-blue-600">
          <Camera size={52} /><span className="mt-4 text-xl font-black">拍照或选择照片</span><span className="mt-2 text-xs text-slate-500">可以一次选择多张，请保证文字清楚、四角完整</span>
          <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" multiple className="hidden" onChange={(e) => setFiles(Array.from(e.target.files || []))} />
        </label>
        {files.length > 0 && <div className="mt-4 rounded-xl bg-slate-50 p-4"><p className="font-bold text-slate-700">已选择 {files.length} 个文件</p><p className="mt-1 truncate text-xs text-slate-400">{files.map((f) => f.name).join('、')}</p></div>}
        {error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-600">{error}</p>}
        {message && <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-700">{message}</p>}
        <button onClick={upload} disabled={busy || !files.length} className="btn-primary mt-5 flex w-full items-center justify-center gap-2 py-4 text-lg disabled:opacity-40">{busy ? <Loader2 className="animate-spin" /> : <FileUp />}确认上传给管理员</button>
      </section>}

      {recent.length > 0 && <section className="rounded-2xl border bg-white p-4"><h3 className="mb-3 flex items-center gap-2 font-black"><CheckCircle size={18} className="text-emerald-500" />最近上传</h3><div className="divide-y">{recent.map((item) => <button key={item.id} onClick={() => preview(item.id)} className="flex w-full items-center justify-between gap-3 py-3 text-left"><div className="min-w-0"><p className="truncate text-sm font-bold">{TYPES[item.document_kind]?.label || '单据'} · {item.original_file_name}</p><p className="text-[10px] text-slate-400">{item.document_date} · {item.status === 'uploaded' ? '等待管理员查看' : item.status === 'reviewed' ? '管理员已查看' : '已归档'}</p></div><Download size={16} className="shrink-0 text-blue-500" /></button>)}</div></section>}
      <p className="text-center text-[10px] text-slate-400">登录账号：{user.username} · 此账号无法查看库存或审批数据</p>
    </main>
  </div>;
}
