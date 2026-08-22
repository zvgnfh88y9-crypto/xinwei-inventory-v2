import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Building2,
  ChevronDown,
  ChevronRight,
  Loader2,
  PackageCheck,
  Search,
  Truck
} from 'lucide-react';
import SectionHeading from '../components/common/SectionHeading';
import { listWorkflowDocuments } from '../lib/workflowApi';

const STATUS_LABELS = {
  draft: '草稿',
  pending: '待仓管审核',
  warehouse_approved: '待管理员终审',
  approved: '终审通过',
  posted: '已入账',
  rejected: '已驳回',
  cancelled: '已取消',
  voided: '已作废'
};
const INBOUND_TYPES = new Set(['receipt', 'production_in']);
const OUTBOUND_TYPES = new Set(['shipment', 'retail_sale']);
const BUSINESS_TYPES = new Set([...INBOUND_TYPES, ...OUTBOUND_TYPES]);
const number = (value) => Number(value || 0);
const quantityOf = (doc) => (doc.inventory_document_lines || [])
  .reduce((sum, line) => sum + number(line.quantity), 0);
const isPending = (status) => !['posted', 'voided', 'cancelled', 'rejected'].includes(status);

const PartnerLedgerPage = () => {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState('');
  const [directionByPartner, setDirectionByPartner] = useState({});

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await listWorkflowDocuments();
      setDocuments(result.documents || result || []);
    } catch (loadError) {
      setError(loadError.message || '往来单位流水加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openDocument = (doc) => {
    const route = INBOUND_TYPES.has(doc.document_type) ? '/inbound' : '/outbound';
    // 整页载入，避免手机端把旧版缓存脚本与新版详情模块混合运行。
    window.location.assign(`${window.location.pathname}#${route}?document=${encodeURIComponent(doc.id)}`);
  };

  const partners = useMemo(() => {
    const grouped = new Map();
    documents.forEach((doc) => {
      // 往来单位流水只呈现对外收货/发货，内部调拨不得被误判为发货。
      if (!BUSINESS_TYPES.has(doc.document_type)) return;
      const name = String(doc.partner_name || '').trim();
      if (!name || name === '内部' || ['内部作业', '自动导入'].includes(name)) return;
      if (!grouped.has(name)) {
        grouped.set(name, {
          name,
          documents: [],
          inboundQty: 0,
          outboundQty: 0,
          pendingCount: 0,
          latestDate: ''
        });
      }
      const item = grouped.get(name);
      item.documents.push(doc);
      const qty = quantityOf(doc);
      if (doc.status === 'posted') {
        if (INBOUND_TYPES.has(doc.document_type)) item.inboundQty += qty;
        if (OUTBOUND_TYPES.has(doc.document_type)) item.outboundQty += qty;
      } else if (isPending(doc.status)) {
        item.pendingCount += 1;
      }
      if (!item.latestDate || doc.business_date > item.latestDate) item.latestDate = doc.business_date;
    });

    const keyword = search.trim().toLowerCase();
    return [...grouped.values()]
      .filter((item) => item.name.toLowerCase().includes(keyword))
      .sort((a, b) => b.latestDate.localeCompare(a.latestDate));
  }, [documents, search]);

  const totals = useMemo(() => partners.reduce((result, item) => ({
    inbound: result.inbound + item.inboundQty,
    outbound: result.outbound + item.outboundQty,
    pending: result.pending + item.pendingCount
  }), { inbound: 0, outbound: 0, pending: 0 }), [partners]);

  const renderDirection = (doc) => INBOUND_TYPES.has(doc.document_type)
    ? <span className="inline-flex items-center gap-1 font-bold text-emerald-600"><PackageCheck size={14} />收货</span>
    : <span className="inline-flex items-center gap-1 font-bold text-blue-600"><Truck size={14} />发货</span>;

  return (
    <div className="space-y-6">
      <SectionHeading
        title="往来单位流水"
        subtitle="按公司分开查看收货、发货、审核状态与历史业务单据"
        badge={`${partners.length} 家单位`}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="card p-5"><p className="text-xs font-bold text-gray-400">已入账收货量</p><p className="mt-2 text-2xl font-black text-emerald-600">{totals.inbound.toLocaleString()}</p></div>
        <div className="card p-5"><p className="text-xs font-bold text-gray-400">已入账发货量</p><p className="mt-2 text-2xl font-black text-blue-600">{totals.outbound.toLocaleString()}</p></div>
        <div className="card p-5"><p className="text-xs font-bold text-gray-400">待处理单据</p><p className="mt-2 text-2xl font-black text-amber-600">{totals.pending.toLocaleString()}</p></div>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b bg-gray-50/60 p-4">
          <div className="relative max-w-md">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="input-field pl-10" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索公司名称…" />
          </div>
        </div>

        {error && (
          <div className="m-4 flex items-center justify-between gap-3 rounded-xl border border-red-100 bg-red-50 p-4 text-red-600">
            <span className="flex items-center gap-2 text-sm font-bold"><AlertCircle size={18} />{error}</span>
            <button onClick={load} className="btn-secondary bg-white text-xs">重试</button>
          </div>
        )}

        {loading ? (
          <div className="p-20 text-center text-gray-400">
            <Loader2 className="mx-auto animate-spin text-blue-500" />
            <p className="mt-3 text-xs">正在汇总往来单位…</p>
          </div>
        ) : partners.length === 0 ? (
          <div className="p-20 text-center text-gray-400">
            <Building2 size={36} className="mx-auto mb-3 opacity-30" />
            暂无符合条件的往来单位
          </div>
        ) : (
          <div className="divide-y">
            {partners.map((partner) => {
              const isOpen = expanded === partner.name;
              const direction = directionByPartner[partner.name] || 'all';
              const inboundDocuments = partner.documents.filter((doc) => INBOUND_TYPES.has(doc.document_type));
              const outboundDocuments = partner.documents.filter((doc) => OUTBOUND_TYPES.has(doc.document_type));
              const visibleDocuments = (
                direction === 'in' ? inboundDocuments : direction === 'out' ? outboundDocuments : partner.documents
              ).slice().sort((a, b) => {
                const dateOrder = String(b.business_date || '').localeCompare(String(a.business_date || ''));
                if (dateOrder !== 0) return dateOrder;
                return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
              });
              const tabs = [
                { key: 'all', label: '全部', docs: partner.documents, qty: partner.inboundQty + partner.outboundQty },
                { key: 'in', label: '收货', docs: inboundDocuments, qty: partner.inboundQty },
                { key: 'out', label: '发货', docs: outboundDocuments, qty: partner.outboundQty }
              ];
              const emptyDirection = direction === 'in' ? '收货' : direction === 'out' ? '发货' : '';

              return (
                <div key={partner.name}>
                  <button onClick={() => setExpanded(isOpen ? '' : partner.name)} className="flex w-full flex-col gap-4 p-4 text-left hover:bg-gray-50 sm:p-5 lg:flex-row lg:items-center">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><Building2 size={20} /></div>
                      <div className="min-w-0"><p className="truncate font-bold">{partner.name}</p><p className="mt-1 text-[10px] text-gray-400">最近往来：{partner.latestDate || '-'}</p></div>
                      <span className="ml-auto lg:hidden">{isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}</span>
                    </div>
                    <div className="grid w-full grid-cols-4 gap-2 text-center lg:w-[440px] lg:gap-4 lg:text-right">
                      <div><p className="text-[9px] text-gray-400">单据</p><p className="text-xs font-black">{partner.documents.length}</p></div>
                      <div><p className="text-[9px] text-gray-400">收货</p><p className="text-xs font-black text-emerald-600">{partner.inboundQty.toLocaleString()}</p></div>
                      <div><p className="text-[9px] text-gray-400">发货</p><p className="text-xs font-black text-blue-600">{partner.outboundQty.toLocaleString()}</p></div>
                      <div><p className="text-[9px] text-gray-400">待处理</p><p className="text-xs font-black text-amber-600">{partner.pendingCount}</p></div>
                    </div>
                    <span className="hidden lg:block">{isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}</span>
                  </button>

                  {isOpen && (
                    <div className="bg-slate-50 px-3 pb-5 sm:px-5">
                      <div className="mb-3 grid grid-cols-3 gap-2 rounded-xl border bg-white p-2">
                        {tabs.map((item) => (
                          <button
                            type="button"
                            key={item.key}
                            onClick={() => setDirectionByPartner((current) => ({ ...current, [partner.name]: item.key }))}
                            className={`rounded-lg px-1 py-2.5 text-center transition sm:px-2 ${
                              direction === item.key
                                ? item.key === 'in'
                                  ? 'bg-emerald-600 text-white shadow-sm'
                                  : item.key === 'out'
                                    ? 'bg-blue-600 text-white shadow-sm'
                                    : 'bg-slate-800 text-white shadow-sm'
                                : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                            }`}
                          >
                            <span className="block text-xs font-black">{item.label}</span>
                            <span className={`mt-1 block text-[9px] ${direction === item.key ? 'text-white/75' : 'text-slate-400'}`}>
                              {item.docs.length} 张单据<span className="hidden sm:inline"> · 已入账 {item.qty.toLocaleString()}</span>
                            </span>
                          </button>
                        ))}
                      </div>

                      <div className="space-y-2 sm:hidden">
                        {visibleDocuments.map((doc) => (
                          <button type="button" key={doc.id} onClick={() => openDocument(doc)} className="block w-full rounded-xl border bg-white p-4 text-left shadow-sm transition active:bg-blue-50">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0"><p className="break-all text-sm font-black text-slate-800">{doc.doc_no}</p><p className="mt-1 text-[10px] text-gray-400">{doc.business_date}</p></div>
                              <span className="shrink-0 rounded-full bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700">{STATUS_LABELS[doc.status] || doc.status}</span>
                            </div>
                            <div className="mt-3 flex items-center justify-between gap-3 text-xs"><span>{renderDirection(doc)}</span><span className="font-black text-slate-800">{quantityOf(doc).toLocaleString()}</span></div>
                            <p className="mt-3 line-clamp-2 text-xs leading-5 text-slate-600">
                              {(doc.inventory_document_lines || []).map((line) => `${line.sku} ${line.product_name || ''}${line.spec ? `（${line.spec}）` : ''}`).join('；') || '-'}
                            </p>
                            <p className="mt-3 text-right text-[10px] font-bold text-blue-600">{['draft', 'rejected'].includes(doc.status) ? '进入处理' : '查看单据'} ›</p>
                          </button>
                        ))}
                        {visibleDocuments.length === 0 && <p className="rounded-xl border bg-white py-10 text-center text-xs text-gray-400">该公司暂无{emptyDirection}单据</p>}
                      </div>

                      <div className="hidden overflow-x-auto rounded-xl border bg-white sm:block">
                        <table className="w-full text-xs">
                          <thead className="bg-gray-50 text-gray-500"><tr><th className="px-4 py-3 text-left">日期 / 单号</th><th className="px-4 py-3 text-left">方向</th><th className="px-4 py-3 text-left">产品明细</th><th className="px-4 py-3 text-right">数量</th><th className="px-4 py-3 text-left">状态</th><th className="px-4 py-3 text-right">操作</th></tr></thead>
                          <tbody className="divide-y">
                            {visibleDocuments.map((doc) => (
                              <tr key={doc.id} onClick={() => openDocument(doc)} className="cursor-pointer transition hover:bg-blue-50/60">
                                <td className="px-4 py-3"><p className="font-bold">{doc.business_date}</p><p className="text-[10px] text-gray-400">{doc.doc_no}</p></td>
                                <td className="px-4 py-3">{renderDirection(doc)}</td>
                                <td className="max-w-sm px-4 py-3">{(doc.inventory_document_lines || []).map((line) => `${line.sku} ${line.product_name || ''}${line.spec ? `（${line.spec}）` : ''}`).join('；') || '-'}</td>
                                <td className="px-4 py-3 text-right font-black">{quantityOf(doc).toLocaleString()}</td>
                                <td className="px-4 py-3"><span className="rounded-full bg-blue-50 px-2 py-1 font-bold text-blue-700">{STATUS_LABELS[doc.status] || doc.status}</span></td>
                                <td className="px-4 py-3 text-right"><button type="button" onClick={(event) => { event.stopPropagation(); openDocument(doc); }} className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-white px-3 py-2 font-bold text-blue-600 hover:bg-blue-600 hover:text-white">{['draft', 'rejected'].includes(doc.status) ? '进入处理' : '查看单据'}<ChevronRight size={14} /></button></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {visibleDocuments.length === 0 && <p className="py-10 text-center text-xs text-gray-400">该公司暂无{emptyDirection}单据</p>}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default PartnerLedgerPage;
