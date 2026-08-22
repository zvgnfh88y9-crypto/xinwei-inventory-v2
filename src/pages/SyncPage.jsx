import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import SectionHeading from '../components/common/SectionHeading';
import SyncUploader from '../components/sync/SyncUploader';
import AccountSecurity from '../components/sync/AccountSecurity';
import { History, LoaderCircle, X, Download, ShieldCheck, ListTodo, Key } from 'lucide-react';
import { listActivity, listAuditLogs } from '../lib/inventoryApi';
import * as XLSX from 'xlsx';

const formatActivityTime = (value) => {
  if (!value) return '';
  const parsedTime = new Date(value);
  if (Number.isNaN(parsedTime.getTime())) return value;

  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(parsedTime).replace(/\//g, '-');
};

const SyncPage = ({ user }) => {
  const [batches, setBatches] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [activeTab, setActiveTab] = useState('sync'); // 'sync', 'audit', 'accounts'

  const load = async () => {
    setLoading(true);
    try {
      const data = await listActivity();
      setBatches(data.batches || []);
      if (user.role === 'admin') {
        const logs = await listAuditLogs();
        setAuditLogs(logs.logs || []);
      }
    } catch (e) {
      console.error('加载数据失败', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const downloadErrorReport = (batch) => {
    const errors = batch.error_log || [];
    if (errors.length === 0) return;
    
    const rows = errors.map(err => ({
      行号: err.excelRow || '未知',
      产品编号: err.sku,
      产品名称: err.name,
      失败原因: err.error
    }));

    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, sheet, '导入错误明细');
    XLSX.writeFile(workbook, `导入错误报告-${batch.batch_no}.xlsx`);
  };

  return (
    <div className="space-y-6" data-component="sync-page">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <SectionHeading 
          title="系统管理中心" 
          subtitle="数据同步、安全审计及企业级合规管理"
        />
        <div className="flex items-center gap-2 p-1 bg-gray-100 rounded-lg">
          <button onClick={() => setActiveTab('sync')} className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${activeTab === 'sync' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}>数据同步</button>
          <button onClick={() => setActiveTab('audit')} className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${activeTab === 'audit' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}>安全审计</button>
          {user.role === 'admin' && (
            <button onClick={() => setActiveTab('accounts')} className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${activeTab === 'accounts' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}>账号安全</button>
          )}
        </div>
      </div>

      {activeTab === 'sync' && (
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
          <div className="xl:col-span-3">
            <SyncUploader user={user} onComplete={load} />
          </div>

          <div className="space-y-6">
            <div className="card">
              <div className="p-4 border-b border-[var(--color-border)] flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold text-sm">
                  <History size={16} className="text-[var(--color-primary)]" />
                  近期导入批次
                </div>
              </div>
              <div className="p-4 space-y-4">
                {loading ? (
                  <div className="flex items-center justify-center gap-2 py-6 text-xs text-[var(--color-text-muted)]">
                    <LoaderCircle size={15} className="animate-spin" />正在加载
                  </div>
                ) : batches.length === 0 ? (
                  <p className="py-6 text-center text-xs text-[var(--color-text-muted)]">暂无导入批次记录</p>
                ) : batches.map((batch) => (
                  <div 
                    key={batch.id} 
                    onClick={() => setSelectedBatch(batch)}
                    className="p-3 bg-gray-50 rounded-lg border border-gray-100 hover:border-blue-200 cursor-pointer transition-all"
                  >
                    <div className="flex justify-between items-start mb-2">
                      <p className="text-[10px] font-black text-blue-600 uppercase">{batch.batch_no}</p>
                      <span className="text-[9px] text-gray-400">{formatActivityTime(batch.created_at)}</span>
                    </div>
                    <p className="text-xs font-bold text-gray-800 truncate mb-1" title={batch.file_name}>{batch.file_name}</p>
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] font-bold text-emerald-600">成功: {batch.success_rows}</span>
                      <span className={`text-[10px] font-bold ${batch.failed_rows > 0 ? 'text-red-500 underline' : 'text-gray-400'}`}>失败: {batch.failed_rows}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'audit' && (
        <div className="card overflow-hidden">
          <div className="p-4 border-b flex items-center gap-2 bg-gray-50/50">
            <ShieldCheck size={18} className="text-blue-600" />
            <h3 className="text-sm font-bold">系统操作审计日志 (仅管理员)</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-gray-50 text-gray-500 uppercase">
                <tr>
                  <th className="px-4 py-3">时间</th>
                  <th className="px-4 py-3">操作人</th>
                  <th className="px-4 py-3">动作</th>
                  <th className="px-4 py-3">资源</th>
                  <th className="px-4 py-3">详情</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {auditLogs.map(log => (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 whitespace-nowrap">{formatActivityTime(log.created_at)}</td>
                    <td className="px-4 py-3 font-medium">{log.actor_name}</td>
                    <td className="px-4 py-3"><span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-bold">{log.action_type}</span></td>
                    <td className="px-4 py-3 text-gray-400">{log.resource_type} / {log.resource_id}</td>
                    <td className="px-4 py-3 text-gray-600">{log.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'accounts' && <AccountSecurity />}

      {/* Batch Detail Modal */}
      {selectedBatch && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl animate-in zoom-in-95">
            <div className="p-6 border-b flex justify-between items-center bg-gray-50">
              <div>
                <h3 className="text-lg font-bold">导入批次详情</h3>
                <p className="text-xs text-gray-500">{selectedBatch.batch_no} · {selectedBatch.file_name}</p>
              </div>
              <button onClick={() => setSelectedBatch(null)} className="p-2 hover:bg-gray-200 rounded-full"><X size={20} /></button>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-3 gap-4 mb-8">
                <div className="p-4 rounded-xl bg-blue-50 border border-blue-100">
                  <p className="text-[10px] font-bold text-blue-600 uppercase mb-1">总计行数</p>
                  <p className="text-2xl font-black">{selectedBatch.total_rows}</p>
                </div>
                <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-100">
                  <p className="text-[10px] font-bold text-emerald-600 uppercase mb-1">成功导入</p>
                  <p className="text-2xl font-black">{selectedBatch.success_rows}</p>
                </div>
                <div className="p-4 rounded-xl bg-red-50 border border-red-100">
                  <p className="text-[10px] font-bold text-red-600 uppercase mb-1">失败记录</p>
                  <p className="text-2xl font-black">{selectedBatch.failed_rows}</p>
                </div>
              </div>

              {selectedBatch.failed_rows > 0 ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-bold flex items-center gap-2"><ListTodo size={16} /> 错误明细表</h4>
                    <button onClick={() => downloadErrorReport(selectedBatch)} className="btn-secondary py-1.5 px-3 text-xs flex items-center gap-2"><Download size={14} /> 导出错误报告</button>
                  </div>
                  <div className="max-h-60 overflow-y-auto border rounded-lg">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="px-3 py-2">行号</th>
                          <th className="px-3 py-2">SKU</th>
                          <th className="px-3 py-2">错误原因</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {Array.isArray(selectedBatch.error_log) ? selectedBatch.error_log.map((err, i) => (
                          <tr key={i} className="hover:bg-red-50/30">
                            <td className="px-3 py-2 font-mono text-gray-400">{err.excelRow || '-'}</td>
                            <td className="px-3 py-2 font-bold">{err.sku}</td>
                            <td className="px-3 py-2 text-red-500">{err.error}</td>
                          </tr>
                        )) : (
                          <tr><td colSpan={3} className="px-3 py-4 text-center text-gray-400">无结构化错误日志</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="py-12 text-center flex flex-col items-center gap-3">
                  <div className="h-12 w-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center"><ShieldCheck size={24} /></div>
                  <p className="text-sm font-medium text-emerald-700">此批次全部校验通过，数据一致性良好。</p>
                </div>
              )}
            </div>
            <div className="p-4 bg-gray-50 border-t text-right">
              <button onClick={() => setSelectedBatch(null)} className="btn-secondary px-6">关闭窗口</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SyncPage;
