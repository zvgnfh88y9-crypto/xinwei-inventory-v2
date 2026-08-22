import React, { useEffect, useMemo, useState } from 'react';
import JSZip from 'jszip';
import { Archive, Camera, CheckCircle, ChevronDown, Download, Eye, FileText, Loader2, Plus, Search, Trash2, Upload } from 'lucide-react';
import { deleteArchiveDocument, getArchiveDocumentUrl, listArchiveDocuments, updateArchiveDocumentStatus, uploadArchiveDocument } from '../../lib/inventoryApi';

const kindLabel = { delivery_note: '送货单', receipt_note: '送货单', outbound_note: '出库单' };
const uploadKinds = ['delivery_note', 'outbound_note'];
const statusMeta = {
  uploaded: ['待管理员查看', 'bg-amber-50 text-amber-700'],
  reviewed: ['管理员已查看', 'bg-emerald-50 text-emerald-700'],
  archived: ['已归档', 'bg-slate-100 text-slate-600']
};
const today = () => new Date().toISOString().slice(0, 10);
const safeZipName = (value) => String(value || 'file').replace(/[\\/:*?"<>|]/g, '_');

export default function DocumentArchivePanel({ user }) {
  const isAdmin = user.role === 'admin';
  const [documents, setDocuments] = useState([]);
  const [kind, setKind] = useState('delivery_note');
  const [documentDate, setDocumentDate] = useState(today());
  const [partnerName, setPartnerName] = useState('');
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState([]);
  const [search, setSearch] = useState('');
  const [filterKind, setFilterKind] = useState('all');
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [showAdminUpload, setShowAdminUpload] = useState(false);

  const load = async () => {
    try { setDocuments(await listArchiveDocuments()); } catch (e) { setError(e.message); }
  };
  useEffect(() => { load(); }, []);

  const visible = useMemo(() => documents.filter((item) => {
    const matchesKind = filterKind === 'all'
      || item.document_kind === filterKind
      || (filterKind === 'delivery_note' && item.document_kind === 'receipt_note');
    const haystack = `${item.original_file_name} ${item.partner_name} ${item.uploaded_by_name} ${item.notes}`.toLowerCase();
    return matchesKind && (!search.trim() || haystack.includes(search.trim().toLowerCase()));
  }), [documents, filterKind, search]);
  const groups = useMemo(() => Object.entries(visible.reduce((acc, item) => {
    (acc[item.document_date] ||= []).push(item); return acc;
  }, {})), [visible]);

  const submit = async (event) => {
    event.preventDefault();
    if (!files.length) return setError('请至少拍摄或选择一个文件');
    setBusy(true); setError(''); setMessage('');
    try {
      for (let index = 0; index < files.length; index += 1) {
        setMessage(`正在上传 ${index + 1}/${files.length}：${files[index].name}`);
        await uploadArchiveDocument(files[index], { document_kind: kind, document_date: documentDate, partner_name: partnerName, notes });
      }
      setFiles([]); setPartnerName(''); setNotes(''); setMessage(`已上传 ${files.length} 个文件，管理员现在可以查看和下载。`);
      await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const openFile = async (item, download = false) => {
    try {
      const result = await getArchiveDocumentUrl(item.id, download);
      const anchor = document.createElement('a'); anchor.href = result.url; anchor.target = '_blank';
      if (download) anchor.download = result.filename || item.original_file_name;
      anchor.click();
      if (download) load();
    } catch (e) { setError(e.message); }
  };

  const downloadZip = async () => {
    const chosen = visible.filter((item) => selected.includes(item.id));
    if (!chosen.length) return setError('请先勾选要下载的文件');
    setBusy(true); setError(''); setMessage('正在准备 ZIP 压缩包…');
    try {
      const zip = new JSZip();
      for (let index = 0; index < chosen.length; index += 1) {
        const item = chosen[index]; setMessage(`正在下载 ${index + 1}/${chosen.length}`);
        const { url } = await getArchiveDocumentUrl(item.id, true);
        const response = await fetch(url); if (!response.ok) throw new Error(`下载 ${item.original_file_name} 失败`);
        const folder = zip.folder(`${item.document_date}/${kindLabel[item.document_kind]}`);
        folder.file(`${String(index + 1).padStart(2, '0')}-${safeZipName(item.original_file_name)}`, await response.blob());
      }
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `单据资料-${today()}.zip`; anchor.click(); URL.revokeObjectURL(url);
      setMessage(`已打包下载 ${chosen.length} 个文件。`); await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const changeStatus = async (item, status) => { try { setBusy(true); await updateArchiveDocumentStatus(item.id, status); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const remove = async (item) => { if (!window.confirm(`确认删除“${item.original_file_name}”吗？`)) return; try { await deleteArchiveDocument(item.id); setSelected((ids) => ids.filter((id) => id !== item.id)); await load(); } catch (e) { setError(e.message); } };

  const uploadForm = <form onSubmit={submit} className="space-y-4 rounded-2xl border bg-slate-50 p-4">
    <div className="grid grid-cols-2 gap-2">{uploadKinds.map((value) => <button key={value} type="button" onClick={() => setKind(value)} className={`rounded-xl border p-3 text-sm font-black ${kind === value ? 'border-blue-500 bg-blue-600 text-white' : 'bg-white text-slate-600'}`}>{kindLabel[value]}</button>)}</div>
    <label className="block text-xs font-bold text-slate-500">单据日期<input type="date" value={documentDate} onChange={(e) => setDocumentDate(e.target.value)} className="input-field mt-1" required /></label>
    <label className="block text-xs font-bold text-slate-500">往来单位（选填）<input value={partnerName} onChange={(e) => setPartnerName(e.target.value)} className="input-field mt-1" placeholder="供应商或客户名称" /></label>
    <label className="block text-xs font-bold text-slate-500">备注（选填）<textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="input-field mt-1 min-h-20" placeholder="单号、异常情况或交接说明" /></label>
    <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-blue-200 bg-white p-4 text-center text-blue-600">
      <Camera /><span className="mt-2 text-sm font-black">拍照 / 选择多个文件</span><span className="mt-1 text-[10px] text-slate-400">图片自动压缩，也支持 PDF；单个最大 8MB</span>
      <input type="file" multiple accept="image/png,image/jpeg,image/webp,application/pdf" capture="environment" className="hidden" onChange={(e) => setFiles(Array.from(e.target.files || []))} />
    </label>
    {files.length > 0 && <div className="rounded-lg bg-blue-50 p-3 text-xs text-blue-700">已选择 {files.length} 个：{files.map((f) => f.name).join('、')}</div>}
    <button disabled={busy || !files.length} className="btn-primary flex w-full items-center justify-center gap-2 py-3 disabled:opacity-50">{busy ? <Loader2 className="animate-spin" size={17} /> : <Upload size={17} />} {isAdmin ? '管理员补录上传' : '上传给管理员'}</button>
  </form>;

  return <section id="document-archive" className="card scroll-mt-24 overflow-hidden border-blue-100">
    <div className="border-b bg-gradient-to-r from-blue-50 to-white p-4 sm:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div><h3 className="flex items-center gap-2 text-lg font-black text-slate-900"><Archive className="text-blue-600" /> 员工单据资料</h3><p className="mt-1 text-xs text-slate-500">接收快速上传的送货单和出库单，按日期核对、下载并归档。</p></div>
        <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-blue-700 shadow-sm">{documents.filter((d) => d.status === 'uploaded').length} 份待处理</span>{isAdmin && <button type="button" onClick={() => setShowAdminUpload((value) => !value)} className="flex items-center gap-1 rounded-full border bg-white px-3 py-1 text-xs font-bold text-slate-600 shadow-sm hover:text-blue-600"><Plus size={13} />管理员补录<ChevronDown size={13} className={`transition ${showAdminUpload ? 'rotate-180' : ''}`} /></button>}</div>
      </div>
    </div>
    {isAdmin && showAdminUpload && <div className="border-b bg-slate-50/70 p-4 sm:p-6"><div className="mx-auto max-w-xl"><div className="mb-3"><h4 className="font-black text-slate-800">管理员补录</h4><p className="text-xs text-slate-500">仅用于代替员工补传遗漏资料，日常资料请由“快速上传”账号提交。</p></div>{uploadForm}</div></div>}
    <div className="p-4 sm:p-6">
      <div className="min-w-0">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1"><Search className="absolute left-3 top-2.5 text-slate-400" size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} className="input-field pl-9" placeholder="搜索文件、公司、上传人或备注" /></div>
          <select value={filterKind} onChange={(e) => setFilterKind(e.target.value)} className="input-field sm:w-36"><option value="all">全部类型</option><option value="delivery_note">送货单</option><option value="outbound_note">出库单</option></select>
          {isAdmin && <button type="button" onClick={downloadZip} disabled={busy || !selected.length} className="btn-secondary flex items-center justify-center gap-2 disabled:opacity-40"><Download size={16} />打包下载 ({selected.length})</button>}
        </div>
        {error && <p className="mb-3 rounded-lg bg-red-50 p-3 text-xs font-bold text-red-600">{error}</p>}
        {message && <p className="mb-3 rounded-lg bg-emerald-50 p-3 text-xs font-bold text-emerald-700">{message}</p>}
        <div className="max-h-[38rem] space-y-5 overflow-y-auto pr-1">
          {!groups.length && <p className="rounded-xl border border-dashed p-12 text-center text-sm text-slate-400">暂无上传资料</p>}
          {groups.map(([date, items]) => <div key={date}><div className="sticky top-0 z-10 mb-2 flex items-center justify-between bg-white/95 py-2 backdrop-blur"><h4 className="font-black text-slate-800">{date}</h4><span className="text-xs text-slate-400">{items.length} 个文件</span></div><div className="space-y-2">{items.map((item) => {
            const meta = statusMeta[item.status] || statusMeta.uploaded;
            return <article key={item.id} className="rounded-xl border p-3 transition hover:border-blue-200 hover:bg-blue-50/20">
              <div className="flex items-start gap-3">
                {isAdmin && <input type="checkbox" checked={selected.includes(item.id)} onChange={(e) => setSelected((ids) => e.target.checked ? [...ids, item.id] : ids.filter((id) => id !== item.id))} className="mt-1 h-4 w-4" />}
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">{item.mime_type === 'application/pdf' ? <FileText size={20} /> : <Camera size={20} />}</div>
                <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="truncate font-bold text-slate-800">{item.original_file_name}</p><span className="rounded bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">{kindLabel[item.document_kind]}</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${meta[1]}`}>{meta[0]}</span></div><p className="mt-1 text-xs text-slate-500">{item.partner_name || '未填写往来单位'} · 上传人 {item.uploaded_by_name || '员工'} · {(item.file_size / 1024).toFixed(0)}KB</p>{item.notes && <p className="mt-1 truncate text-xs text-slate-400">{item.notes}</p>}</div>
              </div>
              <div className="mt-3 flex flex-wrap justify-end gap-2 border-t pt-2"><button onClick={() => openFile(item)} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-blue-600 hover:bg-blue-50"><Eye size={14} />查看</button><button onClick={() => openFile(item, true)} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-blue-600 hover:bg-blue-50"><Download size={14} />下载</button>{isAdmin && item.status === 'uploaded' && <button onClick={() => changeStatus(item, 'reviewed')} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-emerald-600"><CheckCircle size={14} />标记已查看</button>}{isAdmin && item.status === 'reviewed' && <button onClick={() => changeStatus(item, 'archived')} className="rounded-lg px-2 py-1 text-xs font-bold text-slate-600">归档</button>}{(isAdmin || (item.uploaded_by === user.id && item.status === 'uploaded')) && <button onClick={() => remove(item)} className="rounded-lg p-1 text-red-400"><Trash2 size={14} /></button>}</div>
            </article>;
          })}</div></div>)}
        </div>
      </div>
    </div>
  </section>;
}
