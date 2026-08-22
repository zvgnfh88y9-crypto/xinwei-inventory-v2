// v3.0.6-MOBILE-DETAIL-IMAGE
import React, { useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import { ClipboardList, Factory, PackageCheck, Truck, Plus, Send, CheckCircle, XCircle, X, BookOpen, RefreshCw, FileUp, Eye, Pencil, Trash2, Loader2, Camera, Info, Bell, Search, Filter, ChevronRight, ChevronLeft, CalendarDays, AlertTriangle, ListTodo, Check, Download } from 'lucide-react';
import * as XLSX from 'xlsx';
import Tesseract from 'tesseract.js';
import { useLocation, useNavigate } from 'react-router-dom';
import SectionHeading from '../components/common/SectionHeading';
import DocumentArchivePanel from '../components/workflow/DocumentArchivePanel';
import { approveDraftWorkflowDocument, captureWorkflowDocument, createWorkflowDocument, deleteBulkWorkflowDocuments, deleteWorkflowDocument, finalReviewWorkflowDocument, getDailyWorkflowSummary, listWorkflowApprovalTimeline, listWorkflowDocuments, listWorkflowMovements, markWorkflowNotificationsReadByDocument, postWorkflowDocument, reopenWorkflowDocument, reviewWorkflowDocument, reviseRejectedWorkflowDocument, submitWorkflowDocument, updateWorkflowDocument, voidWorkflowDocument } from '../lib/workflowApi';
import { listInventory, uploadWorkflowDocumentImage, getSignedUrl, getSignedUrls } from '../lib/inventoryApi';
import { listPartners } from '../lib/wmsV2Api';

const TYPES = {
  receipt: { label: '收货单', icon: PackageCheck, tone: 'blue', direction: '入库', group: 'in' },
  production_in: { label: '生产入库单', icon: Factory, tone: 'emerald', direction: '入库', group: 'in' },
  shipment: { label: '出货单', icon: Truck, tone: 'amber', direction: '出库', group: 'out' },
  transfer_to_retail: { label: '调拨入零售仓', icon: RefreshCw, tone: 'indigo', direction: '内调', group: 'internal' },
  retail_sale: { label: '零售出库单', icon: Bell, tone: 'rose', direction: '零售', group: 'out' },
  stock_count: { label: '库存盘点单', icon: ClipboardList, tone: 'purple', direction: '盘点', group: 'count' }
};

const STATUSES = { draft: '草稿', pending: '待仓管审核', warehouse_approved: '待管理员终审', approved: '终审通过·待执行', posted: '已完成', rejected: '已驳回·待修改', cancelled: '已取消', voided: '已作废' };
const APPROVAL_ACTIONS = {
  created: { label: '创建草稿', tone: 'bg-slate-500' },
  submitted: { label: '提交仓管复核', tone: 'bg-blue-600' },
  warehouse_approved: { label: '仓管复核通过', tone: 'bg-indigo-600' },
  warehouse_rejected: { label: '仓管复核驳回', tone: 'bg-red-500' },
  final_approved: { label: '管理员终审通过', tone: 'bg-emerald-600' },
  final_rejected: { label: '管理员终审驳回', tone: 'bg-red-600' },
  returned_to_draft: { label: '管理员退回草稿', tone: 'bg-amber-500' },
  revision_started: { label: '申请人开始修改', tone: 'bg-amber-500' },
  posted: { label: '已执行并同步库存', tone: 'bg-emerald-700' },
  voided: { label: '红冲作废', tone: 'bg-rose-700' },
  cancelled: { label: '取消单据', tone: 'bg-gray-500' }
};
const PRODUCT_FILTERS = [
  { key: 'all', label: '全部', terms: [] },
  { key: 'hook', label: '勾面', terms: ['勾面', '钩面', '刺面', '硬面'] },
  { key: 'loop', label: '毛面', terms: ['毛面', '绒面', '软面'] },
  { key: 'adhesive', label: '背胶', terms: ['背胶', '自粘', '胶面'] },
  { key: 'tie', label: '扎带', terms: ['扎带', '束带', '捆绑带'] },
  { key: 'elastic', label: '松紧带', terms: ['松紧带', '橡筋', '弹力带'] },
  { key: 'webbing', label: '织带', terms: ['织带', '尼龙带'] },
  { key: 'other', label: '其他', terms: [] }
];
const today = () => new Date().toISOString().slice(0, 10);
const formatEntryTime = (value) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';
const EMPTY_MANUAL_LINE = () => ({ sku: '', product_name: '', spec: '', quantity: '', unit: '条', batch_no: '', warehouse: '', unit_price: '' });
const INITIAL_MANUAL_ROWS = 3;
const INITIAL_MANUAL_LINES = () => Array.from({ length: INITIAL_MANUAL_ROWS }, EMPTY_MANUAL_LINE);
const isManualLineEmpty = (item) => !['sku', 'product_name', 'spec', 'quantity'].some((field) => String(item?.[field] ?? '').trim());

const thumbnailUrlCache = new Map();
const getThumbnailUrl = (path) => {
  if (!thumbnailUrlCache.has(path)) {
    thumbnailUrlCache.set(path, getSignedUrl(path, { thumbnail: true }).catch((error) => {
      thumbnailUrlCache.delete(path);
      throw error;
    }));
  }
  return thumbnailUrlCache.get(path);
};

const ThumbImage = ({ path, eager = false }) => {
  const [url, setUrl] = useState('');
  const [visible, setVisible] = useState(eager);
  const holderRef = useRef(null);
  useEffect(() => {
    if (eager || !holderRef.current || !('IntersectionObserver' in window)) { setVisible(true); return; }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '240px 0px' });
    observer.observe(holderRef.current);
    return () => observer.disconnect();
  }, [eager, path]);
  useEffect(() => {
    if (!path || !visible) return;
    if (path.startsWith('http')) { setUrl(path); return; }
    let active = true;
    getThumbnailUrl(path).then((value) => active && setUrl(value)).catch(() => active && setUrl(''));
    return () => { active = false; };
  }, [path, visible]);
  return <div ref={holderRef} className="w-full h-full flex items-center justify-center bg-gray-50">
    {!url && visible && <Loader2 size={14} className="animate-spin text-gray-300" />}
    {url && <img src={url} loading="lazy" decoding="async" className="w-full h-full object-cover" alt="凭证缩略图" />}
  </div>;
};

