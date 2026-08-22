import React, { useEffect, useState } from 'react';
import { Search, Filter, Plus, Pencil, Trash2, X, LoaderCircle, ChevronLeft, ChevronRight, AlertCircle, ImagePlus, RotateCcw } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { deleteInventoryProduct, getInventoryFilterOptions, listInventory, saveInventoryProduct, uploadProductImage } from '../../lib/inventoryApi';

const FALLBACK_PRODUCT_IMAGE = '/assets/images/placeholder.svg';
const EMPTY_FILTERS = { primary_category: 'All', secondary_type: 'All', material: 'All', adhesive_type: 'All', width_mm: 'All', color: 'All' };
const EMPTY_PRODUCT = {
  id: '', name: '', image_path: '', image: '', category: '魔术贴', primary_category: '魔术贴', secondary_type: '', material: '', adhesive_type: '', width_mm: '', color: '', spec: '', stock: '', unit: '条', price: '', source: 'A线生产'
};
const PRIMARY_CATEGORY_OPTIONS = ['魔术贴', '织带', '松紧带', '头带', '辅料', '包装材料', '其他'];
const SECONDARY_TYPE_OPTIONS = ['勾面', '毛面', '勾毛一体', '扎带', '圆点', '背靠背', '其他'];
const MATERIAL_OPTIONS = ['尼龙', '涤纶', '混纺', '塑料', '金属', '其他'];
const ADHESIVE_OPTIONS = ['无背胶', '普通背胶', '强力背胶', '耐高温背胶', '其他'];

