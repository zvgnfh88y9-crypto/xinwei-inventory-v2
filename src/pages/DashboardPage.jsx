import React, { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, ArrowDownRight, Clock, ChevronRight, Pencil, X, Info, Package, MapPin, Tag, LoaderCircle, CheckCircle, AlertTriangle, Bell, Plus, Truck, ClipboardList, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import SectionHeading from '../components/common/SectionHeading';
import StatCard from '../components/dashboard/StatCard';
import { listActivity, getInventorySummary, listInventory } from '../lib/inventoryApi';
import { getWorkflowHomeSummary } from '../lib/workflowApi';
import { CLOUD_INVENTORY_UPDATED_EVENT } from '../data/inventoryStore';

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

const DashboardPage = ({ user }) => {
  const [summary, setSummary] = useState({ metrics: {}, distribution: [] });
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewingProduct, setViewingProduct] = useState(null);
  const [loadingProduct, setLoadingProduct] = useState(false);
  const [viewingAlert, setViewingAlert] = useState(null);
  const [alertProducts, setAlertProducts] = useState([]);
  const [loadingAlert, setLoadingAlert] = useState(false);
  const [workflowHome, setWorkflowHome] = useState({ counts: {}, tasks: [] });
  const [dashboardError, setDashboardError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  const handleViewProduct = async (sku) => {
    setLoadingProduct(true);
    try {
      const { products } = await listInventory({ search: sku, pageSize: 1 });
      if (products && products.length > 0) {
        setViewingProduct(products[0]);
      } else {
        alert('未在当前库存中找到该产品');
      }
    } catch (e) {
      alert('加载产品详情失败');
    } finally {
      setLoadingProduct(false);
    }
  };

  const handleViewAlert = async (alert) => {
    if (alert.count === 0) return;
    setViewingAlert(alert);
    setLoadingAlert(true);
    try {
      // 这里的 status 参数必须对应后端 statusForStock 函数返回的英文值
      const statusMap = {
        low_stock: 'Low Stock',
        out_of_stock: 'Out of Stock'
      };
      const { products } = await listInventory({ status: statusMap[alert.type], pageSize: 100 });
      setAlertProducts(products || []);
    } catch (e) {
      alert('加载预警明细失败');
    } finally {
      setLoadingAlert(false);
    }
  };

  const [lastSyncTime, setLastSyncTime] = useState(new Date().toLocaleTimeString());

  useEffect(() => {
    let active = true;
    const loadDashboard = async () => {
      setLoading(true);
      setDashboardError('');
      try {
        const showInventory = user.role !== 'staff';
        const [homeData, stats, activitiesData] = await Promise.all([
          getWorkflowHomeSummary(),
          showInventory ? getInventorySummary() : Promise.resolve({ metrics: {}, distribution: [] }),
          showInventory ? listActivity() : Promise.resolve([])
        ]);
        if (active) {
          setWorkflowHome(homeData || { counts: {}, tasks: [] });
          setSummary(stats);
          setActivity((activitiesData.activity || activitiesData || []).slice(0, 15));
          setLastSyncTime(new Date().toLocaleTimeString());
        }
      } catch (err) {
        console.error('加载看板失败:', err);
        if (active) setDashboardError(err.message || '工作台加载失败');
      } finally {
        if (active) setLoading(false);
      }
    };

    loadDashboard();
    window.addEventListener(CLOUD_INVENTORY_UPDATED_EVENT, loadDashboard);
    return () => {
      active = false;
      window.removeEventListener(CLOUD_INVENTORY_UPDATED_EVENT, loadDashboard);
    };
  }, [reloadKey, user.role]);

  const isAdmin = user.role === 'admin';
  const isWarehouseKeeper = ['warehouse_keeper', 'inv_manager'].includes(user.role);
  const showInventoryOverview = user.role !== 'staff';
  const roleTitle = isAdmin ? '管理员决策工作台' : isWarehouseKeeper ? '仓管专业复核工作台' : '我的申请工作台';
  const countCards = isAdmin ? [
    { key: 'final_review', label: '待最终审核', tone: 'rose' },
    { key: 'ready_to_post', label: '终审通过·待入账', tone: 'amber' },
    { key: 'posted_today', label: '今日已执行', tone: 'emerald' },
    { key: 'rejected', label: '已驳回事项', tone: 'slate' }
  ] : isWarehouseKeeper ? [
    { key: 'professional_review', label: '待专业复核', tone: 'rose' },
    { key: 'reviewed_today', label: '今日已复核', tone: 'emerald' },
    { key: 'awaiting_admin', label: '待管理员终审', tone: 'amber' },
    { key: 'rejected', label: '已驳回事项', tone: 'slate' }
  ] : [
    { key: 'drafts', label: '我的草稿', tone: 'slate' },
    { key: 'reviewing', label: '审核进行中', tone: 'amber' },
    { key: 'rejected', label: '需要修改', tone: 'rose' },
    { key: 'approved', label: '已批准/完成', tone: 'emerald' }
  ];
  const quickActions = isAdmin ? [
    { label: '处理最终审核', to: '/approval', icon: ShieldCheck },
    { label: '处理待入账', to: '/approval', icon: CheckCircle },
    { label: '查看主库存', to: '/inventory', icon: Package },
    { label: '系统管理', to: '/sync', icon: ClipboardList }
  ] : isWarehouseKeeper ? [
    { label: '开始专业复核', to: '/approval', icon: ShieldCheck },
    { label: '查看入库单', to: '/inbound', icon: Plus },
    { label: '查看出库单', to: '/outbound', icon: Truck },
    { label: '查询库存', to: '/inventory', icon: Package }
  ] : [
    { label: '申请入库', to: '/inbound', icon: Plus },
    { label: '申请出库', to: '/outbound', icon: Truck },
    { label: '查看我的申请', to: '/approval', icon: Bell },
    { label: '往来单位', to: '/partners', icon: ClipboardList }
  ];
  const workflowStatusLabel = { draft: '草稿', pending: '待仓管复核', warehouse_approved: '待管理员终审', approved: '终审通过·待执行', rejected: '已驳回·待修改' };

  const metrics = summary.metrics || {};
  const kpiStats = [
    { label: '库存 SKU 总数', value: (metrics.sku_count || 0).toLocaleString(), color: 'blue', icon: 'Box', unit: '个', detail: '系统内录入的所有唯一产品编号总数。' },
    { label: '物理总件数', value: (metrics.total_stock || 0).toLocaleString(), color: 'green', icon: 'Package', unit: '件', detail: '仓库内实际存在的货物总数（含锁定、次品）。' },
    { label: '可用库存总量', value: (metrics.available_stock || 0).toLocaleString(), color: 'indigo', icon: 'CheckCircle', unit: '件', detail: '可用库存 = 物理总数 - 锁定(订单中) - 待检 - 次品。' },
    { label: '库存总金额', value: `¥${(metrics.total_value || 0).toLocaleString()}`, color: 'blue', icon: 'Tag', unit: '元', detail: '当前物理库存按产品档案单价折算的资产总额。' },
  ];

  const alerts = [
    { label: '低库存预警', count: metrics.low_stock_count || 0, color: 'yellow', type: 'low_stock' },
    { label: '缺货/零库存', count: metrics.out_of_stock_count || 0, color: 'red', type: 'out_of_stock' },
  ];

  const categoryDistribution = useMemo(() => {
    const raw = summary.distribution || [];
    const categoryColors = ['#2563eb', '#60a5fa', '#93c5fd', '#dbeafe', '#bfdbfe', '#3b82f6'];
    
    let currentOffset = 0;
    return raw.map((item, index) => {
      const color = categoryColors[index % categoryColors.length];
      const offset = currentOffset;
      currentOffset -= item.value;
      return { ...item, color, offset };
    });
  }, [summary.distribution]);

  const maxCategoryTotal = Math.max(...categoryDistribution.map((category) => category.total), 1);

  if (loading && !workflowHome.tasks?.length && !summary.metrics.sku_count) {
    return <div className="p-20 text-center text-sm text-gray-500 flex flex-col items-center gap-3"><LoaderCircle size={32} className="animate-spin text-blue-600" /> 正在为您极速汇总云端库存看板...</div>;
  }

  return (
    <div className="space-y-8" data-component="dashboard-page">
      <SectionHeading
        title={roleTitle}
        subtitle={`数据最后同步时间：${lastSyncTime}`}
        badge={loading ? '同步中' : '服务在线'}
      />

      {dashboardError && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700 flex flex-wrap items-center justify-between gap-3"><span><AlertTriangle size={16} className="inline mr-2" />{dashboardError}</span><button type="button" onClick={() => setReloadKey((value) => value + 1)} className="btn-secondary px-4 py-2">重新加载</button></div>}

      <section className="card overflow-hidden" aria-label="角色待办工作台">
        <div className="bg-gradient-to-r from-blue-600 to-indigo-700 p-5 text-white">
          <div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-black">今天需要处理什么</h2><p className="mt-1 text-xs text-blue-100">按您的身份自动整理申请、审核和执行事项</p></div><Link to="/approval" className="rounded-lg bg-white/15 px-3 py-2 text-xs font-black hover:bg-white/25">查看全部</Link></div>
          <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {countCards.map((item) => <Link key={item.key} to="/approval" className="rounded-xl border border-white/15 bg-white/10 p-3 hover:bg-white/20"><p className="text-xs text-blue-100">{item.label}</p><p className="mt-1 text-2xl font-black">{Number(workflowHome.counts?.[item.key] || 0).toLocaleString()}</p></Link>)}
          </div>
        </div>
        <div className="grid gap-6 p-5 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <div className="mb-3 flex items-center justify-between"><h3 className="font-black flex items-center gap-2"><Bell size={18} className="text-blue-600" />我的待办</h3><span className="text-[10px] font-bold text-gray-400">最多显示 6 项</span></div>
            <div className="space-y-2">
              {(workflowHome.tasks || []).length === 0 ? <div className="rounded-xl border border-dashed p-8 text-center text-sm text-gray-400"><CheckCircle size={24} className="mx-auto mb-2 text-emerald-500" />当前没有待处理事项</div> : workflowHome.tasks.map((task) => {
                const inbound = ['receipt', 'production_in'].includes(task.document_type);
                const route = user.role === 'staff' ? (inbound ? '/inbound' : '/outbound') : '/approval';
                return <Link key={task.id} to={`${route}?document=${encodeURIComponent(task.id)}`} className="flex items-center justify-between gap-3 rounded-xl border p-3 hover:border-blue-300 hover:bg-blue-50/40"><div className="min-w-0"><p className="truncate text-sm font-black">{task.doc_no}</p><p className="mt-1 truncate text-xs text-gray-500">{inbound ? '收货/入库' : '发货/出库'} · {task.partner_name || '未填写往来单位'} · {task.business_date}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-black ${task.status === 'rejected' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'}`}>{workflowStatusLabel[task.status] || task.status}</span></Link>;
              })}
            </div>
          </div>
          <div>
            <h3 className="mb-3 font-black">快捷操作</h3>
            <div className="grid grid-cols-2 gap-3">
              {quickActions.map((action) => <Link key={action.label} to={action.to} className="rounded-xl border p-4 text-center hover:border-blue-300 hover:bg-blue-50"><action.icon size={22} className="mx-auto mb-2 text-blue-600" /><span className="text-xs font-black">{action.label}</span></Link>)}
            </div>
          </div>
        </div>
      </section>

      {showInventoryOverview && <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {kpiStats.map((stat, index) => <StatCard key={index} {...stat} />)}
      </div>}

      {showInventoryOverview && <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {alerts.map((alert) => (
          <div 
            key={alert.type} 
            className={`p-4 rounded-xl border flex items-center justify-between transition-all ${alert.count > 0 ? (alert.color === 'red' ? 'bg-red-50 border-red-100 text-red-700 cursor-pointer hover:shadow-md' : 'bg-amber-50 border-amber-100 text-amber-700 cursor-pointer hover:shadow-md') : 'bg-gray-50 border-gray-100 text-gray-400'}`}
            onClick={() => handleViewAlert(alert)}
          >
            <div className="flex flex-col">
              <span className="text-[10px] font-bold uppercase tracking-wider">{alert.label}</span>
              <span className="text-xl font-black">{alert.count}</span>
            </div>
            {alert.count > 0 && (
              <div className={`p-2 rounded-lg bg-white/50 hover:bg-white transition-colors`}>
                <ChevronRight size={16} />
              </div>
            )}
          </div>
        ))}
      </div>}

      {showInventoryOverview && <div className="card p-6" data-component="inventory-category-analysis">
        <div className="flex items-start justify-between gap-3 mb-6">
          <div>
            <h3 className="font-bold">库存分类分析</h3>
            <p className="text-xs text-[var(--color-text-muted)] mt-1">分类占比与各类库存总量实时同步</p>
          </div>
          <span className="text-xs font-semibold text-[var(--color-primary)] bg-blue-50 px-2 py-1 rounded-full whitespace-nowrap">实时更新</span>
        </div>

        {categoryDistribution.length === 0 ? (
          <div className="h-56 flex items-center justify-center text-sm text-[var(--color-text-muted)]">暂无分类库存数据</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:divide-x lg:divide-[var(--color-border)]">
            <section className="flex flex-col items-center justify-center text-center lg:pr-8" aria-label="库存分类占比">
              <h4 className="self-start font-semibold text-sm mb-5">库存分类占比</h4>
              <div className="relative h-48 w-48 aspect-square flex-shrink-0 mb-6">
                <svg viewBox="0 0 36 36" className="w-full h-full transform -rotate-90" role="img" aria-label="库存分类占比环形图">
                  <circle cx="18" cy="18" r="15.9155" fill="none" stroke="#f1f5f9" strokeWidth="4" />
                  {categoryDistribution.map((item) => (
                    <circle
                      key={item.name}
                      cx="18"
                      cy="18"
                      r="15.9155"
                      fill="none"
                      stroke={item.color}
                      strokeWidth="4"
                      strokeDasharray={`${item.value} ${100 - item.value}`}
                      strokeDashoffset={item.offset}
                      className="cursor-help"
                    >
                      <title>{`${item.name}：${item.total.toLocaleString()} 件，占比 ${item.value}%`}</title>
                    </circle>
                  ))}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-bold text-[var(--color-text-base)]">{(metrics.total_stock || 0).toLocaleString()}</span>
                  <span className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider">当前库存总量</span>
                </div>
              </div>
              <div className="w-full grid grid-cols-2 gap-3">
                {categoryDistribution.map((item) => (
                  <div key={item.name} className="flex items-center gap-2 text-left" title={`${item.name}：${item.total.toLocaleString()} 件，占比 ${item.value}%`}>
                    <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: item.color }} />
                    <div className="flex flex-col min-w-0">
                      <span className="text-xs font-semibold text-[var(--color-text-base)] truncate">{item.name}</span>
                      <span className="text-[10px] text-[var(--color-text-muted)]">{item.total.toLocaleString()} 件 · {item.value}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="lg:pl-8" aria-label="各类产品库存汇总">
              <div className="flex items-center justify-between mb-5">
                <h4 className="font-semibold text-sm">各类产品库存汇总</h4>
                <span className="text-[10px] text-[var(--color-text-muted)]">单位：件</span>
              </div>
              <div className="h-56 flex items-end gap-3 md:gap-6 border-b border-l border-[var(--color-border)] px-3">
                {categoryDistribution.map((item) => {
                  const height = Math.max(8, Math.round((item.total / maxCategoryTotal) * 100));
                  return (
                    <div key={item.name} className="flex-1 h-full flex flex-col items-center justify-end gap-2 group" title={`${item.name}：${item.total.toLocaleString()} 件`}>
                      <span className="text-[10px] text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">{item.total.toLocaleString()} 件</span>
                      <div className="w-full max-w-16 rounded-t-lg transition-all duration-300 group-hover:opacity-80" style={{ height: `${height}%`, backgroundColor: item.color }} />
                      <span className="text-xs text-[var(--color-text-muted)] truncate max-w-full">{item.name}</span>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        )}
      </div>}

      {showInventoryOverview && <div className="card h-full" data-component="recent-inventory-activity">
        <div className="p-5 border-b border-[var(--color-border)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock size={20} className="text-[var(--color-primary)]" />
            <h3 className="font-bold">近期库存变动</h3>
          </div>
          <Link to="/inventory" className="text-xs font-bold text-[var(--color-primary)] hover:underline flex items-center gap-1">查看库存 <ChevronRight size={14} /></Link>
        </div>
        <div className="divide-y divide-[var(--color-border)]">
          {activity.length === 0 && <div className="p-10 text-center text-sm text-[var(--color-text-muted)]">暂无库存操作记录</div>}
            {activity.map((change) => {
              const isEdit = change.type === 'EDIT';
              const isIn = change.type === 'IN';

              return (
                <div 
                  key={change.id} 
                  className="p-4 flex items-center justify-between hover:bg-gray-50/50 transition-colors cursor-pointer group"
                  onClick={() => handleViewProduct(change.sku)}
                >
                  <div className="flex items-center gap-4">
                    <div className={`p-2 rounded-full ${isEdit ? 'bg-blue-50 text-blue-600' : (isIn ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600')}`}>
                      {isEdit ? <Pencil size={18} /> : (isIn ? <ArrowUpRight size={18} /> : <ArrowDownRight size={18} />)}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-[var(--color-text-base)] group-hover:text-blue-600 transition-colors">{change.item}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">{change.actor ? `${change.actor} · ` : ''}{change.detail || change.time}</p>
                      {change.changes && <p className="text-[10px] text-blue-600 mt-1 leading-relaxed">修改内容：{change.changes}</p>}
                      {change.detail && <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{formatActivityTime(change.time)}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className={`text-sm font-bold ${isEdit ? 'text-blue-600' : (isIn ? 'text-emerald-600' : 'text-red-600')}`}>{change.qty}</div>
                    {loadingProduct ? <LoaderCircle size={14} className="animate-spin text-blue-400" /> : <ChevronRight size={14} className="text-gray-300 opacity-0 group-hover:opacity-100 transition-all" />}
                  </div>
                </div>
              );
            })}
        </div>
      </div>}

      {/* Product Quick View Modal */}
      {viewingProduct && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="bg-blue-600 p-6 text-white flex justify-between items-center">
              <div>
                <h3 className="text-xl font-bold">产品实时详情</h3>
                <p className="text-blue-100 text-xs mt-1">查看该产品在库的当前状态与规格</p>
              </div>
              <button onClick={() => setViewingProduct(null)} className="p-2 hover:bg-white/20 rounded-full transition-colors">
                <X size={24} />
              </button>
            </div>
            
            <div className="p-6">
              <div className="flex gap-6 mb-8">
                <div className="w-24 h-24 rounded-lg border border-[var(--color-border)] bg-gray-50 flex-shrink-0 overflow-hidden">
                  <img 
                    src={viewingProduct.image || '/assets/images/placeholder.svg'} 
                    alt={viewingProduct.name}
                    className="w-full h-full object-contain"
                  />
                </div>
                <div className="flex-grow">
                  <p className="text-xs font-bold text-blue-600 uppercase tracking-wider">{viewingProduct.sku || viewingProduct.id}</p>
                  <h4 className="text-lg font-bold text-[var(--color-text-base)] mt-1">{viewingProduct.name}</h4>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs bg-gray-100 px-2 py-0.5 rounded text-gray-600">{viewingProduct.category}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                      viewingProduct.stock <= 0 ? 'bg-red-100 text-red-600' : (viewingProduct.stock <= 100 ? 'bg-amber-100 text-amber-600' : 'bg-emerald-100 text-emerald-600')
                    }`}>
                      {viewingProduct.status || '有库存'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-y-6 gap-x-8 text-sm">
                <div className="flex items-start gap-3">
                  <Package className="text-gray-400 mt-0.5" size={18} />
                  <div>
                    <p className="text-[10px] font-bold text-gray-500 uppercase">当前库存</p>
                    <p className="font-bold text-lg text-[var(--color-text-base)] mt-0.5">{(viewingProduct.stock || 0).toLocaleString()} <span className="text-xs font-normal text-gray-500">{viewingProduct.unit}</span></p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Tag className="text-gray-400 mt-0.5" size={18} />
                  <div>
                    <p className="text-[10px] font-bold text-gray-500 uppercase">当前单价</p>
                    <p className="font-bold text-lg text-[var(--color-text-base)] mt-0.5">¥{Number(viewingProduct.price || 0).toFixed(2)}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Info className="text-gray-400 mt-0.5" size={18} />
                  <div>
                    <p className="text-[10px] font-bold text-gray-500 uppercase">规格参数</p>
                    <p className="font-medium text-gray-700 mt-0.5">{viewingProduct.spec || '未填写规格'}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <MapPin className="text-gray-400 mt-0.5" size={18} />
                  <div>
                    <p className="text-[10px] font-bold text-gray-500 uppercase">默认来源</p>
                    <p className="font-medium text-gray-700 mt-0.5">{viewingProduct.source || '内部生产'}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-6 bg-gray-50 border-t flex justify-end">
              <Link 
                to="/inventory" 
                className="btn-primary px-6 py-2 flex items-center gap-2"
                onClick={() => {
                  localStorage.setItem('xinwei_pending_edit', viewingProduct.sku || viewingProduct.id);
                  setViewingProduct(null);
                }}
              >
                进入库存管理编辑 <ChevronRight size={16} />
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Alert Detail Modal */}
      {viewingAlert && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className={`p-6 text-white flex justify-between items-center ${viewingAlert.color === 'red' ? 'bg-red-600' : 'bg-amber-500'}`}>
              <div>
                <h3 className="text-xl font-bold">{viewingAlert.label}明细</h3>
                <p className="opacity-90 text-xs mt-1">共检测到 {viewingAlert.count} 个异常产品 SKU</p>
              </div>
              <button onClick={() => { setViewingAlert(null); setAlertProducts([]); }} className="p-2 hover:bg-white/20 rounded-full">
                <X size={24} />
              </button>
            </div>

            <div className="max-h-[60vh] overflow-y-auto p-4">
              {loadingAlert ? (
                <div className="py-20 flex flex-col items-center gap-3">
                  <LoaderCircle size={32} className="animate-spin text-blue-500" />
                  <p className="text-xs font-bold text-gray-400 uppercase">正在拉取异常明细...</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {alertProducts.map(p => (
                    <div 
                      key={p.sku} 
                      className="p-3 bg-gray-50 border border-gray-100 rounded-lg hover:border-blue-200 hover:bg-white transition-all cursor-pointer group"
                      onClick={() => handleViewProduct(p.sku)}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <span className="text-[10px] font-black text-blue-600 uppercase">{p.sku}</span>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${p.stock <= 0 ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'}`}>
                          {p.stock.toLocaleString()} {p.unit}
                        </span>
                      </div>
                      <p className="text-sm font-bold text-gray-800 truncate mb-1">{p.name}</p>
                      <div className="flex justify-between items-center text-[10px] text-gray-500">
                        <span>分类：{p.category}</span>
                        <span className="text-blue-500 font-bold opacity-0 group-hover:opacity-100">查看详情 →</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-4 bg-gray-50 border-t flex justify-end gap-3">
              <button onClick={() => { setViewingAlert(null); setAlertProducts([]); }} className="btn-secondary px-6">关闭窗口</button>
              <Link 
                to="/inventory" 
                className="btn-primary px-6"
                onClick={() => { setViewingAlert(null); setAlertProducts([]); }}
              >
                前往主库存处理
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardPage;
