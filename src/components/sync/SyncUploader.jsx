import React, { useRef, useState } from 'react';
import { AlertCircle, CheckCircle, Download, FileSpreadsheet, LoaderCircle, Upload, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { bulkImportInventory, uploadProductImage } from '../../lib/inventoryApi';
import { notifyCloudInventoryUpdated } from '../../data/inventoryStore';

const TEMPLATE_HEADERS = ['产品编号', '产品名称', '一级品类', '二级类型', '材质', '背胶', '宽度(mm)', '颜色', '规格', '当前库存', '单位', '单价', '来源', '图片URL'];
const LEGACY_TEMPLATE_HEADERS = ['产品编号', '产品名称', '分类', '规格', '当前库存', '单位', '单价', '来源', '图片URL'];
const FIELD_MAP = {
  产品编号: 'id',
  产品名称: 'name',
  分类: 'category',
  一级品类: 'primary_category',
  二级类型: 'secondary_type',
  材质: 'material',
  背胶: 'adhesive_type',
  '宽度(mm)': 'width_mm',
  颜色: 'color',
  规格: 'spec',
  当前库存: 'stock',
  单位: 'unit',
  单价: 'price',
  来源: 'source',
  图片URL: 'image_url'
};

const normalizeHeader = (value) => String(value ?? '').replace(/^\uFEFF/, '').trim();
const normalizeText = (value) => String(value ?? '').trim();

const parseNumber = (value) => {
  if (typeof value === 'number') return value;
  const normalized = normalizeText(value).replace(/[,，\s]/g, '');
  return normalized === '' ? NaN : Number(normalized);
};

const parseXml = (xmlText) => new DOMParser().parseFromString(xmlText, 'application/xml');

const getRelationshipTarget = (relationshipsXml, relationshipId) => {
  const relationship = Array.from(relationshipsXml.getElementsByTagName('Relationship')).find((item) => item.getAttribute('Id') === relationshipId);
  return relationship?.getAttribute('Target') || '';
};

const extractEmbeddedImages = async (buffer, sheetIndex = 1) => {
  const zip = await JSZip.loadAsync(buffer);
  const drawingFiles = Object.keys(zip.files).filter((name) => name.startsWith('xl/drawings/drawing') && name.endsWith('.xml'));
  const imagesByRow = new Map();

  for (const drawingFile of drawingFiles) {
    const drawingXml = parseXml(await zip.file(drawingFile).async('text'));
    const drawingRelsPath = `xl/drawings/_rels/${drawingFile.split('/').pop()}.rels`;
    const drawingRels = zip.file(drawingRelsPath) ? parseXml(await zip.file(drawingRelsPath).async('text')) : null;
    if (!drawingRels) continue;

    const anchors = [
      ...Array.from(drawingXml.getElementsByTagName('xdr:twoCellAnchor')),
      ...Array.from(drawingXml.getElementsByTagName('xdr:oneCellAnchor')),
      ...Array.from(drawingXml.getElementsByTagName('xdr:absoluteAnchor'))
    ];

    for (const anchor of anchors) {
      const from = anchor.getElementsByTagName('xdr:from')[0];
      const rowNode = from?.getElementsByTagName('xdr:row')[0] || from?.getElementsByTagName('row')[0];
      const rowIndex = Number(rowNode?.textContent);
      const blip = anchor.getElementsByTagName('a:blip')[0] || anchor.getElementsByTagName('blip')[0];
      const relationshipId = blip?.getAttribute('r:embed') || blip?.getAttribute('embed');
      const target = getRelationshipTarget(drawingRels, relationshipId);
      if (!Number.isInteger(rowIndex) || !target) continue;

      const mediaPath = `xl/${target.replace(/^\.\.\//, '')}`;
      const mediaFile = zip.file(mediaPath);
      if (!mediaFile) continue;
      const blob = await mediaFile.async('blob');
      const extension = mediaPath.split('.').pop()?.toLowerCase() || 'png';
      const mime = extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : `image/${extension}`;
      imagesByRow.set(rowIndex + 1, new File([blob], `excel-row-${rowIndex + 1}.${extension}`, { type: mime }));
    }
  }

  return imagesByRow;
};

const parseWorkbook = async (file) => {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error('文件没有可读取的工作表');

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const headers = (rows[0] || []).map(normalizeHeader);
  const isStructuredTemplate = headers.length === TEMPLATE_HEADERS.length && TEMPLATE_HEADERS.every((header, index) => headers[index] === header);
  const isLegacyTemplate = headers.length === LEGACY_TEMPLATE_HEADERS.length && LEGACY_TEMPLATE_HEADERS.every((header, index) => headers[index] === header);
  if (!isStructuredTemplate && !isLegacyTemplate) {
    throw new Error(`模板不匹配。请使用新版表头：${TEMPLATE_HEADERS.join('、')}；旧版九列表头也继续支持。`);
  }
  const activeHeaders = isStructuredTemplate ? TEMPLATE_HEADERS : LEGACY_TEMPLATE_HEADERS;
  if (rows.length <= 1) throw new Error('模板中没有产品数据');

  const embeddedImages = file.name.toLowerCase().endsWith('.xlsx')
    ? await extractEmbeddedImages(buffer)
    : new Map();
  const products = [];
  const errors = [];
  const seenSkus = new Set();
  rows.slice(1).forEach((row, rowIndex) => {
    const excelRow = rowIndex + 2;
    if (row.every((value) => normalizeText(value) === '')) return;
    const product = {};
    activeHeaders.forEach((header, index) => {
      product[FIELD_MAP[header]] = normalizeText(row[index]);
    });
    product.primary_category = normalizeText(product.primary_category || product.category);
    product.category = product.primary_category;
    product.secondary_type = normalizeText(product.secondary_type);
    product.material = normalizeText(product.material);
    product.adhesive_type = normalizeText(product.adhesive_type);
    product.color = normalizeText(product.color);
    product.width_mm = normalizeText(product.width_mm) === '' ? '' : parseNumber(product.width_mm);
    product.stock = parseNumber(product.stock);
    product.price = parseNumber(product.price);
    product.excelRow = excelRow;
    product.embeddedImageFile = embeddedImages.get(excelRow) || null;

    [['产品编号', 'id'], ['产品名称', 'name'], ['一级品类', 'primary_category'], ['当前库存', 'stock'], ['单位', 'unit'], ['单价', 'price']].forEach(([label, field]) => {
      if (normalizeText(product[field]) === '') errors.push(`第 ${excelRow} 行：${label}不能为空`);
    });
    if (!product.id) return;
    if (seenSkus.has(product.id)) errors.push(`第 ${excelRow} 行：产品编号 ${product.id} 在文件中重复`);
    seenSkus.add(product.id);
    if (!Number.isFinite(product.stock) || product.stock < 0) errors.push(`第 ${excelRow} 行：当前库存必须是大于等于 0 的数字`);
    if (!Number.isFinite(product.price) || product.price < 0) errors.push(`第 ${excelRow} 行：单价必须是大于等于 0 的数字`);
    if (product.width_mm !== '' && (!Number.isFinite(product.width_mm) || product.width_mm < 0)) errors.push(`第 ${excelRow} 行：宽度必须是大于等于 0 的数字`);
    if (product.image_url && !/^https?:\/\//i.test(product.image_url)) errors.push(`第 ${excelRow} 行：图片URL必须以 http:// 或 https:// 开头`);
    products.push(product);
  });

  if (errors.length > 0) throw new Error(errors.slice(0, 8).join('；') + (errors.length > 8 ? `；另有 ${errors.length - 8} 项错误` : ''));
  return products;
};

const SyncUploader = ({ user, onComplete }) => {
  const [dragActive, setDragActive] = useState(false);
  const [status, setStatus] = useState('idle');
  const [fileName, setFileName] = useState('');
  const [fileResults, setFileResults] = useState([]);
  const [previewRows, setPreviewRows] = useState([]);
  const [error, setError] = useState('');
  const [importedCount, setImportedCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [importErrors, setImportErrors] = useState([]);
  const fileInputRef = useRef(null);
  const isAdmin = user?.role === 'admin';

  const reset = () => {
    setStatus('idle');
    setFileName('');
    setFileResults([]);
    setPreviewRows([]);
    setError('');
    setImportedCount(0);
    setFailedCount(0);
    setImportErrors([]);
  };

  const processFiles = async (fileList) => {
    if (!isAdmin) {
      setError('只有管理员可以导入库存文件');
      return;
    }
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setFileName(files.length === 1 ? files[0].name : `${files.length} 个文件`);
    setStatus('parsing');
    setError('');
    const results = await Promise.all(files.map(async (file) => {
      try {
        const products = await parseWorkbook(file);
        return { name: file.name, ok: true, count: products.length, products };
      } catch (parseError) {
        return { name: file.name, ok: false, count: 0, error: parseError.message || '文件识别失败', products: [] };
      }
    }));
    const validResults = results.filter((result) => result.ok);
    const invalidResults = results.filter((result) => !result.ok);
    const mergedProducts = validResults.flatMap((result) => result.products);
    const skuSet = new Set();
    const duplicateSkus = mergedProducts.filter((product) => {
      if (skuSet.has(product.id)) return true;
      skuSet.add(product.id);
      return false;
    }).map((product) => product.id);

    setFileResults(results);
    if (invalidResults.length > 0) {
      setStatus('error');
      setError(invalidResults.map((result) => `${result.name}：${result.error}`).join('；'));
      return;
    }
    if (duplicateSkus.length > 0) {
      setStatus('error');
      setError(`多个文件中存在重复产品编号：${[...new Set(duplicateSkus)].join('、')}`);
      return;
    }
    setPreviewRows(mergedProducts);
    setStatus('preview');
  };

  const handleDrop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    processFiles(event.dataTransfer.files);
  };

  const handleFileChange = (event) => {
    processFiles(event.target.files);
    event.target.value = '';
  };

  const confirmImport = async () => {
    if (!isAdmin || previewRows.length === 0) return;
    setStatus('importing');
    setError('');
    try {
      const products = [];
      for (let index = 0; index < previewRows.length; index += 1) {
        const row = previewRows[index];
        let imagePath = '';
        if (row.embeddedImageFile) {
          const uploaded = await uploadProductImage(row.embeddedImageFile);
          imagePath = uploaded.path;
        }
        products.push({
          ...row,
          image_path: imagePath,
          embeddedImageFile: undefined
        });
      }
      const result = await bulkImportInventory(products, files.map((file) => file.name).join('、'));
      setImportedCount(result.importedCount);
      setFailedCount(result.failedCount);
      setImportErrors(result.errors || []);
      notifyCloudInventoryUpdated();
      if (onComplete) onComplete();
      setStatus('success');
    } catch (importError) {
      setStatus('error');
      setError(importError.message || '同步失败，库存未更新');
    }
  };

  const downloadTemplate = () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS]);
    sheet['!cols'] = TEMPLATE_HEADERS.map((header) => ({ wch: Math.max(header.length + 4, 14) }));
    XLSX.utils.book_append_sheet(workbook, sheet, '库存导入');
    const instructions = XLSX.utils.aoa_to_sheet([
      ['填写说明'],
      ['第一行表头必须保持不变；当前库存和单价必须填写数字；图片URL可留空。旧版九列模板仍可继续导入。'],
      ['图片URL请填写产品图片的完整 HTTPS 地址；.xlsx 文件中放在产品同一行的嵌入图片会自动识别并上传。'],
      ['示例：MST-025-BK｜尼龙魔术贴｜魔术贴｜勾面｜尼龙｜无背胶｜25｜黑色｜25mm×20m｜500｜卷｜5.20｜外购仓｜（可填写 HTTPS 地址，或在这一行插入图片）'],
      ['保存后返回系统，选择文件并确认预览内容无误，再点击“确认同步”。']
    ]);
    XLSX.utils.book_append_sheet(workbook, instructions, '填写说明');
    XLSX.writeFile(workbook, '鑫威库存导入模板.xlsx');
  };

  return (
    <div className="space-y-6" data-component="sync-uploader">
      <div
        className={`card p-12 border-2 border-dashed flex flex-col items-center justify-center transition-all ${dragActive ? 'border-[var(--color-primary)] bg-blue-50/50 scale-[0.99]' : 'border-gray-300'}`}
        onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
        onDragLeave={(event) => { event.preventDefault(); setDragActive(false); }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
      >
        <input ref={fileInputRef} type="file" multiple onChange={handleFileChange} accept=".xlsx,.xls,.csv" className="hidden" />
        <div className="h-16 w-16 bg-blue-50 rounded-full flex items-center justify-center text-[var(--color-primary)] mb-4"><Upload size={32} /></div>

        {status === 'idle' && (
          <>
            <h3 className="text-lg font-bold text-[var(--color-text-base)] mb-2">点击或拖拽多个模板文件至此处</h3>
            <p className="text-sm text-[var(--color-text-muted)] text-center max-w-md mb-6">支持一次选择多个 Excel 文件，系统会逐个校验模板、合并预览；任何文件不合格都不会同步。</p>
            <div className="flex gap-3">
              <button type="button" disabled={!isAdmin} onClick={() => fileInputRef.current?.click()} className="btn-primary disabled:opacity-50">选择文件</button>
              <button type="button" onClick={downloadTemplate} className="btn-secondary flex items-center gap-2"><Download size={18} />下载导入模板</button>
            </div>
            {!isAdmin && <p className="text-xs text-amber-600 mt-4">当前员工账号只能查看，不能导入库存。</p>}
          </>
        )}

        {status === 'parsing' && <div className="flex flex-col items-center"><LoaderCircle size={28} className="animate-spin text-[var(--color-primary)] mb-3" /><p className="text-sm text-[var(--color-primary)]">正在逐个识别 {fileName}...</p></div>}
        {status === 'importing' && <div className="flex flex-col items-center"><LoaderCircle size={28} className="animate-spin text-[var(--color-primary)] mb-3" /><p className="text-sm text-[var(--color-primary)]">正在同步 {previewRows.length} 条库存到云端...</p></div>}

        {status === 'preview' && (
          <div className="w-full max-w-4xl text-left">
            <div className="flex items-center justify-between gap-3 mb-4"><div><h3 className="text-lg font-bold">多个文件识别成功</h3><p className="text-xs text-[var(--color-text-muted)]">已识别 {fileResults.length} 个文件，共 {previewRows.length} 条记录；确认后才会写入库存</p></div><button type="button" onClick={reset} className="text-gray-400 hover:text-gray-700"><X size={20} /></button></div>
            <div className="mb-4 grid grid-cols-1 sm:grid-cols-2 gap-2">{fileResults.map((result) => <div key={result.name} className="p-2 rounded-lg bg-emerald-50 border border-emerald-100 text-xs text-emerald-700 flex items-center justify-between gap-2"><span className="truncate">{result.name}</span><span className="whitespace-nowrap">{result.count} 条</span></div>)}</div>
            <div className="max-h-56 overflow-auto border rounded-lg"><table className="w-full text-xs"><thead className="bg-gray-50 sticky top-0"><tr><th className="px-3 py-2 text-left">图片</th>{TEMPLATE_HEADERS.slice(0, 12).map((header) => <th key={header} className="px-3 py-2 text-left whitespace-nowrap">{header}</th>)}</tr></thead><tbody>{previewRows.slice(0, 20).map((product) => <tr key={product.id} className="border-t"><td className="px-3 py-2">{product.embeddedImageFile ? <img src={URL.createObjectURL(product.embeddedImageFile)} alt="Excel 嵌入图片" className="h-10 w-10 object-contain rounded border" /> : (product.image_url ? 'URL' : '无')}</td><td className="px-3 py-2">{product.id}</td><td className="px-3 py-2">{product.name}</td><td className="px-3 py-2">{product.primary_category}</td><td className="px-3 py-2">{product.secondary_type}</td><td className="px-3 py-2">{product.material}</td><td className="px-3 py-2">{product.adhesive_type}</td><td className="px-3 py-2">{product.width_mm}</td><td className="px-3 py-2">{product.color}</td><td className="px-3 py-2">{product.spec}</td><td className="px-3 py-2">{product.stock}</td><td className="px-3 py-2">{product.unit}</td><td className="px-3 py-2">{product.price}</td></tr>)}</tbody></table></div>
            <div className="flex justify-end gap-3 mt-4"><button type="button" onClick={reset} className="btn-secondary">取消</button><button type="button" onClick={confirmImport} className="btn-primary">确认同步 {previewRows.length} 条</button></div>
          </div>
        )}

        {status === 'success' && (
          <div className="flex flex-col items-center text-center">
            <div className={`h-12 w-12 ${failedCount > 0 ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'} rounded-full flex items-center justify-center mb-4`}>
              {failedCount > 0 ? <AlertCircle size={28} /> : <CheckCircle size={28} />}
            </div>
            <h3 className={`text-lg font-bold ${failedCount > 0 ? 'text-amber-800' : 'text-emerald-800'} mb-1`}>
              {failedCount > 0 ? '部分导入成功' : '全部导入成功'}
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              成功: <span className="font-bold text-emerald-600">{importedCount}</span> 条 · 
              失败: <span className="font-bold text-red-500">{failedCount}</span> 条
            </p>
            {failedCount > 0 && (
              <div className="mb-6 max-w-md p-3 bg-red-50 border border-red-100 rounded-lg text-left">
                <p className="text-[10px] font-bold text-red-600 uppercase mb-2">失败明细预览 (前3条)：</p>
                {importErrors.slice(0, 3).map((err, i) => (
                  <p key={i} className="text-[10px] text-red-500 mb-1 leading-tight">• 第 {err.excelRow} 行 {err.sku}: {err.error}</p>
                ))}
                <p className="text-[9px] text-red-400 mt-2 text-center italic">可在右侧“近期导入批次”查看完整结构化报告并下载</p>
              </div>
            )}
            <button type="button" onClick={reset} className="text-sm font-medium text-[var(--color-primary)] hover:underline">继续导入其他文件</button>
          </div>
        )}
        {status === 'error' && <div className="flex flex-col items-center text-center max-w-xl"><AlertCircle size={30} className="text-red-500 mb-3" /><h3 className="text-lg font-bold text-red-700 mb-2">文件未通过校验</h3><p className="text-sm text-red-600 leading-6">{error}</p><button type="button" onClick={reset} className="btn-secondary mt-4">重新选择</button></div>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card p-5"><div className="flex items-center gap-3 mb-4 text-emerald-600"><CheckCircle size={20} /><h4 className="font-bold">云端数据库同步</h4></div><p className="text-sm text-[var(--color-text-muted)]">合规模板会先预览，管理员确认后才写入 Supabase 库存表。</p></div>
        <div className="card p-5">
          <div className="flex items-center gap-3 mb-4 text-[var(--color-primary)]"><FileSpreadsheet size={20} /><h4 className="font-bold">固定模板字段</h4></div>
          <p className="text-xs text-[var(--color-text-muted)] leading-6">{TEMPLATE_HEADERS.join('、')}</p>
          <div className="mt-4 p-3 rounded-lg bg-blue-50 border border-blue-100 text-xs text-blue-900 leading-6">
            <p className="font-semibold mb-1">填写示例</p>
            <p>MST-025-BK｜尼龙魔术贴｜魔术贴｜勾面｜尼龙｜无背胶｜25｜黑色｜25mm×20m｜500｜卷｜5.20｜外购仓｜https://example.com/product-image.jpg</p>
          </div>
          <div className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-100 text-xs text-amber-800 leading-6">
            <p>图片URL可以填写完整的 <strong>https://</strong> 图片地址；使用 <strong>.xlsx</strong> 时，也可以把图片插入到对应产品所在行，系统会自动识别、预览并上传。<strong>.csv</strong> 和旧版 <strong>.xls</strong> 不支持读取嵌入图片。</p>
          </div>
          <button type="button" onClick={downloadTemplate} className="mt-3 text-sm text-[var(--color-primary)] hover:underline flex items-center gap-2"><Download size={16} />下载模板</button>
        </div>
      </div>
    </div>
  );
};

export default SyncUploader;