const WorkflowPage = ({ user, mode = 'all' }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const loadRequestRef = useRef(0);
  const openedFromLedgerRef = useRef('');

  useEffect(() => {
    if (mode !== 'approval' || !new URLSearchParams(location.search).has('archive')) return;
    const timer = window.setTimeout(() => document.getElementById('document-archive')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 250);
    return () => window.clearTimeout(timer);
  }, [location.search, mode]);
  const [documents, setDocuments] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [partners, setPartners] = useState([]);
  const [summary, setSummary] = useState({ inbound_quantity: 0, outbound_quantity: 0, line_count: 0 });
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(today().slice(0, 7));
  const [selectedType, setSelectedType] = useState('receipt');
  const [businessDate, setBusinessDate] = useState(today());
  const [partnerName, setPartnerName] = useState('');
  const [orderNo, setOrderNo] = useState('');
  const [inboundPerson, setInboundPerson] = useState('');
  const [defaultWarehouse, setDefaultWarehouse] = useState('默认仓库');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState(INITIAL_MANUAL_LINES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [captureFile, setCaptureFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [manualImagePath, setManualImagePath] = useState('');
  const [captureProgress, setCaptureProgress] = useState(0);
  const [error, setError] = useState('');
  const [viewingDoc, setViewingDoc] = useState(null);
  const [docMovements, setDocMovements] = useState([]);
  const [approvalTimeline, setApprovalTimeline] = useState([]);
  const [approvalTimelineLoading, setApprovalTimelineLoading] = useState(false);
  const [selectedDocIds, setSelectedDocIds] = useState([]);
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [viewingImage, setViewingImage] = useState(null);
  const [detailImageUrl, setDetailImageUrl] = useState('');
  const [detailImageLoading, setDetailImageLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [showStockAudit, setShowStockAudit] = useState(false);
  const [productFilter, setProductFilter] = useState('all');
  const [documentPage, setDocumentPage] = useState(1);
  const DOCUMENT_PAGE_SIZE = 8;
  const isAdmin = user.role === 'admin';
  const isWarehouseKeeper = ['warehouse_keeper', 'inv_manager'].includes(user.role);

  // 根据模式自动选择默认单据类型
  useEffect(() => {
    if (mode === 'in') setSelectedType('receipt');
    if (mode === 'out') setSelectedType('shipment');
    if (mode === 'internal') setSelectedType('transfer_to_retail');
    if (mode === 'count') setSelectedType('stock_count');
  }, [mode]);

  const loadData = async () => {
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    setError('');
    try {
      // 这里的逻辑改为：不管业务日期如何，加载所有单据，然后再在前端进行过滤汇总
      // 这样可以保证“一目了然”看到历史和当前
      const serverDirection = ['in', 'out', 'internal'].includes(mode) ? mode : '';
      const [docsData, invData, partnersData] = await Promise.all([
        listWorkflowDocuments(serverDirection), 
        listInventory(),
        listPartners()
      ]);
      if (requestId !== loadRequestRef.current) return;
      
      let allDocs = docsData.documents || docsData || [];
      
      // 模式过滤逻辑
      if (mode === 'in') {
        allDocs = allDocs.filter(d => TYPES[d.document_type]?.group === 'in');
      } else if (mode === 'out') {
        allDocs = allDocs.filter(d => TYPES[d.document_type]?.group === 'out');
      } else if (mode === 'internal') {
        allDocs = allDocs.filter(d => allDocs && TYPES[d.document_type]?.group === 'internal');
      } else if (mode === 'approval') {
        allDocs = allDocs.filter(d => isAdmin
          ? ['warehouse_approved', 'approved'].includes(d.status)
          : isWarehouseKeeper
            ? d.status === 'pending' && d.submitted_by !== user.id
            : d.created_by === user.id);
      }

      // 业务列表以原单日期为主排序；同一业务日期内按录入系统时间倒序。
      allDocs = [...allDocs].sort((a, b) => {
        const dateOrder = String(b.business_date || '').localeCompare(String(a.business_date || ''));
        if (dateOrder !== 0) return dateOrder;
        return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
      });

      setDocuments(allDocs);
      setInventory(invData.products || invData || []);
      setPartners(partnersData.partners || partnersData || []);

      // 一次请求取得当前列表所有缩略图地址，避免手机逐张调用 Edge Function。
      const thumbnailPaths = [...new Set(allDocs.map((doc) => doc.image_path).filter((path) => path && !path.startsWith('http') && !thumbnailUrlCache.has(path)))];
      if (thumbnailPaths.length) {
        const batchUrls = getSignedUrls(thumbnailPaths, { thumbnail: true });
        thumbnailPaths.forEach((path) => thumbnailUrlCache.set(path, batchUrls.then((urls) => {
          if (!urls[path]) throw new Error('缩略图地址生成失败');
          return urls[path];
        }).catch((thumbnailError) => {
          thumbnailUrlCache.delete(path);
          throw thumbnailError;
        })));
      }
      
      // 更新当日汇总数据（针对选定的 businessDate）
      const q = await getDailyWorkflowSummary(businessDate);
      setSummary(q || { inbound_quantity: 0, outbound_quantity: 0, line_count: 0 });
    } catch (loadError) {
      if (requestId !== loadRequestRef.current) return;
      console.error('Workflow load error:', loadError);
      setError(loadError.message || '流程数据加载失败'); 
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [businessDate, mode]);

  const handleGridKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const cells = [...(e.currentTarget.form?.querySelectorAll('[data-manual-cell]') || [])];
      cells[cells.indexOf(e.currentTarget) + 1]?.focus();
    }
  };

  const handleManualImageSelect = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const uploaded = await uploadWorkflowDocumentImage(file);
      setManualImagePath(uploaded.path);
      const reader = new FileReader();
      reader.onloadend = () => setImagePreview(reader.result);
      reader.readAsDataURL(file);
      setError('');
    } catch (e) {
      setError('图片上传失败：' + e.message);
    }
  };

  const updateViewingLine = (index, field, value) => {
    setViewingDoc((current) => ({
      ...current,
      inventory_document_lines: (current.inventory_document_lines || []).map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item
      )
    }));
  };

  const updateManualLine = (index, field, value) => {
    setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item));
  };

  const duplicateManualLine = (index) => {
    setLines((current) => {
      const source = current[index];
      return [...current.slice(0, index + 1), { ...source }, ...current.slice(index + 1)];
    });
  };

  const appendManualLines = (count = 1) => {
    setLines((current) => [...current, ...Array.from({ length: count }, () => ({ ...EMPTY_MANUAL_LINE(), warehouse: defaultWarehouse }))]);
  };

  const fillManualLineFromProduct = (index, value, source = 'sku') => {
    const product = inventory.find((candidate) => source === 'sku'
      ? (candidate.sku || candidate.id) === value
      : candidate.name === value);
    setLines((current) => current.map((row, rowIndex) => rowIndex === index ? {
      ...row,
      [source === 'sku' ? 'sku' : 'product_name']: value,
      ...(product ? {
        sku: product.sku || product.id || value,
        product_name: product.name || row.product_name,
        spec: product.spec || product.specification || row.spec,
        unit: product.unit || row.unit,
        warehouse: row.warehouse || defaultWarehouse
      } : {})
    } : row));
  };

  const saveViewingDraft = async () => {
    const draftLines = viewingDoc.inventory_document_lines || [];
    if (!draftLines.length) { setError('草稿至少需要一条明细'); return; }
    if (draftLines.some((item) => !item.sku?.trim() || Number(item.quantity) <= 0)) {
      setError('请填写有效的产品 SKU 和业务数量');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await updateWorkflowDocument(viewingDoc.id, viewingDoc, draftLines);
      setViewingDoc(null);
      await loadData();
    } catch (saveError) {
      setError(saveError.message || '草稿保存失败');
    } finally {
      setSaving(false);
    }
  };

  const persistNewDocument = async (nextAction = 'draft') => {
    const enteredLines = lines.filter((item) => !isManualLineEmpty(item));
    if (!enteredLines.length) { setError('至少填写一条商品明细'); return; }
    const incompleteIndex = enteredLines.findIndex((item) => !item.sku?.trim() || !item.product_name?.trim() || Number(item.quantity) <= 0 || !item.unit?.trim());
    if (incompleteIndex >= 0) { setError(`第 ${incompleteIndex + 1} 条商品资料不完整，请填写 SKU、名称、数量和单位`); return; }
    const normalizedLines = enteredLines.map((item) => ({ ...item, warehouse: item.warehouse || defaultWarehouse, quantity: Number(item.quantity), unit_price: Number(item.unit_price || 0) }));
    setSaving(true); setError('');
    try {
      const created = await createWorkflowDocument({ document_type: selectedType, business_date: businessDate, partner_name: partnerName, order_no: orderNo, inbound_person: inboundPerson, notes, image_path: manualImagePath }, normalizedLines);
      if (nextAction === 'submit' && created?.document?.id) await submitWorkflowDocument(created.document.id);
      if (nextAction === 'admin_approve' && created?.document?.id) await approveDraftWorkflowDocument(created.document.id);
      setLines(INITIAL_MANUAL_LINES()); setPartnerName(''); setOrderNo(''); setInboundPerson(''); setNotes(''); setManualImagePath(''); setImagePreview(null); await loadData();
    } catch (saveError) { setError(saveError.message || '单据创建失败'); }
    finally { setSaving(false); }
  };

  const createDraft = async (event) => {
    event.preventDefault();
    await persistNewDocument(false);
  };

  const runAction = async (action, id, payload = null) => {
    setSaving(true); setError('');
    try {
      if (action === 'submit') {
        if (payload) await updateWorkflowDocument(id, payload.document, payload.lines);
        await submitWorkflowDocument(id);
      }
      if (action === 'approve_draft') {
        if (payload) await updateWorkflowDocument(id, payload.document, payload.lines);
        await approveDraftWorkflowDocument(id);
      }
      if (action === 'approve') await reviewWorkflowDocument(id, true);
      if (action === 'reject') {
        const reason = window.prompt('请输入仓管复核驳回原因（员工将据此修改）：', '');
        if (!reason?.trim()) { setSaving(false); return; }
        await reviewWorkflowDocument(id, false, reason.trim());
      }
      if (action === 'final_approve') await finalReviewWorkflowDocument(id, true);
      if (action === 'final_reject') {
        const reason = window.prompt('请输入管理员终审驳回原因（员工将据此修改）：', '');
        if (!reason?.trim()) { setSaving(false); return; }
        await finalReviewWorkflowDocument(id, false, reason.trim());
      }
      if (action === 'reopen') {
        const reason = window.prompt('请输入退回草稿的具体原因（申请人将据此修改）：', '');
        if (!reason?.trim()) { setSaving(false); return; }
        await reopenWorkflowDocument(id, reason.trim());
      }
      if (action === 'revise_rejected') await reviseRejectedWorkflowDocument(id, viewingDoc?.rejection_reason || '');
      if (action === 'post') await postWorkflowDocument(id);
      if (action === 'void') {
        const reason = window.prompt('请输入作废原因：', '单据录入错误，申请红冲');
        if (reason) await voidWorkflowDocument(id, reason);
        else { setSaving(false); return; }
      }
      if (action === 'delete') {
        const confirmed = window.confirm('确定要永久删除这张草稿单吗？已入账单据请使用作废。');
        if (confirmed) await deleteWorkflowDocument(id);
        else { setSaving(false); return; }
      }
      if (action === 'delete_bulk') {
        await deleteBulkWorkflowDocuments(id);
        setSelectedDocIds([]);
        setShowBulkConfirm(false);
      }
      await loadData();
      if (viewingDoc && viewingDoc.id === id) setViewingDoc(null);
    } catch (actionError) { setError(actionError.message || '操作失败'); }
    finally { setSaving(false); }
  };

  const handleFileSelect = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(''); setCaptureFile(file);
    const isImage = ['png', 'jpg', 'jpeg', 'webp'].includes(file.name.split('.').pop()?.toLowerCase() || '');
    if (isImage) {
      const reader = new FileReader();
      reader.onloadend = () => setImagePreview(reader.result);
      reader.readAsDataURL(file);
    } else {
      setImagePreview(null);
      requestAnimationFrame(() => startCapture(file));
    }
  };

  const startCapture = async (targetFile = captureFile) => {
    if (!targetFile) return;
    const file = targetFile;
    setSaving(true); setError(''); setCaptureProgress(0);
    try {
      const extension = file.name.split('.').pop()?.toLowerCase() || '';
      if (!['xlsx', 'xls', 'csv', 'pdf', 'png', 'jpg', 'jpeg', 'webp'].includes(extension)) throw new Error('支持 Excel、CSV、PDF 和图片文件');
      
      let detectedLines = [];
      let imagePath = '';
      const isImage = ['png', 'jpg', 'jpeg', 'webp'].includes(extension);

      if (isImage) {
        // 先上传图片到云端存储
        try {
          const uploaded = await uploadWorkflowDocumentImage(file);
          imagePath = uploaded.path;
        } catch (e) {
          console.error('图片上传失败，但不影响识别:', e);
        }

        const { data: { text } } = await Tesseract.recognize(file, 'chi_sim+eng', {
          workerPath: 'https://unpkg.com/tesseract.js@v5.1.1/dist/worker.min.js',
          corePath: 'https://unpkg.com/tesseract.js-core@v5.1.0/tesseract-core-simd.wasm.js',
          logger: m => { if (m.status === 'recognizing text') setCaptureProgress(Math.round(m.progress * 100)); }
        });
        const ocrLines = text.split('\n').filter(l => l.trim().length > 2);
        detectedLines = ocrLines.map(l => {
          const skuMatch = l.match(/(XW|HEAD|SKU|SHIP|P10|P20)[-_ ]?\d+/i);
          const nums = l.match(/\b\d{2,}\b/g);
          if (skuMatch || (nums && nums.length > 0)) {
            const sku = skuMatch ? skuMatch[0].replace(/\s+/g, '-').toUpperCase() : '';
            const quantity = nums ? Number(nums[nums.length - 1]) : 1;
            return {
              sku: sku || '待补充',
              product_name: l.replace(/(XW|HEAD|SKU|SHIP|P10|P20)[-_ ]?\d+/gi, '').replace(/\d+/g, '').replace(/[|｜]/g, '').trim() || '智能提取中...',
              quantity: quantity, unit: '条', batch_no: '', warehouse: '', unit_price: 0
            };
          }
          return null;
        }).filter(Boolean);
        if (detectedLines.length === 0) detectedLines = [{ sku: '手动填写', product_name: '识别不清晰，请手动输入', quantity: 0, unit: '条', batch_no: '', warehouse: '', unit_price: 0 }];
      } else {
        detectedLines = [{ sku: '', product_name: '', quantity: 1, unit: '条', batch_no: '', warehouse: '', unit_price: 0 }];
      }

      const result = await captureWorkflowDocument({ 
        document_type: selectedType, business_date: businessDate, source_file_name: file.name, source_file_type: extension, 
        image_path: imagePath,
        notes: isImage ? `AI 智能扫描完成` : '文件已接收' 
      }, detectedLines);
      
      setLines([]); setImagePreview(null); setCaptureFile(null);
      await loadData();
      if (result.document) setViewingDoc(result.document);
    } catch (captureError) { 
      setError('单据识别失败：' + (captureError.message || '请尝试手动录入')); 
    } finally { 
      setSaving(false); setCaptureProgress(0);
    }
  };

  const handleShowImage = async (path) => {
    if (!path) return;
    if (path.startsWith('http')) {
      setViewingImage(path);
      return;
    }
    setLoading(true);
    try {
      const url = await getSignedUrl(path);
      setViewingImage(url);
    } catch (e) {
      setError('无法加载单据照片：' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const openDoc = async (doc) => {
    setViewingDoc(doc);
    setDetailImageUrl('');
    setDocMovements([]);
    setApprovalTimeline([]);
    setShowStockAudit(false);
    setApprovalTimelineLoading(true);
    
    // 自动标记该单据关联的通知为已读
    markWorkflowNotificationsReadByDocument(doc.id).catch(() => {});

    listWorkflowApprovalTimeline(doc.id)
      .then((events) => setApprovalTimeline(events || []))
      .catch((timelineError) => console.error('审批轨迹加载失败', timelineError))
      .finally(() => setApprovalTimelineLoading(false));
    if (doc.image_path) {
      setDetailImageLoading(true);
      try {
        const imageUrl = doc.image_path.startsWith('http') ? doc.image_path : await getSignedUrl(doc.image_path);
        setDetailImageUrl(imageUrl);
      } catch (e) {
        setError('原始单据照片加载失败：' + e.message);
      } finally {
        setDetailImageLoading(false);
      }
    }
    if (doc.status === 'posted' || doc.status === 'voided') {
      try {
        const movements = await listWorkflowMovements(doc.id);
        setDocMovements(movements || []);
      } catch (e) { console.error('加载流水失败', e); }
    }
  };

  useEffect(() => {
    const targetId = new URLSearchParams(location.search).get('document') || '';
    if (!targetId || loading || openedFromLedgerRef.current === targetId) return;
    const target = documents.find(doc => doc.id === targetId);
    if (!target) return;
    openedFromLedgerRef.current = targetId;
    setBusinessDate(target.business_date || businessDate);
    openDoc(target);
  }, [documents, loading, location.search]);

  const checkCurrentStock = async () => {
    setSaving(true);
    setError('');
    try {
      const latest = await listInventory();
      setInventory(latest.products || latest || []);
      setShowStockAudit(true);
    } catch (checkError) {
      setError(checkError.message || '当前库存查询失败');
    } finally {
      setSaving(false);
    }
  };

  const openInventoryForSku = (sku) => {
    setViewingDoc(null);
    navigate(`/inventory?search=${encodeURIComponent(sku)}`);
  };

  const downloadSelectedImages = async () => {
    const targets = documents.filter(d => selectedDocIds.includes(d.id) && d.image_path);
    if (!targets.length) { alert('所选单据中没有可下载的照片'); return; }
    setDownloading(true);
    try {
      const paths = targets.map(t => t.image_path);
      const urls = await getSignedUrls(paths);
      const zip = new JSZip();
      for (let i = 0; i < targets.length; i++) {
        const doc = targets[i];
        const url = urls[doc.image_path];
        if (!url) continue;
        const response = await fetch(url);
        if (!response.ok) continue;
        const blob = await response.blob();
        const ext = doc.image_path.split('.').pop() || 'jpg';
        const safePartner = (doc.partner_name || '内部').replace(/[\\/:*?"<>|]/g, '_');
        const filename = `${doc.business_date}-${safePartner}-${doc.doc_no}.${ext}`;
        zip.file(filename, blob);
      }
      const content = await zip.generateAsync({ type: 'blob' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(content);
      link.download = `业务单据照片-${today()}.zip`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (e) {
      alert('批量打包失败：' + e.message);
    } finally {
      setDownloading(false);
    }
  };

  const deletableDocIds = useMemo(() => 
    isAdmin ? documents.map(d => d.id) : documents.filter(d => !['posted', 'approved', 'voided'].includes(d.status)).map(d => d.id),
  [documents, isAdmin]);

  const toggleDocSelection = (id) => setSelectedDocIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  const toggleAllDeletable = () => setSelectedDocIds(prev => prev.length === deletableDocIds.length && deletableDocIds.length > 0 ? [] : deletableDocIds);

  const getPageTitle = () => {
    if (mode === 'in') return '入库管理';
    if (mode === 'out') return '出库管理';
    if (mode === 'internal') return '调拨/仓内作业';
    if (mode === 'approval') return '审批中心';
    return '业务流程中心';
  };

  const getPostingLabel = (doc) => {
    const group = TYPES[doc?.document_type]?.group;
    if (group === 'out') return '确认出库并扣减库存';
    if (group === 'in') return '确认入库并增加库存';
    if (group === 'internal') return '确认调拨';
    return '确认入账并同步库存';
  };

  const getStatusLabel = (doc) => {
    if (doc?.status !== 'posted') return STATUSES[doc?.status] || doc?.status;
    return TYPES[doc?.document_type]?.group === 'out' ? '已出库' : '已入库';
  };

  const filteredTypes = Object.entries(TYPES).filter(([key, type]) => {
    if (mode === 'all') return true;
    return type.group === mode;
  });

  const getPageTheme = () => {
    if (mode === 'in') return 'from-blue-600 to-indigo-700';
    if (mode === 'out') return 'from-amber-500 to-orange-600';
    if (mode === 'internal') return 'from-indigo-500 to-purple-600';
    if (mode === 'count') return 'from-emerald-600 to-teal-700';
    if (mode === 'approval') return 'from-rose-500 to-pink-600';
    return 'from-gray-600 to-gray-700';
  };

  const dailyInboundSummary = useMemo(() => {
    const summaryMap = {};
    documents
      .filter(d => d.business_date === businessDate && d.status === 'posted' && TYPES[d.document_type]?.group === 'in')
      .forEach(d => {
        (d.inventory_document_lines || []).forEach(l => {
          if (!summaryMap[l.sku]) summaryMap[l.sku] = { sku: l.sku, name: l.product_name, qty: 0, unit: l.unit, images: [] };
          summaryMap[l.sku].qty += Number(l.quantity);
          if (d.image_path) summaryMap[l.sku].images.push(d.image_path);
        });
      });
    return Object.values(summaryMap);
  }, [documents, businessDate]);

  const dailyOutboundSummary = useMemo(() => {
    const summaryMap = {};
    documents
      .filter(d => d.business_date === businessDate && d.status === 'posted' && TYPES[d.document_type]?.group === 'out')
      .forEach(d => {
        (d.inventory_document_lines || []).forEach(l => {
          if (!summaryMap[l.sku]) summaryMap[l.sku] = { sku: l.sku, name: l.product_name, qty: 0, unit: l.unit, images: [] };
          summaryMap[l.sku].qty += Number(l.quantity);
          if (d.image_path) summaryMap[l.sku].images.push(d.image_path);
        });
      });
    return Object.values(summaryMap);
  }, [documents, businessDate]);

  const dailyDetails = useMemo(() => {
    return documents.filter(d => d.business_date === businessDate);
  }, [documents, businessDate]);

  const dailyRecordStats = useMemo(() => ({
    documents: dailyDetails.length,
    lines: dailyDetails.reduce((total, document) => total + (document.inventory_document_lines || []).length, 0)
  }), [dailyDetails]);

  const recordCountByDate = useMemo(() => documents.reduce((counts, document) => {
    const date = document.business_date;
    if (date) counts[date] = (counts[date] || 0) + 1;
    return counts;
  }, {}), [documents]);

  const documentMatchesProductFilter = (document, filterKey) => {
    if (filterKey === 'all') return true;
    const content = (document.inventory_document_lines || [])
      .map((item) => `${item.product_name || ''} ${item.spec || ''} ${item.sku || ''}`.toLowerCase())
      .join(' ');
    const knownTerms = PRODUCT_FILTERS.flatMap((item) => item.terms);
    if (filterKey === 'other') return !knownTerms.some((term) => content.includes(term));
    const filter = PRODUCT_FILTERS.find((item) => item.key === filterKey);
    return filter?.terms.some((term) => content.includes(term));
  };

  const filteredDocuments = useMemo(
    () => documents.filter((document) => documentMatchesProductFilter(document, productFilter)),
    [documents, productFilter]
  );

  const documentPageCount = Math.max(1, Math.ceil(filteredDocuments.length / DOCUMENT_PAGE_SIZE));
  const paginatedDocuments = useMemo(() => {
    const start = (documentPage - 1) * DOCUMENT_PAGE_SIZE;
    return filteredDocuments.slice(start, start + DOCUMENT_PAGE_SIZE);
  }, [filteredDocuments, documentPage]);

  useEffect(() => { setDocumentPage(1); }, [productFilter, mode]);
  useEffect(() => {
    if (documentPage > documentPageCount) setDocumentPage(documentPageCount);
  }, [documentPage, documentPageCount]);

  const productFilterCounts = useMemo(() => Object.fromEntries(PRODUCT_FILTERS.map((filter) => [
    filter.key,
    documents.filter((document) => documentMatchesProductFilter(document, filter.key)).length
  ])), [documents]);

  const calendarDays = useMemo(() => {
    const [year, month] = calendarMonth.split('-').map(Number);
    const firstWeekday = new Date(year, month - 1, 1).getDay();
    const daysInMonth = new Date(year, month, 0).getDate();
    return Array.from({ length: 42 }, (_, index) => {
      const day = index - firstWeekday + 1;
      if (day < 1 || day > daysInMonth) return null;
      const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      return { day, date, count: recordCountByDate[date] || 0 };
    });
  }, [calendarMonth, recordCountByDate]);

  const moveCalendarMonth = (offset) => {
    const [year, month] = calendarMonth.split('-').map(Number);
    const target = new Date(year, month - 1 + offset, 1);
    setCalendarMonth(`${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}`);
  };

  return (
    <div className="space-y-6" data-component="workflow-page">
      {/* 顶部视觉隔离条与全局日期筛选 */}
      <div className={`-mx-4 -mt-4 mb-5 bg-gradient-to-r p-4 text-white shadow-lg lg:-mx-8 lg:-mt-8 lg:mb-8 lg:p-6 ${getPageTheme()}`}>
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <h2 className="text-2xl font-black tracking-tight">{getPageTitle()}</h2>
            <p className="text-white/80 text-xs mt-1 font-medium">业务中心 · {TYPES[selectedType]?.direction || '流程'}作业 · 鑫威补丁版 v3.0.4</p>
          </div>
          
          <div className="grid w-full grid-cols-2 gap-2 md:flex md:w-auto md:flex-wrap md:items-center md:gap-4">
            <div className="relative">
              <button type="button" onClick={() => { setCalendarMonth(businessDate.slice(0, 7)); setCalendarOpen(open => !open); }} className="flex w-full items-center justify-between gap-2 rounded-xl border border-white/20 bg-white/10 px-3 py-2 backdrop-blur-md sm:px-4">
                <span className="text-[10px] font-black uppercase tracking-widest opacity-70">统计日期</span>
                <span className="text-sm font-bold">{businessDate.replaceAll('-', '/')}</span>
                <CalendarDays size={18} />
              </button>
              {calendarOpen && (
                <div className="absolute left-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2.75rem))] max-w-[calc(100vw-2.75rem)] overflow-hidden rounded-2xl border border-slate-200 bg-white p-3 text-slate-800 shadow-2xl sm:left-auto sm:right-0 sm:p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <button type="button" onClick={() => moveCalendarMonth(-1)} className="rounded-lg p-2 hover:bg-slate-100"><ChevronLeft size={18} /></button>
                    <p className="font-black">{calendarMonth.slice(0, 4)}年{Number(calendarMonth.slice(5))}月</p>
                    <button type="button" onClick={() => moveCalendarMonth(1)} className="rounded-lg p-2 hover:bg-slate-100"><ChevronRight size={18} /></button>
                  </div>
                  <div className="mb-1 grid grid-cols-7 text-center text-[10px] font-bold text-slate-400">{['日','一','二','三','四','五','六'].map(day => <span key={day}>{day}</span>)}</div>
                  <div className="grid grid-cols-7 gap-1">
                    {calendarDays.map((item, index) => item ? (
                      <button key={item.date} type="button" onClick={() => { setBusinessDate(item.date); setCalendarOpen(false); }} className={`relative h-11 rounded-lg text-sm font-bold transition ${item.date === businessDate ? 'bg-blue-600 text-white' : item.count ? 'bg-orange-50 text-slate-800 hover:bg-orange-100' : 'hover:bg-slate-100'}`}>
                        <span>{item.day}</span>
                        {item.count > 0 && <span className={`absolute right-0.5 top-0.5 min-w-4 rounded-full px-1 text-[9px] leading-4 ${item.date === businessDate ? 'bg-white text-blue-600' : 'bg-orange-500 text-white'}`}>{item.count}</span>}
                      </button>
                    ) : <span key={index} className="h-11" />)}
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t pt-3 text-xs">
                    <span className="text-slate-400">角标＝当天单据数量</span>
                    <button type="button" className="font-bold text-blue-600" onClick={() => { const current = today(); setBusinessDate(current); setCalendarMonth(current.slice(0, 7)); setCalendarOpen(false); }}>今天</button>
                  </div>
                </div>
              )}
            </div>
            <div className="min-w-0 rounded-xl border border-white/10 bg-white/20 px-3 py-2 backdrop-blur-md sm:min-w-40 sm:px-4">
              <p className="text-[10px] font-bold uppercase tracking-widest opacity-70">选定日记录</p>
              <div className="mt-1 flex items-end gap-4">
                <p className="text-lg font-black">{dailyRecordStats.documents} <span className="text-[10px] font-normal opacity-70">张单据</span></p>
                <p className="text-sm font-black">{dailyRecordStats.lines} <span className="text-[10px] font-normal opacity-70">条明细</span></p>
              </div>
              <p className="mt-1 text-[10px] opacity-75">已入账数量：{mode === 'out' ? summary.outbound_quantity : summary.inbound_quantity}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <SectionHeading title="业务工作台" subtitle={`${businessDate} 详情明细与审核中心`} badge={mode === 'approval' ? '待我审核' : '业务单据'} />
        <button type="button" onClick={loadData} className="btn-secondary flex shrink-0 items-center gap-1.5 px-3 py-2 text-xs sm:gap-2 sm:text-sm" disabled={loading}><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /><span className="hidden min-[380px]:inline">强制刷新</span><span className="min-[380px]:hidden">刷新</span></button>
      </div>

      {error && (
        <div className="card p-4 bg-red-50 border-red-100 flex items-center justify-between animate-shake">
          <div className="flex items-center gap-3 text-red-600">
            <AlertTriangle size={20} />
            <span className="text-sm font-medium">{error}</span>
          </div>
          <button onClick={() => setError('')} className="p-1 hover:bg-white rounded-lg text-red-400"><X size={20} /></button>
        </div>
      )}

      {mode === 'approval' && <DocumentArchivePanel user={user} />}

      {mode === 'in' && dailyInboundSummary.length > 0 && (
        <div className="card p-6 border-l-4 border-emerald-500 bg-emerald-50/30">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold flex items-center gap-2 text-emerald-800"><PackageCheck size={20} /> 当日入库实物汇总</h3>
            <span className="text-[10px] font-bold text-emerald-600 bg-white px-2 py-1 rounded border">仅统计“已入账”单据</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {dailyInboundSummary.map(item => (
              <div 
                key={item.sku} 
                onClick={() => item.images?.length > 0 && handleShowImage(item.images[0])}
                className={`bg-white p-3 rounded-lg border border-emerald-100 shadow-sm transition-all ${item.images?.length > 0 ? 'cursor-pointer hover:ring-2 ring-emerald-400 hover:shadow-md' : ''}`}
              >
                <div className="flex justify-between items-start">
                  <p className="text-[9px] font-bold text-gray-400 truncate uppercase">{item.sku}</p>
                  {item.images?.length > 0 && <Camera size={10} className="text-emerald-500" />}
                </div>
                <p className="text-xs font-bold text-gray-800 truncate mb-1">{item.name}</p>
                <p className="text-lg font-black text-emerald-600">+{item.qty.toLocaleString()} <span className="text-[10px] font-normal text-gray-400">{item.unit}</span></p>
                {item.images?.length > 0 && <p className="text-[8px] text-emerald-500 mt-1 font-bold">点击查看照片</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {mode === 'out' && dailyOutboundSummary.length > 0 && (
        <div className="card p-6 border-l-4 border-rose-500 bg-rose-50/30">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold flex items-center gap-2 text-rose-800"><Truck size={20} /> 当日出库实物汇总</h3>
            <span className="text-[10px] font-bold text-rose-600 bg-white px-2 py-1 rounded border">仅统计“已入账”单据</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {dailyOutboundSummary.map(item => (
              <div 
                key={item.sku} 
                onClick={() => item.images?.length > 0 && handleShowImage(item.images[0])}
                className={`bg-white p-3 rounded-lg border border-rose-100 shadow-sm transition-all ${item.images?.length > 0 ? 'cursor-pointer hover:ring-2 ring-rose-400 hover:shadow-md' : ''}`}
              >
                <div className="flex justify-between items-start">
                  <p className="text-[9px] font-bold text-gray-400 truncate uppercase">{item.sku}</p>
                  {item.images?.length > 0 && <Camera size={10} className="text-rose-500" />}
                </div>
                <p className="text-xs font-bold text-gray-800 truncate mb-1">{item.name}</p>
                <p className="text-lg font-black text-rose-600">-{item.qty.toLocaleString()} <span className="text-[10px] font-normal text-gray-400">{item.unit}</span></p>
                {item.images?.length > 0 && <p className="text-[8px] text-rose-500 mt-1 font-bold">点击查看照片</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 新增：当日业务详情流水表 (一目了然看每天来了什么货) */}
      <div className="card overflow-hidden">
        <div className="p-4 border-b flex items-center justify-between bg-gray-50/50">
          <h3 className="font-bold flex items-center gap-2 text-sm"><ListTodo size={18} className="text-blue-600" /> {businessDate} 业务流水明细</h3>
          <div className="flex items-center gap-2">
             <span className="px-2 py-0.5 rounded bg-blue-50 text-[10px] font-bold text-blue-600">共 {dailyDetails.length} 笔单据</span>
          </div>
        </div>
        <div className="divide-y sm:hidden">
          {dailyDetails.length === 0 ? <p className="py-10 text-center text-xs italic text-gray-400">该日期暂无入库/出库记录</p> : dailyDetails.map(d => (
            <button type="button" key={d.id} onClick={() => openDoc(d)} className="block w-full p-4 text-left transition active:bg-blue-50">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0"><p className="break-all text-sm font-black text-slate-800">{d.doc_no}</p><p className="mt-1 text-[10px] text-gray-400">录入 {formatEntryTime(d.created_at)}</p></div>
                <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-black ${d.status === 'posted' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{getStatusLabel(d)}</span>
              </div>
              <div className="mb-3 flex items-center gap-2 text-xs"><span className="rounded-md bg-blue-50 px-2 py-1 font-bold text-blue-700">{TYPES[d.document_type]?.label}</span><span className="truncate text-gray-500">{d.partner_name || '内部'}</span></div>
              <div className="space-y-2 rounded-lg bg-slate-50 p-3">
                {(d.inventory_document_lines || []).map((l, i) => <div key={i} className="flex items-start justify-between gap-3 text-xs"><div className="min-w-0"><p className="truncate font-bold text-slate-700">{l.product_name || l.sku}</p>{l.product_name && <p className="truncate text-[10px] text-gray-400">{l.sku}</p>}</div><span className="shrink-0 font-black text-blue-600">{Number(l.quantity || 0).toLocaleString()} {l.unit}</span></div>)}
              </div>
              <p className="mt-3 text-right text-[10px] font-bold text-blue-600">点击查看和处理 ›</p>
            </button>
          ))}
        </div>
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full text-xs text-left">
            <thead className="bg-gray-50 text-gray-500 border-b">
              <tr>
                <th className="px-4 py-3">单号/时间</th>
                <th className="px-4 py-3">类型</th>
                <th className="px-4 py-3">往来单位</th>
                <th className="px-4 py-3">详情内容</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {dailyDetails.length === 0 ? (
                <tr><td colSpan={6} className="py-12 text-center text-gray-400 italic">该日期暂无入库/出库记录</td></tr>
              ) : dailyDetails.map(d => (
                <tr key={d.id} className="hover:bg-gray-50 transition-colors group">
                  <td className="px-4 py-3">
                    <p className="font-bold text-gray-800">{d.doc_no}</p>
                    <p className="text-[9px] text-gray-400">{new Date(d.created_at).toLocaleTimeString()}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold bg-${TYPES[d.document_type]?.tone || 'blue'}-50 text-${TYPES[d.document_type]?.tone || 'blue'}-700 border border-${TYPES[d.document_type]?.tone || 'blue'}-100`}>
                      {TYPES[d.document_type]?.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-600">{d.partner_name || '内部'}</td>
                  <td className="px-4 py-3">
                    <div className="max-w-xs space-y-1">
                       {(d.inventory_document_lines || []).map((l, i) => (
                         <div key={i} className="flex justify-between gap-4">
                            <span className="truncate">{l.product_name}</span>
                            <span className="font-black text-blue-600">{l.quantity} {l.unit}</span>
                         </div>
                       ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${d.status === 'posted' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                      {getStatusLabel(d)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                       <button onClick={() => openDoc(d)} className="p-1.5 hover:bg-white rounded-lg border text-gray-400 hover:text-blue-600 transition-all"><Eye size={14} /></button>
                       {d.status === 'approved' && isAdmin && (
                         <button onClick={() => runAction('post', d.id)} className="btn-primary py-1 px-3 text-[10px] flex items-center gap-1"><PackageCheck size={12} /> 同步库存</button>
                       )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {mode !== 'approval' && (
          <div className="card p-4 sm:p-6">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2"><Plus size={20} className="text-blue-600" /><div><h3 className="font-bold">{mode === 'out' ? '新建出库单' : mode === 'internal' ? '新建调拨单' : '新建入库单'}</h3><p className="mt-0.5 text-[10px] text-slate-400">单据头 + 商品明细 + 审批流程</p></div></div>
              <span className="text-[10px] font-black text-amber-600 bg-amber-50 px-2 py-1 rounded">表格录入 / 拍照识别</span>
            </div>
            <form onSubmit={createDraft} className="space-y-5">
              {/* ... form content ... */}
              <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 sm:p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-blue-900">自动识别/拍照上传</p>
                    <p className="text-[10px] text-blue-700 mt-1">支持识别表格线，自动提取产品 SKU 与数量。</p>
                  </div>
                  {!imagePreview && (
                    <label className="btn-secondary py-1.5 px-3 text-xs cursor-pointer flex items-center gap-2">
                      <Camera size={14} /> 拍摄/选择文件
                      <input type="file" accept=".xlsx,.xls,.csv,.pdf,.png,.jpg,.jpeg,.webp" onChange={handleFileSelect} className="hidden" />
                    </label>
                  )}
                </div>

                {imagePreview && (
                  <div className="mt-4 space-y-3">
                    <img src={imagePreview} className="w-full h-auto max-h-64 object-contain rounded-lg border-2 border-blue-200" />
                    <button type="button" onClick={() => startCapture()} disabled={saving} className="w-full btn-primary py-2 flex items-center justify-center gap-2">
                      {saving ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                      确认识别此照片
                    </button>
                  </div>
                )}
                {captureProgress > 0 && (
                  <div className="mt-3">
                    <div className="w-full h-1 bg-blue-100 rounded-full overflow-hidden"><div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${captureProgress}%` }}></div></div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {filteredTypes.map(([key, type]) => { const Icon = type.icon; return <button key={key} type="button" onClick={() => setSelectedType(key)} className={`p-3 rounded-lg border text-left transition-all ${selectedType === key ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-100' : 'border-gray-200 hover:bg-gray-50'}`}><Icon size={19} className={selectedType === key ? 'text-blue-600' : 'text-gray-400'} /><span className="block text-sm font-bold mt-2">{type.label}</span></button>; })}
              </div>

              <div className="rounded-xl border bg-slate-50/70 p-3 sm:p-4">
                <p className="mb-3 text-xs font-black text-slate-500">单据信息</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <label className="block"><span className="text-[10px] font-bold text-gray-500 uppercase">业务日期</span><input type="date" className="input-field mt-1" value={businessDate} onChange={(e) => setBusinessDate(e.target.value)} /></label>
                <label className="block"><span className="text-[10px] font-bold text-gray-500 uppercase">往来单位</span><input list="partner-options" className="input-field mt-1" value={partnerName} onChange={(e) => setPartnerName(e.target.value)} placeholder="供方/客户" /></label>
                <label className="block"><span className="text-[10px] font-bold text-gray-500 uppercase">外部单号</span><input className="input-field mt-1" value={orderNo} onChange={(e) => setOrderNo(e.target.value)} placeholder="送货单号（选填）" /></label>
                <label className="block"><span className="text-[10px] font-bold text-gray-500 uppercase">经办人</span><input className="input-field mt-1" value={inboundPerson} onChange={(e) => setInboundPerson(e.target.value)} required /></label>
                <label className="block"><span className="text-[10px] font-bold text-gray-500 uppercase">仓库</span><input className="input-field mt-1" value={defaultWarehouse} onChange={(e) => setDefaultWarehouse(e.target.value)} placeholder="默认仓库" /></label>
                </div>
              </div>

              <div className="overflow-hidden rounded-xl border bg-white">
                <div className="flex items-center justify-between border-b bg-slate-50 px-3 py-2">
                  <div><p className="text-xs font-black text-slate-700">商品明细</p><p className="mt-0.5 text-[10px] text-slate-400">可连续填写多种商品，按 Enter 跳到下一格</p></div>
                  <div className="flex gap-2"><button type="button" onClick={() => appendManualLines(1)} className="rounded-lg border bg-white px-3 py-1.5 text-xs font-bold text-blue-600 hover:bg-blue-50">+ 1 行</button><button type="button" onClick={() => appendManualLines(5)} className="rounded-lg border bg-white px-3 py-1.5 text-xs font-bold text-blue-600 hover:bg-blue-50">+ 5 行</button></div>
                </div>
                <div className="hidden grid-cols-[36px_1.05fr_1.4fr_1.15fr_.65fr_.55fr_76px] gap-2 border-b bg-slate-50/70 px-3 py-2 text-[10px] font-black text-slate-500 lg:grid">
                  <span>序号</span><span>商品编码</span><span>商品名称</span><span>规格型号</span><span>数量</span><span>单位</span><span className="text-center">操作</span>
                </div>

                <div className="divide-y">
                  {lines.map((item, idx) => (
                    <div key={idx} className="relative grid grid-cols-2 gap-2 p-3 lg:grid-cols-[36px_1.05fr_1.4fr_1.15fr_.65fr_.55fr_76px] lg:items-center">
                      <span className="absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-blue-50 text-[10px] font-black text-blue-600 lg:static lg:h-auto lg:w-auto lg:bg-transparent lg:text-slate-400">{idx + 1}</span>
                      <input data-manual-cell list="sku-options" className="input-field col-span-2 pl-10 py-2 text-xs font-bold lg:col-span-1 lg:pl-3" placeholder="产品 SKU" value={item.sku} onKeyDown={handleGridKeyDown} onChange={(e) => fillManualLineFromProduct(idx, e.target.value, 'sku')} />
                      <input data-manual-cell list="name-options" className="input-field py-2 text-xs" placeholder="产品名称" value={item.product_name} onKeyDown={handleGridKeyDown} onChange={(e) => fillManualLineFromProduct(idx, e.target.value, 'name')} />
                      <input data-manual-cell className="input-field py-2 text-xs" placeholder="规格型号" value={item.spec || ''} onKeyDown={handleGridKeyDown} onChange={(e) => updateManualLine(idx, 'spec', e.target.value)} />
                      <input data-manual-cell className="input-field py-2 text-xs font-black text-blue-600" type="number" min="0.0001" step="any" placeholder="数量" value={item.quantity} onKeyDown={handleGridKeyDown} onChange={(e) => updateManualLine(idx, 'quantity', e.target.value)} />
                      <input data-manual-cell className="input-field py-2 text-xs" placeholder="单位" value={item.unit || ''} onKeyDown={handleGridKeyDown} onChange={(e) => updateManualLine(idx, 'unit', e.target.value)} />
                      <div className="col-span-2 flex justify-end gap-1 lg:col-span-1 lg:justify-center">
                        <button type="button" onClick={() => duplicateManualLine(idx)} className="rounded p-2 text-blue-500 hover:bg-blue-50" title="复制此行"><Plus size={15} /></button>
                        <button type="button" onClick={() => setLines((current) => current.length > 1 ? current.filter((_, lineIndex) => lineIndex !== idx) : INITIAL_MANUAL_LINES())} className="rounded p-2 text-slate-300 hover:bg-red-50 hover:text-red-500" title="删除此行"><Trash2 size={15} /></button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-col gap-1 border-t bg-amber-50 px-4 py-3 text-sm font-black sm:flex-row sm:items-center sm:justify-between"><span>小计 · {lines.filter((item) => !isManualLineEmpty(item)).length} 条已填写明细</span><span className="text-blue-700">数量合计：{lines.filter((item) => !isManualLineEmpty(item)).reduce((sum, item) => sum + Number(item.quantity || 0), 0).toLocaleString()}</span></div>

                {/* 手工录入单据也可关联凭证照片 */}
                <div className="m-3 mt-0 flex items-center justify-between rounded-lg border border-dashed border-gray-200 bg-slate-50 p-2">
                  <div className="flex items-center gap-2 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                    <Camera size={12} className={manualImagePath ? 'text-emerald-500' : 'text-gray-300'} />
                    {manualImagePath ? '已关联凭证照片' : '手动录入可附加凭证照片'}
                  </div>
                  <label className="text-[10px] font-black text-blue-600 cursor-pointer hover:underline flex items-center gap-1">
                    {manualImagePath ? '重新选择' : '选择照片'}
                    <input type="file" accept=".png,.jpg,.jpeg,.webp" onChange={handleManualImageSelect} className="hidden" />
                  </label>
                </div>
                <datalist id="sku-options">
                  {inventory.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </datalist>
                <datalist id="name-options">
                  {inventory.map(p => <option key={p.id} value={p.name}>{p.id}</option>)}
                </datalist>
                <datalist id="partner-options">
                  {partners.map(p => <option key={p.id} value={p.name}>{p.partner_type === 'customer' ? '客户' : '供方'}</option>)}
                </datalist>
              </div>

              <label className="block rounded-xl border bg-white p-3"><span className="mb-2 block text-xs font-black text-slate-500">备注信息</span><textarea className="input-field min-h-20 resize-y" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="填写来料说明、交接要求或异常情况" /></label>

              <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-2 border-t bg-white/95 px-4 py-3 shadow-[0_-8px_24px_rgba(15,23,42,.08)] backdrop-blur sm:-mx-6 sm:flex-row sm:justify-end sm:px-6">
                <button type="button" onClick={() => { setLines(INITIAL_MANUAL_LINES()); setPartnerName(''); setOrderNo(''); setInboundPerson(''); setNotes(''); setManualImagePath(''); setImagePreview(null); setError(''); }} className="btn-secondary px-5 py-3">清空重填</button>
                <button type="submit" disabled={saving || !lines.some((item) => !isManualLineEmpty(item))} className="btn-secondary flex items-center justify-center gap-2 px-6 py-3 disabled:opacity-50"><ClipboardList size={18} /> 保存草稿</button>
                <button type="button" onClick={() => persistNewDocument(isAdmin ? 'admin_approve' : 'submit')} disabled={saving || !lines.some((item) => !isManualLineEmpty(item))} className="btn-primary flex items-center justify-center gap-2 px-7 py-3 shadow-lg shadow-blue-100 disabled:opacity-50">{saving ? <Loader2 size={18} className="animate-spin" /> : isAdmin ? <CheckCircle size={18} /> : <Send size={18} />} {isAdmin ? '保存并直接审核通过' : '保存并提交仓管审核'}</button>
              </div>
            </form>
          </div>
        )}

        <div className="card p-4 sm:p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <h3 className="font-bold flex items-center gap-2"><BookOpen size={20} className="text-blue-600" /> 单据流水</h3>
              {isAdmin && documents.length > 0 && (
                <button 
                  type="button"
                  onClick={toggleAllDeletable}
                  className="text-[10px] font-black text-gray-400 hover:text-blue-600 transition-colors uppercase tracking-widest"
                >
                  {selectedDocIds.length > 0 && selectedDocIds.length === deletableDocIds.length ? '取消全选' : '全选可删'}
                </button>
              )}
            </div>
            {isAdmin && selectedDocIds.length > 0 && (
              <div className="flex items-center gap-2 animate-in fade-in slide-in-from-right-2">
                {!showBulkConfirm ? (
                  <>
                    <button 
                      type="button"
                      onClick={downloadSelectedImages}
                      disabled={downloading}
                      className="text-xs font-black text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-100 shadow-sm flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                      批量下载照片
                    </button>
                    <button 
                      type="button"
                      onClick={() => setShowBulkConfirm(true)} 
                      className="text-xs font-black text-red-600 bg-red-50 px-3 py-1.5 rounded-lg border border-red-100 shadow-sm"
                    >
                      批量删除 ({selectedDocIds.length})
                    </button>
                  </>
                ) : (
                  <div className="flex items-center gap-2 bg-red-600 text-white rounded-lg px-2 py-1 shadow-lg">
                    <span className="text-[10px] font-bold px-1">确认删除？</span>
                    <button onClick={() => runAction('delete_bulk', selectedDocIds)} disabled={saving} className="bg-white text-red-600 px-2 py-0.5 rounded text-[10px] font-black hover:bg-red-50">删除</button>
                    <button onClick={() => setShowBulkConfirm(false)} className="text-white/70 hover:text-white px-1"><X size={14} /></button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="mb-5 border-y bg-slate-50/70 px-1 py-3">
            <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-gray-400"><Filter size={13} />按产品类型筛选</div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {PRODUCT_FILTERS.map((filter) => <button key={filter.key} type="button" onClick={() => setProductFilter(filter.key)} className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition ${productFilter === filter.key ? 'border-blue-600 bg-blue-600 text-white shadow-sm' : 'border-gray-200 bg-white text-gray-600 hover:border-blue-300 hover:text-blue-600'}`}><span>{filter.label}</span><span className={`text-[9px] ${productFilter === filter.key ? 'text-blue-100' : 'text-gray-400'}`}>{productFilterCounts[filter.key] || 0}</span></button>)}
            </div>
          </div>

          <div className="space-y-3">
            {loading ? (
              <div className="py-20 text-center"><Loader2 className="animate-spin mx-auto text-blue-500" /></div>
            ) : filteredDocuments.length === 0 ? (
              <p className="py-20 text-center text-sm text-gray-400">当前分类暂无相关业务单据</p>
            ) : paginatedDocuments.map((doc) => (
              <div key={doc.id} className="relative group">
                {isAdmin && (doc.status === 'voided' || doc.status === 'draft') && (
                  <div 
                    className="absolute -left-2 -top-2 z-10"
                    onClick={(e) => { e.stopPropagation(); toggleDocSelection(doc.id); }}
                  >
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${selectedDocIds.includes(doc.id) ? 'bg-blue-600 border-blue-600 text-white shadow-lg' : 'bg-white border-gray-200 opacity-0 group-hover:opacity-100 hover:border-blue-400'}`}>
                      {selectedDocIds.includes(doc.id) && <Check size={12} strokeWidth={4} />}
                    </div>
                  </div>
                )}
                <div 
                  className={`p-4 border rounded-lg transition-all cursor-pointer ${selectedDocIds.includes(doc.id) ? 'border-blue-500 bg-blue-50/30 ring-2 ring-blue-100 shadow-sm' : 'hover:border-blue-200'}`} 
                  onClick={() => openDoc(doc)}
                >
                  <div className="flex items-start gap-3 mb-2">
                    {doc.image_path && (
                      <div 
                        className="w-16 h-16 rounded-lg border border-gray-100 bg-gray-50 overflow-hidden flex-shrink-0 relative group/thumb"
                        onClick={(e) => { e.stopPropagation(); handleShowImage(doc.image_path); }}
                      >
                        <ThumbImage path={doc.image_path} />
                        <div className="absolute inset-0 bg-black/0 group-hover/thumb:bg-black/30 transition-colors flex items-center justify-center">
                          <Camera size={16} className="text-white opacity-0 group-hover/thumb:opacity-100" />
                        </div>
                      </div>
                    )}
                    <div className="flex-grow min-w-0">
                      <p className="text-sm font-bold group-hover:text-blue-600">{TYPES[doc.document_type]?.label || doc.document_type}</p>
                      <p className="text-[10px] text-gray-400 mt-1">{doc.doc_no}</p>
                      <p className="mt-1 text-[10px] text-gray-500">单据日期：{doc.business_date}</p>
                      <p className="mt-0.5 text-[10px] text-gray-400">录入时间：{formatEntryTime(doc.created_at)}</p>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${doc.status === 'posted' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>{getStatusLabel(doc)}</span>
                  </div>
                  <div className="flex justify-between items-center mt-4">
                    <p className="text-xs text-gray-500 truncate max-w-40">{doc.partner_name || '内部作业'}</p>
                    <div className="flex items-center gap-2">
                       {isAdmin && (doc.status === 'voided' || doc.status === 'draft') && (
                         <button 
                           onClick={(e) => { e.stopPropagation(); runAction('delete', doc.id); }}
                           className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                           title="永久删除记录"
                         >
                           <Trash2 size={14} />
                         </button>
                       )}
                       <ChevronRight size={14} className="text-gray-300 group-hover:text-blue-400" />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {!loading && filteredDocuments.length > 0 && (
            <div className="mt-6 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-slate-500">
                共 <span className="font-black text-slate-800">{filteredDocuments.length}</span> 张单据，
                当前显示第 {(documentPage - 1) * DOCUMENT_PAGE_SIZE + 1}–{Math.min(documentPage * DOCUMENT_PAGE_SIZE, filteredDocuments.length)} 张
              </p>
              <div className="flex items-center justify-between gap-2 sm:justify-end">
                <button type="button" onClick={() => setDocumentPage((page) => Math.max(1, page - 1))} disabled={documentPage === 1} className="btn-secondary flex items-center gap-1 px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft size={15} />上一页</button>
                <div className="flex items-center gap-1">
                  {Array.from({ length: documentPageCount }, (_, index) => index + 1).filter((page) => page === 1 || page === documentPageCount || Math.abs(page - documentPage) <= 1).map((page, index, pages) => <React.Fragment key={page}>{index > 0 && page - pages[index - 1] > 1 && <span className="px-1 text-xs text-slate-400">…</span>}<button type="button" onClick={() => setDocumentPage(page)} className={`h-8 min-w-8 rounded-lg px-2 text-xs font-black ${documentPage === page ? 'bg-blue-600 text-white' : 'border bg-white text-slate-600 hover:border-blue-300'}`}>{page}</button></React.Fragment>)}
                </div>
                <button type="button" onClick={() => setDocumentPage((page) => Math.min(documentPageCount, page + 1))} disabled={documentPage === documentPageCount} className="btn-secondary flex items-center gap-1 px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-40">下一页<ChevronRight size={15} /></button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal logic */}
      {viewingDoc && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-start justify-center overflow-y-auto p-2 sm:p-4" onClick={() => setViewingDoc(null)}>
           <div className="my-2 w-full max-w-4xl rounded-2xl bg-white p-4 shadow-2xl sm:my-6 sm:p-6" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h3 className="text-lg font-bold">业务单据详情</h3>
                  <p className="text-xs text-gray-500">{viewingDoc.doc_no} · {TYPES[viewingDoc.document_type]?.label}</p>
                </div>
                <button onClick={() => setViewingDoc(null)} className="p-2 hover:bg-gray-100 rounded-full"><XCircle size={24} /></button>
              </div>

              {viewingDoc.image_path && (
                <section className="mb-6 overflow-hidden rounded-xl border-2 border-blue-100 bg-slate-50">
                  <div className="flex items-center justify-between border-b bg-blue-50 px-4 py-3">
                    <div className="flex items-center gap-2 text-sm font-bold text-slate-800"><Camera size={17} className="text-blue-600" />对账原始图片</div>
                    {detailImageUrl && <button type="button" onClick={() => setViewingImage(detailImageUrl)} className="flex items-center gap-1 text-xs font-bold text-blue-600"><Eye size={14} />放大查看</button>}
                  </div>
                  <div className="flex min-h-44 items-center justify-center p-2 sm:min-h-80">
                    {detailImageLoading && <div className="flex items-center gap-2 text-xs text-gray-400"><Loader2 size={16} className="animate-spin" />正在加载原图…</div>}
                    {!detailImageLoading && detailImageUrl && <img src={detailImageUrl} decoding="async" className="max-h-[36vh] w-full object-contain sm:max-h-[52vh]" alt="对账原始单据" />}
                    {!detailImageLoading && !detailImageUrl && <p className="text-xs text-red-500">原始图片暂时无法显示，请重新打开单据</p>}
                  </div>
                </section>
              )}
              
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-6">
                  {error && <div className="p-3 rounded-lg bg-red-50 border border-red-100 text-xs font-bold text-red-600">{error}</div>}
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 p-4 bg-gray-50 rounded-xl border">
                    <div><p className="text-[9px] font-bold text-gray-400 uppercase">业务日期</p>{viewingDoc.status === 'draft' ? <input type="date" className="input-field mt-1 py-1.5 text-xs" value={viewingDoc.business_date || ''} onChange={e => setViewingDoc({...viewingDoc, business_date: e.target.value})} /> : <p className="text-xs font-bold">{viewingDoc.business_date}</p>}</div>
                    <div><p className="text-[9px] font-bold text-gray-400 uppercase">录入系统时间</p><p className="text-xs font-bold">{formatEntryTime(viewingDoc.created_at)}</p></div>
                    <div><p className="text-[9px] font-bold text-gray-400 uppercase">经办人</p>{viewingDoc.status === 'draft' ? <input className="input-field mt-1 py-1.5 text-xs" value={viewingDoc.inbound_person || ''} onChange={e => setViewingDoc({...viewingDoc, inbound_person: e.target.value})} /> : <p className="text-xs font-bold">{viewingDoc.inbound_person}</p>}</div>
                    <div><p className="text-[9px] font-bold text-gray-400 uppercase">往来单位</p>{viewingDoc.status === 'draft' ? <input list="partner-options" className="input-field mt-1 py-1.5 text-xs" value={viewingDoc.partner_name || ''} onChange={e => setViewingDoc({...viewingDoc, partner_name: e.target.value})} /> : <p className="text-xs font-bold">{viewingDoc.partner_name || '内部'}</p>}</div>
                    <div><p className="text-[9px] font-bold text-gray-400 uppercase">状态</p><span className="text-[10px] font-bold px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">{getStatusLabel(viewingDoc)}</span></div>
                  </div>

                  {viewingDoc.original_doc_id && (
                    <div className="p-3 bg-amber-50 border border-amber-100 rounded-lg flex items-center gap-3">
                      <RefreshCw size={16} className="text-amber-600" />
                      <p className="text-xs text-amber-800 font-medium">这是一张**红冲冲销单**，关联原单据 ID: <span className="font-mono bg-white px-1 border rounded">{viewingDoc.original_doc_id.slice(0,8)}...</span></p>
                    </div>
                  )}

                  <div>
                    <h4 className="text-xs font-black text-gray-400 uppercase mb-3 tracking-widest">单据明细清单</h4>
                    <div className="space-y-3 sm:hidden">
                      {(viewingDoc.inventory_document_lines || []).map((l, i) => {
                        const masterProduct = inventory.find(item => (item.sku || item.id) === l.sku);
                        return <div key={i} className="rounded-xl border bg-white p-3 shadow-sm">
                          {viewingDoc.status === 'draft' ? <div className="space-y-3">
                            <label className="block"><span className="mb-1 block text-[10px] font-bold text-gray-400">产品 SKU</span><input list="workflow-edit-skus" className="input-field py-2 text-sm font-bold" value={l.sku || ''} onChange={e => { const product = inventory.find(item => (item.sku || item.id) === e.target.value); setViewingDoc(current => ({...current, inventory_document_lines: current.inventory_document_lines.map((item, itemIndex) => itemIndex === i ? {...item, sku: e.target.value, product_name: product?.name || item.product_name, spec: product?.spec || item.spec, unit: product?.unit || item.unit} : item)})); }} /></label>
                            <label className="block"><span className="mb-1 block text-[10px] font-bold text-gray-400">产品名称</span><input className="input-field py-2 text-sm" value={l.product_name || ''} onChange={e => updateViewingLine(i, 'product_name', e.target.value)} /></label>
                            <label className="block"><span className="mb-1 block text-[10px] font-bold text-gray-400">规格</span><input className="input-field py-2 text-sm" value={l.spec || masterProduct?.spec || ''} onChange={e => updateViewingLine(i, 'spec', e.target.value)} /></label>
                            <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                              <label><span className="mb-1 block text-[10px] font-bold text-gray-400">业务数量</span><input type="number" min="0.001" step="0.001" className="input-field py-2 text-right text-sm font-black text-blue-600" value={l.quantity} onChange={e => updateViewingLine(i, 'quantity', e.target.value)} /></label>
                              <label><span className="mb-1 block text-[10px] font-bold text-gray-400">单位</span><input className="input-field py-2 text-sm" value={l.unit || ''} onChange={e => updateViewingLine(i, 'unit', e.target.value)} /></label>
                              <button type="button" aria-label="删除明细" className="mb-0.5 rounded-lg p-2.5 text-red-400 hover:bg-red-50" onClick={() => setViewingDoc({...viewingDoc, inventory_document_lines: viewingDoc.inventory_document_lines.filter((_, itemIndex) => itemIndex !== i)})}><Trash2 size={17} /></button>
                            </div>
                          </div> : <div className="space-y-2"><p className="font-bold">{l.sku}</p><p className="text-sm text-gray-600">{l.product_name}</p><p className="text-xs font-bold text-blue-600">规格：{l.spec || masterProduct?.spec || '未填写'}</p><div className="flex justify-between border-t pt-2"><span className="text-xs text-gray-400">数量</span><span className="font-black text-blue-600">{l.quantity} {l.unit}</span></div></div>}
                        </div>;
                      })}
                    </div>
                    <div className="hidden overflow-hidden rounded-xl border sm:block">
                      <table className="w-full text-xs text-left">
                        <thead className="bg-gray-50 text-gray-500">
                          <tr><th className="px-4 py-2">产品 SKU / 名称 / 规格</th><th className="px-4 py-2 text-right">业务数量</th><th className="px-4 py-2">单位</th>{viewingDoc.status === 'draft' && <th className="w-10" />}</tr>
                        </thead>
                        <tbody className="divide-y">
                          {(viewingDoc.inventory_document_lines || []).map((l, i) => (
                            <tr key={i} className="hover:bg-gray-50">
                              <td className="px-4 py-3">{viewingDoc.status === 'draft' ? <div className="space-y-2"><input list="workflow-edit-skus" className="input-field py-1.5 text-xs font-bold" value={l.sku || ''} onChange={e => { const product = inventory.find(item => (item.sku || item.id) === e.target.value); setViewingDoc(current => ({...current, inventory_document_lines: current.inventory_document_lines.map((item, itemIndex) => itemIndex === i ? {...item, sku: e.target.value, product_name: product?.name || item.product_name, spec: product?.spec || item.spec, unit: product?.unit || item.unit} : item)})); }} /><input className="input-field py-1.5 text-xs" placeholder="产品名称" value={l.product_name || ''} onChange={e => updateViewingLine(i, 'product_name', e.target.value)} /><input className="input-field py-1.5 text-xs" placeholder="规格" value={l.spec || inventory.find(item => (item.sku || item.id) === l.sku)?.spec || ''} onChange={e => updateViewingLine(i, 'spec', e.target.value)} /></div> : <><p className="font-bold">{l.sku}</p><p className="text-[10px] text-gray-500">{l.product_name}</p><p className="mt-1 text-[10px] font-bold text-blue-600">规格：{l.spec || inventory.find(item => (item.sku || item.id) === l.sku)?.spec || '未填写'}</p></>}</td>
                              <td className={`px-4 py-3 text-right font-black ${l.quantity < 0 ? 'text-red-500' : 'text-blue-600'}`}>{viewingDoc.status === 'draft' ? <input type="number" min="0.001" step="0.001" className="input-field py-1.5 text-xs text-right" value={l.quantity} onChange={e => updateViewingLine(i, 'quantity', e.target.value)} /> : l.quantity}</td>
                              <td className="px-4 py-3 text-gray-400">{viewingDoc.status === 'draft' ? <input className="input-field py-1.5 text-xs w-20" value={l.unit || ''} onChange={e => updateViewingLine(i, 'unit', e.target.value)} /> : l.unit}</td>
                              {viewingDoc.status === 'draft' && <td className="pr-2"><button type="button" className="p-2 text-red-400 hover:bg-red-50 rounded" onClick={() => setViewingDoc({...viewingDoc, inventory_document_lines: viewingDoc.inventory_document_lines.filter((_, itemIndex) => itemIndex !== i)})}><Trash2 size={14} /></button></td>}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <datalist id="workflow-edit-skus">{inventory.map(item => <option key={item.sku || item.id} value={item.sku || item.id}>{item.name}</option>)}</datalist>
                    </div>
                    {viewingDoc.status === 'draft' && <button type="button" className="mt-3 text-xs font-bold text-blue-600 hover:underline" onClick={() => setViewingDoc({...viewingDoc, inventory_document_lines: [...(viewingDoc.inventory_document_lines || []), { sku: '', product_name: '', spec: '', quantity: 1, unit: '条', batch_no: '', warehouse: '', unit_price: 0 }]})}>+ 新增明细</button>}
                  </div>
                </div>

                <div className="space-y-6 border-l lg:pl-8">
                   <div>
                     <h4 className="mb-3 text-xs font-black uppercase tracking-widest text-gray-400">审批进度与处理意见</h4>
                     {viewingDoc.status === 'rejected' && viewingDoc.rejection_reason && (
                       <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                         <p className="font-black">本次驳回原因</p>
                         <p className="mt-1 whitespace-pre-wrap leading-relaxed">{viewingDoc.rejection_reason}</p>
                       </div>
                     )}
                     {approvalTimelineLoading ? (
                       <div className="flex items-center gap-2 rounded-xl border p-4 text-xs text-gray-400"><Loader2 size={15} className="animate-spin" />正在加载审批轨迹…</div>
                     ) : approvalTimeline.length === 0 ? (
                       <div className="rounded-xl border border-dashed p-4 text-center text-[10px] text-gray-400">暂无审批事件；历史单据会在数据库迁移后补齐基础轨迹</div>
                     ) : (
                       <ol className="space-y-0">
                         {approvalTimeline.map((event, index) => {
                           const meta = APPROVAL_ACTIONS[event.action] || { label: event.action, tone: 'bg-gray-500' };
                           const actorLabel = event.actor_name || (event.actor_role === 'admin' ? '管理员' : ['warehouse_keeper', 'inv_manager'].includes(event.actor_role) ? '仓管' : event.actor_role === 'staff' ? '员工' : '系统');
                           return (
                             <li key={event.id} className="relative flex gap-3 pb-4 last:pb-0">
                               {index < approvalTimeline.length - 1 && <span className="absolute left-[7px] top-4 h-full w-px bg-gray-200" />}
                               <span className={`relative mt-1 h-4 w-4 shrink-0 rounded-full border-4 border-white shadow ${meta.tone}`} />
                               <div className="min-w-0 flex-1 rounded-lg bg-gray-50 p-2.5">
                                 <div className="flex flex-wrap items-center justify-between gap-1">
                                   <p className="text-[11px] font-black text-slate-800">{meta.label}</p>
                                   <time className="text-[9px] text-gray-400">{formatEntryTime(event.created_at)}</time>
                                 </div>
                                 <p className="mt-1 text-[10px] text-gray-500">处理人：{actorLabel}</p>
                                 {event.comment && <p className="mt-1 whitespace-pre-wrap rounded-md border border-amber-100 bg-amber-50 px-2 py-1.5 text-[10px] leading-relaxed text-amber-800">意见：{event.comment}</p>}
                               </div>
                             </li>
                           );
                         })}
                       </ol>
                     )}
                   </div>

                   <div>
                     <h4 className="text-xs font-black text-gray-400 uppercase mb-3 tracking-widest">库存流水凭证</h4>
                     <div className="space-y-3">
                        {docMovements.length === 0 ? (
                          <div className="p-8 text-center border-2 border-dashed rounded-xl text-gray-300"><Info size={24} className="mx-auto mb-2 opacity-50" /><p className="text-[10px]">待入账后生成流水</p></div>
                        ) : docMovements.map((m, i) => (
                          <div key={i} className="p-3 bg-gray-50 rounded-lg border flex justify-between items-center">
                            <div><p className="text-[10px] font-bold text-gray-800">{m.sku}</p><p className="text-[9px] text-gray-400">{m.direction === 'in' ? '增加库存' : '减少库存'}</p></div>
                            <p className={`text-xs font-black ${m.direction === 'in' ? 'text-emerald-600' : 'text-red-600'}`}>{m.direction === 'in' ? '+' : '-'}{m.quantity}</p>
                          </div>
                        ))}
                     </div>
                     {showStockAudit && docMovements.length > 0 && (
                       <div className="mt-4 space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
                         <p className="text-xs font-black text-emerald-800">入账数量核对结果</p>
                         {docMovements.map((movement, index) => {
                           const product = inventory.find((item) => (item.sku || item.id) === movement.sku);
                           return (
                             <div key={`${movement.id || movement.sku}-${index}`} className="rounded-lg border bg-white p-3 text-[10px]">
                               <div className="mb-2 flex items-center justify-between gap-2">
                                 <p className="font-black text-slate-800">{movement.sku}</p>
                                 <button type="button" onClick={() => openInventoryForSku(movement.sku)} className="rounded-md bg-blue-50 px-2 py-1 font-bold text-blue-600 hover:bg-blue-100">进入对应库存</button>
                               </div>
                               <div className="grid grid-cols-4 gap-2 text-center">
                                 <div><p className="text-gray-400">入账前</p><p className="font-black">{Number(movement.before_stock || 0).toLocaleString()}</p></div>
                                 <div><p className="text-gray-400">本单变动</p><p className={movement.direction === 'in' ? 'font-black text-emerald-600' : 'font-black text-red-600'}>{movement.direction === 'in' ? '+' : '-'}{Number(movement.quantity || 0).toLocaleString()}</p></div>
                                 <div><p className="text-gray-400">入账后</p><p className="font-black">{Number(movement.after_stock || 0).toLocaleString()}</p></div>
                                 <div><p className="text-gray-400">当前库存</p><p className="font-black text-blue-600">{product ? Number(product.stock || 0).toLocaleString() : '未找到'}</p></div>
                               </div>
                             </div>
                           );
                         })}
                       </div>
                     )}
                   </div>

                   <div>
                     <h4 className="text-xs font-black text-gray-400 uppercase mb-3 tracking-widest">单据备注</h4>
                     {viewingDoc.status === 'draft' ? <textarea rows="5" className="input-field text-xs leading-relaxed" value={viewingDoc.notes || ''} onChange={e => setViewingDoc({...viewingDoc, notes: e.target.value})} placeholder="填写单据备注" /> : <div className="p-3 bg-gray-50 rounded-lg text-xs text-gray-600 italic leading-relaxed border-l-4 border-blue-200">{viewingDoc.notes || '无备注信息'}</div>}
                   </div>
                </div>
              </div>

              {error && <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-600"><AlertTriangle size={16} className="mr-2 inline" />{error}</div>}
              <div className="flex gap-3 justify-end mt-4 pt-6 border-t">
                 <button onClick={() => setViewingDoc(null)} className="btn-secondary px-6">关闭</button>
                 {['posted', 'voided'].includes(viewingDoc.status) && <button onClick={checkCurrentStock} disabled={saving} className="btn-secondary flex items-center gap-2 px-5 disabled:opacity-60"><Search size={16} />{saving ? '核对中...' : '核对产品库存'}</button>}
                 {viewingDoc.status === 'draft' && <button onClick={saveViewingDraft} disabled={saving} className="btn-primary flex items-center gap-2 px-6 disabled:opacity-60"><Check size={16} />{saving ? '保存中...' : '保存修改'}</button>}
                 {viewingDoc.status === 'draft' && <button onClick={() => runAction(isAdmin ? 'approve_draft' : 'submit', viewingDoc.id, { document: viewingDoc, lines: viewingDoc.inventory_document_lines || [] })} disabled={saving} className={`btn-primary flex items-center gap-2 px-6 disabled:opacity-60 ${isAdmin ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}>{isAdmin ? <CheckCircle size={16} /> : <Send size={16} />}{isAdmin ? '保存并直接审核通过' : '提交仓管复核'}</button>}
                 {viewingDoc.status === 'rejected' && (isAdmin || viewingDoc.created_by === user.id) && <button onClick={() => runAction('revise_rejected', viewingDoc.id)} disabled={saving} className="btn-primary bg-amber-600 hover:bg-amber-700 flex items-center gap-2 px-6 disabled:opacity-60"><Pencil size={16} />退回草稿修改</button>}
                 {isAdmin && viewingDoc.status === 'posted' && <button onClick={() => runAction('void', viewingDoc.id)} className="btn-secondary text-red-600 border-red-200 bg-red-50 flex items-center gap-2"><RefreshCw size={16} />红冲作废</button>}
                 {isAdmin && viewingDoc.status === 'approved' && <button onClick={() => runAction('reopen', viewingDoc.id)} disabled={saving} className="btn-secondary flex items-center gap-2 px-5"><Pencil size={16} />退回草稿修改</button>}
                 {isAdmin && viewingDoc.status === 'approved' && <button onClick={() => runAction('post', viewingDoc.id)} className="btn-primary flex items-center gap-2 shadow-lg shadow-blue-100 px-6"><PackageCheck size={16} />{getPostingLabel(viewingDoc)}</button>}
                 {isWarehouseKeeper && viewingDoc.status === 'pending' && <><button onClick={() => runAction('reject', viewingDoc.id)} className="btn-secondary text-red-600 border-red-200 flex items-center gap-2 px-5"><XCircle size={16} />复核驳回</button><button onClick={() => runAction('approve', viewingDoc.id)} className="btn-primary bg-indigo-600 flex items-center gap-2 px-6"><CheckCircle size={16} />仓管复核通过，递交管理员</button></>}
                 {isAdmin && viewingDoc.status === 'warehouse_approved' && <><button onClick={() => runAction('final_reject', viewingDoc.id)} className="btn-secondary text-red-600 border-red-200 flex items-center gap-2 px-5"><XCircle size={16} />终审驳回</button><button onClick={() => runAction('final_approve', viewingDoc.id)} className="btn-primary bg-emerald-600 flex items-center gap-2 px-6"><CheckCircle size={16} />管理员最终批准</button></>}
              </div>
           </div>
        </div>
      )}

      {/* Image Viewer Modal */}
      {viewingImage && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[200] flex items-center justify-center p-4" onClick={() => setViewingImage(null)}>
          <div className="relative max-w-5xl w-full h-full flex flex-col items-center justify-center" onClick={e => e.stopPropagation()}>
            <div className="absolute top-0 right-0 p-4">
              <button onClick={() => setViewingImage(null)} className="p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors"><XCircle size={32} /></button>
            </div>
            <div className="bg-white p-2 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
              <img src={viewingImage} className="max-w-full max-h-[85vh] object-contain" alt="单据照片明细" />
              <div className="p-4 bg-gray-50 flex justify-between items-center">
                <p className="text-xs font-bold text-gray-500 flex items-center gap-2"><Info size={14} /> 单据原始照片凭证 (已通过 AI 安全校验)</p>
                <a href={viewingImage} target="_blank" rel="noreferrer" className="btn-secondary py-1 px-3 text-[10px] flex items-center gap-2"><Eye size={12} /> 查看原图</a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WorkflowPage;