const StatusPill = ({ status, size = 'md' }) => {
  const config = {
    'In Stock': { label: '有库存', color: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
    'High Stock': { label: '库存充足', color: 'bg-blue-50 text-blue-700 border-blue-100' },
    'Low Stock': { label: '库存不足', color: 'bg-amber-50 text-amber-700 border-amber-100' },
    'Out of Stock': { label: '缺货', color: 'bg-red-50 text-red-700 border-red-100' }
  };
  const { label, color } = config[status] || config['In Stock'];
  const sizeClasses = size === 'xs' ? 'px-1.5 py-0.5 text-[9px]' : 'px-2.5 py-0.5 text-xs';
  return <span className={`inline-flex items-center rounded-full font-bold border ${sizeClasses} ${color}`}>{label}</span>;
};

const InventoryTable = ({ user }) => {
  const [searchParams] = useSearchParams();
  const [data, setData] = useState([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState(() => searchParams.get('search') || '');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState(null);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [activeFilters, setActiveFilters] = useState(EMPTY_FILTERS);
  const [filterOptions, setFilterOptions] = useState({ primary_categories: [], secondary_types: [], materials: [], adhesive_types: [], widths: [], colors: [] });
  const [newProduct, setNewProduct] = useState(EMPTY_PRODUCT);
  const [editingId, setEditingId] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 15;

  const canManage = user?.role === 'admin';

  const loadData = async (page = currentPage, search = searchTerm, filters = activeFilters) => {
    setIsLoading(true);
    setError('');
    try {
      const { products, total: count } = await listInventory({ page, pageSize, search, ...filters });
      setData(products);
      setTotal(count);
    } catch (loadError) {
      setError(loadError.message || '加载库存失败，请点击下方按钮重试');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      loadData(currentPage, searchTerm, activeFilters);
    }, 300);
    return () => clearTimeout(timer);
  }, [currentPage, searchTerm, activeFilters.primary_category, activeFilters.secondary_type, activeFilters.material, activeFilters.adhesive_type, activeFilters.width_mm, activeFilters.color]);

  useEffect(() => {
    getInventoryFilterOptions()
      .then((options) => setFilterOptions((current) => ({ ...current, ...options })))
      .catch((optionsError) => console.warn('结构化筛选项加载失败', optionsError));
  }, []);

  // 处理从仪表盘跳转过来的快速编辑请求
  useEffect(() => {
    if (!isLoading && data.length > 0) {
      const pendingSku = localStorage.getItem('xinwei_pending_edit');
      if (pendingSku) {
        const itemToEdit = data.find(p => p.sku === pendingSku || p.id === pendingSku);
        if (itemToEdit && canManage) {
          handleEditProduct(itemToEdit);
        }
        localStorage.removeItem('xinwei_pending_edit');
      }
    }
  }, [isLoading, data, canManage]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const resetProductForm = () => {
    setNewProduct(EMPTY_PRODUCT);
    setEditingId(null);
    setError('');
    setIsUploadingImage(false);
  };

  const handleEditProduct = (item) => {
    setNewProduct({
      ...EMPTY_PRODUCT,
      ...item,
      id: item.sku || item.id,
      primary_category: item.primary_category || item.category || '',
      category: item.category || item.primary_category || '',
      width_mm: item.width_mm ?? '',
      stock: item.stock.toString(),
      price: item.price.toString()
    });
    setEditingId(item.sku || item.id);
    setIsAddModalOpen(true);
  };

  const handleDeleteProduct = async (item) => {
    const confirmed = window.confirm(`确定要删除产品“${item.name}”吗？`);
    if (!confirmed) return;
    try {
      await deleteInventoryProduct(item.sku || item.id);
      loadData();
    } catch (e) {
      alert(e.message);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const nextSku = newProduct.id.trim();
    if (editingId && nextSku !== editingId) {
      const confirmed = window.confirm(`确定将 SKU “${editingId}”修改为“${nextSku}”吗？\n系统会同步更新库存、单据和追溯记录。`);
      if (!confirmed) return;
    }
    setIsSaving(true);
    try {
      await saveInventoryProduct({
        ...newProduct,
        category: newProduct.primary_category || newProduct.category || '未分类',
        id: nextSku,
        sku: nextSku,
        original_sku: editingId || nextSku,
        stock: Number(newProduct.stock),
        price: Number(newProduct.price)
      });
      setIsAddModalOpen(false);
      resetProductForm();
      loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const setFilter = (field, value) => {
    setCurrentPage(1);
    setActiveFilters((current) => ({ ...current, [field]: value }));
  };

  const resetFilters = () => {
    setCurrentPage(1);
    setActiveFilters(EMPTY_FILTERS);
  };

  const hasActiveFilters = Object.values(activeFilters).some((value) => value !== 'All');
  const optionsFor = (field, defaults = []) => [...new Set([...defaults, ...(filterOptions[field] || [])].filter(Boolean))];
  const structuredSummary = (item) => [item.primary_category || item.category, item.secondary_type, item.material, item.adhesive_type, item.width_mm !== null && item.width_mm !== undefined && item.width_mm !== '' ? `${Number(item.width_mm)}mm` : '', item.color].filter(Boolean);

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingImage(true);
    setError('');
    try {
      const { path, url } = await uploadProductImage(file);
      setNewProduct((current) => ({ ...current, image_path: path, image: url }));
    } catch (err) {
      setError(err.message || '产品图片上传失败');
    } finally {
      setIsUploadingImage(false);
      e.target.value = '';
    }
  };

  return (
    <div className="card overflow-hidden relative min-h-[400px]" data-component="inventory-table">
      {error && (
        <div className="m-4 p-4 rounded-xl bg-red-50 border border-red-100 flex items-center justify-between">
          <div className="flex items-center gap-3 text-red-600">
            <AlertCircle size={20} />
            <span className="text-sm font-medium">{error}</span>
          </div>
          <button onClick={() => loadData()} className="btn-secondary py-1.5 px-4 text-xs font-bold bg-white text-red-600 border-red-200">立即重试</button>
        </div>
      )}
      
      {isLoading && (
        <div className="absolute inset-0 bg-white/60 backdrop-blur-[1px] z-10 flex flex-col items-center justify-center gap-3">
          <LoaderCircle size={32} className="animate-spin text-blue-600" />
          <p className="text-xs font-bold text-gray-500 tracking-widest uppercase">同步中...</p>
        </div>
      )}

      <div className="p-4 border-b border-[var(--color-border)] bg-gray-50/50 flex flex-col md:flex-row gap-4 justify-between items-center">
        <div className="relative w-full md:w-96">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input 
            type="text" placeholder="搜索编号、名称、规格或属性..." 
            className="input-field pl-10" 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        
        <div className="flex items-center gap-2 w-full md:w-auto">
          {canManage && (
            <button onClick={() => { resetProductForm(); setIsAddModalOpen(true); }} className="btn-primary flex-1 md:flex-none flex items-center justify-center gap-2">
              <Plus size={18} /> 新增产品
            </button>
          )}
          <button onClick={() => setIsFilterOpen(!isFilterOpen)} className={`p-2 rounded-lg border transition-colors ${isFilterOpen ? 'bg-blue-600 text-white' : 'bg-white text-gray-600'}`}>
            <Filter size={20} />
          </button>
        </div>
      </div>

      {isFilterOpen && (
        <div className="border-b border-[var(--color-border)] bg-slate-50 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div><p className="text-xs font-black text-slate-700">组合筛选</p><p className="mt-0.5 text-[10px] text-slate-400">可同时选择多个条件，结果取交集</p></div>
            {hasActiveFilters && <button type="button" onClick={resetFilters} className="inline-flex items-center gap-1 rounded-lg border bg-white px-3 py-2 text-xs font-bold text-blue-600"><RotateCcw size={14} />重置</button>}
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {[
              ['primary_category', '一级品类', 'primary_categories', PRIMARY_CATEGORY_OPTIONS],
              ['secondary_type', '二级类型', 'secondary_types', SECONDARY_TYPE_OPTIONS],
              ['material', '材质', 'materials', MATERIAL_OPTIONS],
              ['adhesive_type', '背胶', 'adhesive_types', ADHESIVE_OPTIONS],
              ['width_mm', '宽度', 'widths', []],
              ['color', '颜色', 'colors', []]
            ].map(([field, label, optionField, defaults]) => (
              <label key={field} className="min-w-0">
                <span className="mb-1 block text-[10px] font-bold uppercase text-gray-400">{label}</span>
                <select className="input-field w-full py-2 text-xs" value={activeFilters[field]} onChange={(event) => setFilter(field, event.target.value)}>
                  <option value="All">全部{label}</option>
                  {optionsFor(optionField, defaults).map((option) => <option key={String(option)} value={String(option)}>{field === 'width_mm' ? `${option} mm` : option}</option>)}
                </select>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Desktop Table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase bg-gray-50 text-[var(--color-text-muted)] border-b">
            <tr>
              <th className="px-6 py-4 font-semibold">编号</th>
              <th className="px-6 py-4 font-semibold text-center">预览</th>
              <th className="px-6 py-4 font-semibold">产品名称</th>
              <th className="px-6 py-4 font-semibold">产品属性</th>
              <th className="px-6 py-4 font-semibold">规格</th>
               <th className="px-6 py-4 font-semibold text-right">可用库存</th>
               <th className="px-6 py-4 font-semibold">单位/单价</th>
               {canManage && <th className="px-6 py-4 font-semibold text-right">成本价</th>}
               {canManage && <th className="px-6 py-4 font-semibold">操作</th>}

            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {data.map((item) => (
              <tr key={item.sku} className="hover:bg-gray-50/50 transition-colors">
                <td className="px-6 py-4 font-medium text-blue-600">{item.sku}</td>
                <td className="px-6 py-4 flex justify-center">
                  <img 
                    src={item.image || FALLBACK_PRODUCT_IMAGE} 
                    className="h-10 w-10 rounded object-contain border bg-white cursor-zoom-in"
                    onClick={() => setPreviewImage({ src: item.image || FALLBACK_PRODUCT_IMAGE, name: item.name })}
                  />
                </td>
                <td className="px-6 py-4 font-bold">{item.name}</td>
                <td className="px-6 py-4 text-xs">
                  <div className="flex max-w-xs flex-wrap gap-1">
                    {structuredSummary(item).length ? structuredSummary(item).map((attribute, index) => <span key={`${attribute}-${index}`} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">{attribute}</span>) : <span className="text-slate-400">未分类</span>}
                  </div>
                </td>
                <td className="px-6 py-4 text-xs text-slate-500">{item.spec || '-'}</td>
                <td className={`px-6 py-4 text-right font-black ${Number(item.available_stock) < 0 ? 'text-red-600' : ''}`}>
                  {item.available_stock?.toLocaleString()}
                  {Number(item.available_stock) < 0 && <span className="block text-[10px] font-bold">待盘点补齐</span>}
                </td>
                 <td className="px-6 py-4">
                   <div className="text-xs">{item.unit}</div>
                   <div className="text-[10px] text-gray-400">¥{Number(item.price).toFixed(2)}</div>
                 </td>
                 {canManage && (
                   <td className="px-6 py-4 text-right font-mono text-xs text-amber-600">
                     {item.cost_price ? `¥${Number(item.cost_price).toFixed(2)}` : '-'}
                   </td>
                 )}
                 {canManage && (

                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1">
                      <button onClick={() => handleEditProduct(item)} className="p-2 hover:bg-blue-50 text-gray-400 hover:text-blue-600 rounded"><Pencil size={16} /></button>
                      <button onClick={() => handleDeleteProduct(item)} className="p-2 hover:bg-red-50 text-gray-400 hover:text-red-600 rounded"><Trash2 size={16} /></button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile Cards */}
      <div className="md:hidden divide-y">
        {data.map((item) => (
          <div key={item.sku} className="p-4 bg-white active:bg-gray-50">
            <div className="flex gap-4">
              <img src={item.image || FALLBACK_PRODUCT_IMAGE} className="w-16 h-16 rounded object-contain border" onClick={() => setPreviewImage({ src: item.image || FALLBACK_PRODUCT_IMAGE, name: item.name })} />
              <div className="flex-grow min-w-0">
                <div className="flex justify-between items-start mb-1">
                  <span className="text-[10px] font-bold text-blue-600">{item.sku}</span>
                  <StatusPill status={item.status} size="xs" />
                </div>
                <h4 className="text-sm font-bold truncate">{item.name}</h4>
                <div className="mt-1 flex flex-wrap gap-1">{structuredSummary(item).map((attribute, index) => <span key={`${attribute}-${index}`} className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-600">{attribute}</span>)}</div>
                <p className="mt-1 text-[10px] text-gray-400">规格：{item.spec || '未填写'}</p>
                <div className="mt-2 flex justify-between items-end">
                  <div>
                    <p className="text-[9px] text-gray-400 font-bold uppercase">可用库存</p>
                    <p className={`text-sm font-black ${Number(item.available_stock) < 0 ? 'text-red-600' : ''}`}>
                      {item.available_stock?.toLocaleString()} {item.unit}
                      {Number(item.available_stock) < 0 && <span className="ml-2 text-[10px]">待盘点补齐</span>}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[9px] text-gray-400 font-bold uppercase">单价</p>
                    <p className="text-xs font-bold text-gray-700">¥{Number(item.price).toFixed(2)}</p>
                  </div>
                </div>
              </div>
            </div>
            {canManage && (
              <div className="mt-3 pt-3 border-t flex gap-2">
                <button onClick={() => handleEditProduct(item)} className="flex-1 py-1.5 bg-blue-50 text-blue-600 text-xs font-bold rounded-lg flex items-center justify-center gap-2"><Pencil size={14} /> 编辑</button>
                <button onClick={() => handleDeleteProduct(item)} className="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg"><Trash2 size={14} /></button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Pagination */}
      <div className="p-4 bg-gray-50 border-t flex items-center justify-between">
        <span className="text-[10px] font-bold text-gray-400 uppercase">共 {total.toLocaleString()} 条</span>
        <div className="flex items-center gap-2">
          <button disabled={currentPage === 1 || isLoading} onClick={() => setCurrentPage(p => p - 1)} className="p-1.5 border rounded-lg bg-white disabled:opacity-30"><ChevronLeft size={16} /></button>
          <span className="text-xs font-bold px-2">{currentPage} / {totalPages}</span>
          <button disabled={currentPage === totalPages || isLoading} onClick={() => setCurrentPage(p => p + 1)} className="p-1.5 border rounded-lg bg-white disabled:opacity-30"><ChevronRight size={16} /></button>
        </div>
      </div>

      {/* Modals & Previews (Omitted for space but kept in actual implementation) */}
      {previewImage && (
        <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4" onClick={() => setPreviewImage(null)}>
          <div className="relative max-w-full max-h-full" onClick={e => e.stopPropagation()}>
            <img src={previewImage.src} className="max-w-screen max-h-[90vh] rounded shadow-2xl" />
            <button className="absolute -top-4 -right-4 bg-white rounded-full p-1" onClick={() => setPreviewImage(null)}><X size={20} /></button>
          </div>
        </div>
      )}

      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-4 animate-in zoom-in-95 sm:p-6">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-bold">{editingId ? '编辑产品' : '新增产品'}</h3>
              <button type="button" onClick={() => { setIsAddModalOpen(false); resetProductForm(); }} aria-label="关闭产品编辑"><X size={24} /></button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 p-3 text-xs font-medium text-red-600">
                  <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              <div className="rounded-xl border border-dashed border-blue-200 bg-blue-50/40 p-4">
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    className="relative h-24 w-24 flex-shrink-0 overflow-hidden rounded-xl border bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    onClick={() => document.getElementById('product-image-input')?.click()}
                    disabled={isUploadingImage}
                    aria-label="选择产品照片"
                  >
                    <img src={newProduct.image || FALLBACK_PRODUCT_IMAGE} alt="产品照片预览" className="h-full w-full object-contain" />
                    {isUploadingImage && <span className="absolute inset-0 flex items-center justify-center bg-white/80"><LoaderCircle className="animate-spin text-blue-600" size={24} /></span>}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-gray-800">产品照片</p>
                    <p className="mt-1 text-xs leading-5 text-gray-500">支持 JPG、PNG、WEBP；系统会自动压缩。手机可直接选择相册或拍照。</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <label className={`inline-flex cursor-pointer items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700 ${isUploadingImage ? 'pointer-events-none opacity-60' : ''}`}>
                        <ImagePlus size={16} /> {isUploadingImage ? '正在上传…' : (newProduct.image_path ? '更换照片' : '上传照片')}
                        <input id="product-image-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" onChange={handleImageUpload} disabled={isUploadingImage} />
                      </label>
                      {newProduct.image_path && (
                        <button type="button" className="rounded-lg border bg-white px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-50" onClick={() => setNewProduct((current) => ({ ...current, image_path: '', image: '' }))}>
                          移除照片
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block"><span className="text-[10px] font-bold text-gray-500 uppercase">SKU 编号</span><input required className="input-field mt-1" value={newProduct.id} onChange={e => setNewProduct({...newProduct, id: e.target.value})} /><span className="mt-1 block text-[10px] text-amber-600">修改后将同步历史单据与库存记录</span></label>
                <label className="block"><span className="text-[10px] font-bold text-gray-500 uppercase">产品名称</span><input required className="input-field mt-1" value={newProduct.name} onChange={e => setNewProduct({...newProduct, name: e.target.value})} /></label>
              </div>
              <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-4">
                <div className="mb-3"><p className="text-xs font-black text-slate-700">结构化产品属性</p><p className="mt-1 text-[10px] leading-4 text-slate-500">用于组合筛选；旧“分类/规格”资料仍会兼容保留。</p></div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
                  <label className="block"><span className="text-[10px] font-bold text-gray-500 uppercase">一级品类</span><input list="primary-category-options" required className="input-field mt-1" value={newProduct.primary_category || ''} onChange={e => setNewProduct({...newProduct, primary_category: e.target.value, category: e.target.value})} placeholder="如：魔术贴" /><datalist id="primary-category-options">{optionsFor('primary_categories', PRIMARY_CATEGORY_OPTIONS).map(option => <option key={option} value={option} />)}</datalist></label>
                  <label className="block"><span className="text-[10px] font-bold text-gray-500 uppercase">二级类型</span><input list="secondary-type-options" className="input-field mt-1" value={newProduct.secondary_type || ''} onChange={e => setNewProduct({...newProduct, secondary_type: e.target.value})} placeholder="如：勾面、毛面" /><datalist id="secondary-type-options">{optionsFor('secondary_types', SECONDARY_TYPE_OPTIONS).map(option => <option key={option} value={option} />)}</datalist></label>
                  <label className="block"><span className="text-[10px] font-bold text-gray-500 uppercase">材质</span><input list="material-options" className="input-field mt-1" value={newProduct.material || ''} onChange={e => setNewProduct({...newProduct, material: e.target.value})} placeholder="如：尼龙" /><datalist id="material-options">{optionsFor('materials', MATERIAL_OPTIONS).map(option => <option key={option} value={option} />)}</datalist></label>
                  <label className="block"><span className="text-[10px] font-bold text-gray-500 uppercase">背胶</span><input list="adhesive-options" className="input-field mt-1" value={newProduct.adhesive_type || ''} onChange={e => setNewProduct({...newProduct, adhesive_type: e.target.value})} placeholder="如：无背胶" /><datalist id="adhesive-options">{optionsFor('adhesive_types', ADHESIVE_OPTIONS).map(option => <option key={option} value={option} />)}</datalist></label>
                  <label className="block"><span className="text-[10px] font-bold text-gray-500 uppercase">宽度 (mm)</span><input type="number" min="0" step="0.01" className="input-field mt-1" value={newProduct.width_mm ?? ''} onChange={e => setNewProduct({...newProduct, width_mm: e.target.value})} placeholder="如：25" /></label>
                  <label className="block"><span className="text-[10px] font-bold text-gray-500 uppercase">颜色</span><input list="color-options" className="input-field mt-1" value={newProduct.color || ''} onChange={e => setNewProduct({...newProduct, color: e.target.value})} placeholder="如：黑色" /><datalist id="color-options">{optionsFor('colors').map(option => <option key={option} value={option} />)}</datalist></label>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block"><span className="text-[10px] font-bold text-gray-500 uppercase">原规格（兼容保留）</span><input className="input-field mt-1" value={newProduct.spec || ''} onChange={e => setNewProduct({...newProduct, spec: e.target.value})} placeholder="旧资料或其他补充规格" /></label>
                <label className="block"><span className="text-[10px] font-bold text-gray-500 uppercase">单位</span><input required className="input-field mt-1" value={newProduct.unit || ''} onChange={e => setNewProduct({...newProduct, unit: e.target.value})} placeholder="条、件、kg" /></label>
              </div>
               <div className="grid grid-cols-1 gap-4">
                 <label className="block"><span className="text-[10px] font-bold text-gray-500 uppercase">库存数量 (初始化)</span><input type="number" required className="input-field mt-1" value={newProduct.stock} onChange={e => setNewProduct({...newProduct, stock: e.target.value})} /></label>
               </div>
               <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                 <label className="block"><span className="text-[10px] font-bold text-gray-500 uppercase">销售单价 (CNY)</span><input type="number" step="0.01" required className="input-field mt-1" value={newProduct.price} onChange={e => setNewProduct({...newProduct, price: e.target.value})} /></label>
                 <label className="block"><span className="text-[10px] font-bold text-gray-500 uppercase">成本单价 (CNY)</span><input type="number" step="0.01" className="input-field mt-1 border-amber-100 bg-amber-50/30" value={newProduct.cost_price || ''} onChange={e => setNewProduct({...newProduct, cost_price: e.target.value})} /></label>
               </div>

              <div className="sticky bottom-0 -mx-4 flex flex-col-reverse gap-2 border-t bg-white/95 px-4 pt-4 backdrop-blur sm:static sm:mx-0 sm:flex-row sm:justify-end sm:px-0">
                <button type="button" onClick={() => { setIsAddModalOpen(false); resetProductForm(); }} className="btn-secondary">取消</button>
                <button type="submit" disabled={isSaving || isUploadingImage} className="btn-primary px-6 disabled:opacity-60">{isUploadingImage ? '请等待图片上传' : (isSaving ? '保存中...' : '确认保存')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default InventoryTable;
