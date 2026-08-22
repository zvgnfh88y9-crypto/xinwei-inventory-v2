import React, { useEffect, useMemo, useState } from 'react';
import { BarChart3, Download, FilePieChart, FileText, LoaderCircle, Lock, RefreshCw } from 'lucide-react';
import * as XLSX from 'xlsx';
import SectionHeading from '../components/common/SectionHeading';
import { listActivity, listInventory } from '../lib/inventoryApi';

const REPORT_TYPES = {
  all: '综合报表',
  inventory: '当前库存明细',
  activity: '历史操作流水',
  aging: '库存库龄分析',
  turnover: '产品周转率'
};

const ReportsPage = ({ user }) => {
  const [inventory, setInventory] = useState([]);
  const [activity, setActivity] = useState([]);
  const [typeFilter, setTypeFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('30');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [generatedAt, setGeneratedAt] = useState(null);

  const loadReports = async () => {
    setLoading(true);
    setError('');
    try {
      const [invData, activities] = await Promise.all([listInventory(), listActivity()]);
      setInventory(invData.products || invData || []);
      setActivity(activities.activity || activities || []);
    } catch (loadError) {
      setError(loadError.message || '报表数据加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadReports(); }, []);

  const filteredActivity = useMemo(() => {
    if (dateFilter === 'all') return activity;
    const days = Number(dateFilter);
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return activity.filter((item) => new Date(item.time).getTime() >= cutoff);
  }, [activity, dateFilter]);

  const reportRows = useMemo(() => {
    if (typeFilter === 'activity') return filteredActivity;
    if (typeFilter === 'inventory') return inventory;
    return [...inventory, ...filteredActivity];
  }, [inventory, filteredActivity, typeFilter]);

  const downloadReport = (reportType = typeFilter) => {
    let rows = [];
    if (reportType === 'activity') {
      rows = filteredActivity.map((item) => ({
        操作时间: item.time,
        操作人: item.actor,
        操作类型: item.type,
        产品名称: item.item,
        操作说明: item.detail,
        修改内容: item.changes || '',
        数量说明: item.qty
      }));
    } else if (reportType === 'aging') {
      rows = inventory.map((item) => {
        const ageDays = Math.floor((Date.now() - new Date(item.created_at).getTime()) / (1000 * 60 * 60 * 24));
        return {
          产品编号: item.id,
          产品名称: item.name,
          入库日期: item.created_at,
          库龄天数: ageDays,
          库龄类别: ageDays > 90 ? '呆滞料(>90天)' : (ageDays > 30 ? '常规(30-90天)' : '新鲜(<30天)'),
          当前库存: item.stock,
          库存总额: item.stock * item.price
        };
      });
    } else if (reportType === 'turnover') {
      rows = inventory.map((item) => {
        const outEvents = activity.filter(a => a.sku === item.id && a.type === 'OUT');
        const outQty = outEvents.reduce((s, a) => s + Math.abs(parseFloat(a.qty) || 0), 0);
        const turnoverRate = item.stock > 0 ? (outQty / item.stock).toFixed(2) : '0.00';
        return {
          产品编号: item.id,
          产品名称: item.name,
          累计出库量: outQty,
          期末库存: item.stock,
          估算周转率: turnoverRate,
          周转评分: turnoverRate > 2 ? '高' : (turnoverRate > 0.5 ? '中' : '低')
        };
      });
    } else {
      rows = inventory.map((item) => ({
        产品编号: item.id,
        产品名称: item.name,
        分类: item.category,
        规格: item.spec,
        物理库存: item.stock,
        可用库存: item.available_stock || 0,
        零售仓库存: item.retail_stock || 0,
        单位: item.unit,
        单价: item.price,
        来源: item.source
      }));
    }

    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, sheet, REPORT_TYPES[reportType] || '数据导出');
    XLSX.writeFile(workbook, `鑫威-${REPORT_TYPES[reportType] || '报表'}-${new Date().toISOString().slice(0, 10)}.xlsx`);
    setGeneratedAt(new Date());
  };

  return (
    <div className="space-y-6" data-component="reports-page">
      <div className="flex items-start justify-between gap-4">
        <SectionHeading title="报表导出" subtitle="基于云端库存和操作记录生成可下载报表" />
        <button type="button" onClick={loadReports} className="btn-secondary flex items-center gap-2 whitespace-nowrap" disabled={loading}>
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />刷新数据
        </button>
      </div>

      {error && <div className="card p-4 bg-red-50 border-red-100 text-sm text-red-600">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="card p-5 bg-gradient-to-br from-blue-500 to-blue-600 text-white">
          <FilePieChart size={32} className="mb-4 opacity-80" />
          <h4 className="text-2xl font-bold mb-1">{reportRows.length}</h4>
          <p className="text-xs text-blue-100">当前报表数据条数</p>
        </div>
        <div className="card p-5">
          <BarChart3 size={32} className="mb-4 text-blue-600 opacity-70" />
          <h4 className="text-2xl font-bold mb-1">{inventory.length}</h4>
          <p className="text-xs text-[var(--color-text-muted)]">云端库存 SKU 数</p>
        </div>
        <div className="card p-5">
          <FileText size={32} className="mb-4 text-blue-600 opacity-70" />
          <h4 className="text-2xl font-bold mb-1">{activity.length}</h4>
          <p className="text-xs text-[var(--color-text-muted)]">已记录操作数</p>
        </div>
      </div>

      <div className="card p-4 flex flex-col md:flex-row md:items-end gap-4">
        <div className="flex-1">
          <label className="block text-xs font-bold text-[var(--color-text-muted)] mb-2">报表类型</label>
          <select className="input-field" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
            {Object.entries(REPORT_TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className="flex-1">
          <label className="block text-xs font-bold text-[var(--color-text-muted)] mb-2">操作记录时间范围</label>
          <select className="input-field" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)}>
            <option value="30">最近 30 天</option>
            <option value="90">最近 90 天</option>
            <option value="all">全部记录</option>
          </select>
        </div>
        <button type="button" onClick={() => downloadReport(typeFilter === 'all' ? 'inventory' : typeFilter)} disabled={loading || reportRows.length === 0} className="btn-primary flex items-center justify-center gap-2 disabled:opacity-50">
          <Download size={18} />生成并下载 Excel
        </button>
      </div>

      <div className="card">
        <div className="p-4 border-b border-[var(--color-border)] flex items-center justify-between bg-gray-50/50">
          <div><h3 className="font-bold text-sm">报表预览</h3><p className="text-xs text-[var(--color-text-muted)] mt-1">筛选结果：{reportRows.length} 条</p></div>
          {generatedAt && <span className="text-xs text-emerald-600">已生成：{generatedAt.toLocaleTimeString('zh-CN', { hour12: false })}</span>}
        </div>
        {loading ? (
          <div className="p-12 flex items-center justify-center gap-2 text-sm text-[var(--color-text-muted)]"><LoaderCircle size={18} className="animate-spin" />正在读取云端数据...</div>
        ) : reportRows.length === 0 ? (
          <div className="p-12 text-center text-sm text-[var(--color-text-muted)]">当前筛选条件下暂无报表数据</div>
        ) : (
          <div className="divide-y divide-[var(--color-border)]">
            {reportRows.slice(0, 12).map((row, index) => {
              const isActivity = Boolean(row.detail);
              return (
                <div key={`${isActivity ? row.id : row.id}-${index}`} className="p-4 flex items-center justify-between gap-4 hover:bg-gray-50/50">
                  <div className="flex items-center gap-4 min-w-0"><div className="p-2 bg-blue-50 text-[var(--color-primary)] rounded"><FileText size={20} /></div><div className="min-w-0"><p className="text-sm font-semibold truncate">{isActivity ? row.item : row.name}</p><p className="text-[10px] text-[var(--color-text-muted)] truncate">{isActivity ? `${row.actor || '系统'} · ${row.detail}` : `${row.id} · ${row.category} · 库存 ${row.stock}`}</p></div></div>
                  <button type="button" onClick={() => downloadReport(isActivity ? 'activity' : 'inventory')} className="p-2 text-[var(--color-primary)] hover:bg-blue-50 rounded-lg" title="下载此类报表"><Download size={18} /></button>
                </div>
              );
            })}
          </div>
        )}
        <div className="p-4 bg-gray-50/50 border-t border-[var(--color-border)] text-center"><p className="text-[10px] text-[var(--color-text-muted)] flex items-center justify-center gap-2"><Lock size={12} /> 报表导出仅对管理员开放</p></div>
      </div>
    </div>
  );
};

export default ReportsPage;
