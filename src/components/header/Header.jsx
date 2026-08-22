import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, RefreshCw, ClipboardList, LogOut, User, Menu, X, AlertTriangle, AlertCircle, Bell, Plus, Truck, Factory, PackageCheck, Building2 } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { listWorkflowDocuments, listWorkflowNotifications, markAllWorkflowNotificationsRead, markWorkflowNotificationRead } from '../../lib/workflowApi';

const Header = ({ user, onLogout }) => {
  const roleLabel = user.role === 'admin'
    ? '系统管理员'
    : ['warehouse_keeper', 'inv_manager'].includes(user.role)
      ? '仓管员'
      : '员工';
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [otherUsersCount, setOtherUsersCount] = useState(0);
  const [notifications, setNotifications] = useState([]);
  const [workflowNotifications, setWorkflowNotifications] = useState([]);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [notificationCenterOpen, setNotificationCenterOpen] = useState(false);
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);
  const [notificationPermission, setNotificationPermission] = useState(() => typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  const [isKicked, setIsKicked] = useState(false);
  const [showForceConfirm, setShowForceConfirm] = useState(false);
  const [sessionId] = useState(() => Math.random().toString(36).substring(7));
  const hasCheckedConflict = React.useRef(false);
  const workflowSnapshotRef = React.useRef(new Map());

  const pushWorkflowNotification = React.useCallback((message, documentId, route) => {
    const notification = { id: `${Date.now()}-${documentId || ''}`, documentId, message, route };
    setNotifications((current) => [notification, ...current].slice(0, 8));
    setTimeout(() => setNotifications((current) => current.filter((item) => item.id !== notification.id)), 8000);
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
      const browserNotification = new Notification('鑫威库存管理系统', { body: message, icon: '/assets/images/logo-xw.png', tag: `workflow-${documentId}` });
      browserNotification.onclick = () => { window.focus(); window.location.hash = `#${route}?document=${encodeURIComponent(documentId)}`; browserNotification.close(); };
    }
  }, []);

  const refreshWorkflowAlerts = React.useCallback(async (notifyChanges = true) => {
    try {
      const documents = await listWorkflowDocuments();
      const nextSnapshot = new Map(documents.map((doc) => [doc.id, doc.status]));
      setPendingApprovalCount(documents.filter((doc) => user.role === 'admin'
        ? ['warehouse_approved', 'approved'].includes(doc.status)
        : ['warehouse_keeper', 'inv_manager'].includes(user.role)
          ? doc.status === 'pending' && doc.submitted_by !== user.id
          : doc.created_by === user.id && ['draft', 'pending', 'warehouse_approved', 'approved', 'rejected'].includes(doc.status)).length);
      if (notifyChanges && workflowSnapshotRef.current.size) {
        documents.forEach((doc) => {
          const previous = workflowSnapshotRef.current.get(doc.id);
          const route = ['receipt', 'production_in'].includes(doc.document_type) ? '/inbound' : '/outbound';
          if (['warehouse_keeper', 'inv_manager'].includes(user.role) && doc.status === 'pending' && previous !== 'pending') pushWorkflowNotification(`收到待专业复核的${doc.document_type === 'shipment' ? '出库' : '入库'}申请：${doc.doc_no}`, doc.id, '/approval');
          if (user.role === 'admin' && doc.status === 'warehouse_approved' && previous !== 'warehouse_approved') pushWorkflowNotification(`仓管已复核，请管理员终审：${doc.doc_no}`, doc.id, '/approval');
          if (user.role === 'staff' && doc.created_by === user.id && previous && previous !== doc.status) {
            if (doc.status === 'warehouse_approved') pushWorkflowNotification(`仓管已复核，正在等待管理员终审：${doc.doc_no}`, doc.id, route);
            if (doc.status === 'approved') pushWorkflowNotification(`管理员已最终批准：${doc.doc_no}，可以联系仓库办理`, doc.id, route);
            if (doc.status === 'rejected') pushWorkflowNotification(`申请被驳回：${doc.doc_no}，请查看原因并修改`, doc.id, route);
            if (doc.status === 'posted') pushWorkflowNotification(`申请已完成出入库：${doc.doc_no}`, doc.id, route);
          }
        });
      }
      workflowSnapshotRef.current = nextSnapshot;
    } catch (error) {
      console.warn('审批提醒同步失败，将在下一轮重试', error);
    }
  }, [pushWorkflowNotification, user.id, user.role]);

  const refreshPersistentNotifications = React.useCallback(async () => {
    try {
      const result = await listWorkflowNotifications(30);
      setWorkflowNotifications(result.notifications || []);
      setUnreadNotificationCount(Number(result.unread_count || 0));
    } catch (error) {
      console.warn('持久通知加载失败，将在下一轮重试', error);
    }
  }, []);

  const openPersistentNotification = async (notification) => {
    if (!notification.is_read) {
      // 先在界面上即时消除角标，再同步到云端；失败时重新拉取恢复真实状态。
      setWorkflowNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, is_read: true } : item));
      setUnreadNotificationCount((current) => Math.max(0, current - 1));
      try { await markWorkflowNotificationRead(notification.id); } catch (error) { console.warn('通知已读状态保存失败', error); }
    }
    setNotificationCenterOpen(false);
    await refreshPersistentNotifications();
    if (notification.route) {
      window.location.hash = notification.document_id
        ? `#${notification.route}?document=${encodeURIComponent(notification.document_id)}`
        : `#${notification.route}${notification.event_type === 'archive_uploaded' ? '?archive=1' : ''}`;
    }
  };

  const markAllPersistentNotificationsRead = async () => {
    try {
      await markAllWorkflowNotificationsRead();
      await refreshPersistentNotifications();
    } catch (error) {
      console.warn('全部标记已读失败', error);
    }
  };

  useEffect(() => {
    refreshWorkflowAlerts(false);
    const interval = window.setInterval(() => refreshWorkflowAlerts(true), 15000);
    const handleVisibility = () => { if (!document.hidden) refreshWorkflowAlerts(true); };
    document.addEventListener('visibilitychange', handleVisibility);
    if (!supabase) return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', handleVisibility); };
    const workflowChannel = supabase.channel(`workflow-alerts-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_documents' }, () => refreshWorkflowAlerts(true))
      .subscribe();
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
      workflowChannel.unsubscribe();
    };
  }, [refreshWorkflowAlerts, user.id]);

  useEffect(() => {
    refreshPersistentNotifications();
    const interval = window.setInterval(refreshPersistentNotifications, 30000);
    if (!supabase) return () => window.clearInterval(interval);
    const notificationChannel = supabase.channel(`persistent-workflow-notifications-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workflow_notifications', filter: `recipient_id=eq.${user.id}` }, refreshPersistentNotifications)
      .subscribe();
    return () => { window.clearInterval(interval); notificationChannel.unsubscribe(); };
  }, [refreshPersistentNotifications, user.id]);

  const enableNotifications = async () => {
    if (typeof Notification === 'undefined') return;
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
  };

  // 实时在线检测 (Presence) 与 冲突处理
  useEffect(() => {
    if (!supabase || !user) return;

    const channel = supabase.channel('online-status', {
      config: { presence: { key: user.id } }
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const sessions = state[user.id] || [];
        const others = sessions.filter(s => s.sessionId !== sessionId);
        setOtherUsersCount(others.length);

        // 如果是新进入页面，且发现已有其他设备在线，则弹出询问窗口
        if (!hasCheckedConflict.current && others.length > 0) {
          setShowForceConfirm(true);
          hasCheckedConflict.current = true;
        }
      })
      .on('broadcast', { event: 'force_logout' }, ({ payload }) => {
        if (payload.targetUserId === user.id && payload.fromSessionId !== sessionId) {
          setIsKicked(true);
        }
      })
      .on('broadcast', { event: 'inventory_change' }, ({ payload }) => {
        const newNotif = { id: Date.now(), ...payload };
        setNotifications(prev => [newNotif, ...prev].slice(0, 5));
        setTimeout(() => {
          setNotifications(prev => prev.filter(n => n.id !== newNotif.id));
        }, 5000);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ 
            sessionId, 
            online_at: new Date().toISOString(), 
            user_email: user.username 
          });
        }
      });

    return () => { channel.unsubscribe(); };
  }, [user, sessionId]);

  const handleConfirmKick = () => {
    if (!supabase) return;
    // 发送踢人广播
    supabase.channel('online-status').send({
      type: 'broadcast',
      event: 'force_logout',
      payload: { targetUserId: user.id, fromSessionId: sessionId }
    });
    setShowForceConfirm(false);
  };

  const allNavItems = [
    { label: '工作台', path: '/', icon: LayoutDashboard, roles: ['admin', 'inv_manager', 'warehouse_keeper', 'staff'] },
    { label: '入库管理', path: '/inbound', icon: Plus, roles: ['admin', 'inv_manager', 'warehouse_keeper', 'staff'] },
    { label: '出库管理', path: '/outbound', icon: Truck, roles: ['admin', 'inv_manager', 'warehouse_keeper', 'staff'] },
    { label: '往来单位', path: '/partners', icon: Building2, roles: ['admin', 'inv_manager', 'warehouse_keeper', 'staff'] },
    // 菜单角标与顶部铃铛统一表示“未读通知”；待处理数量在审批中心页面内单独展示。
    { label: user.role === 'staff' ? '我的申请' : '审批中心', path: '/approval', icon: Bell, roles: ['admin', 'inv_manager', 'warehouse_keeper', 'staff'], badge: unreadNotificationCount },
    { label: '销售订单', path: '/v2/orders', icon: ClipboardList, roles: ['admin', 'inv_manager', 'staff'] },
    { label: '生产计划', path: '/v2/production', icon: Factory, roles: ['admin', 'inv_manager', 'staff'] },
    { label: '质检中心', path: '/v2/qc', icon: PackageCheck, roles: ['admin', 'inv_manager'] },
    { label: '异常处理', path: '/v2/exceptions', icon: AlertCircle, roles: ['admin', 'inv_manager'] },
    { label: '系统管理', path: '/sync', icon: RefreshCw, roles: ['admin'] },
  ];

  const navItems = allNavItems.filter(item => item.roles.includes(user.role));

  const isActive = (itemPath) => {
    // 处理带参数的路径 (如 /workflow?type=receipt)
    const [path, search] = itemPath.split('?');
    const isPathMatch = location.pathname === path;
    
    if (!search) return isPathMatch;
    
    // 如果有参数，需要路径和参数同时匹配
    return isPathMatch && location.search === `?${search}`;
  };

  const handleLogout = () => onLogout();

  return (
    <>
      {/* Sidebar for Desktop */}
      <aside className="hidden lg:flex flex-col w-64 bg-white border-r border-[var(--color-border)] h-screen sticky top-0" data-component="site-sidebar">
        <div className="p-6 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-3">
            <img src="/assets/images/logo-xw.png" alt="Xin Wei Logo" className="h-10 w-auto" />
            <div>
              <h1 className="text-lg font-bold text-[var(--color-primary)] leading-none">XINWEI</h1>
              <p className="text-[10px] text-[var(--color-text-muted)] mt-1 tracking-widest uppercase">Inventory System</p>
            </div>
          </div>
        </div>

        <nav className="flex-grow p-4 space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                isActive(item.path)
                  ? 'bg-blue-50 text-[var(--color-primary)]'
                  : 'text-[var(--color-text-base)] hover:bg-gray-50'
              }`}
            >
              <item.icon size={20} />
              {item.label}
              {item.badge > 0 && <span className="ml-auto min-w-5 rounded-full bg-red-500 px-1.5 py-0.5 text-center text-[10px] font-black text-white">{item.badge}</span>}
            </Link>
          ))}
        </nav>

        <div className="p-4 border-t border-[var(--color-border)]">
          <button 
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-4 py-3 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          >
            <LogOut size={20} />
            退出系统
          </button>
        </div>
      </aside>

      {/* Top Header for Mobile & Desktop Header Content */}
      <header className="lg:fixed lg:top-0 lg:left-64 lg:right-0 bg-white border-b border-[var(--color-border)] z-20" data-component="site-header">
        {/* 踢下线遮罩弹窗 (旧设备看到) */}
        {isKicked && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-6 text-center">
            <div className="bg-white rounded-2xl p-8 max-w-sm w-full shadow-2xl animate-in zoom-in-95 duration-300">
              <div className="h-16 w-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6 text-red-600">
                <AlertTriangle size={32} />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">登录已失效</h3>
              <p className="text-sm text-gray-500 mb-8 leading-relaxed">
                您的账号刚刚在**另一台新设备**上完成了强制登录。本设备的会话已断开。
              </p>
              <button 
                onClick={handleLogout}
                className="w-full btn-primary py-3 flex items-center justify-center gap-2"
              >
                我知道了，返回登录
              </button>
            </div>
          </div>
        )}

        {/* 顶号确认弹窗 (新设备看到) */}
        {showForceConfirm && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-6 text-center">
            <div className="bg-white rounded-2xl p-8 max-w-sm w-full shadow-2xl animate-in fade-in zoom-in-95 duration-200">
              <div className="h-16 w-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-6 text-amber-600">
                <AlertTriangle size={32} />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">账号正在使用中</h3>
              <p className="text-sm text-gray-500 mb-8 leading-relaxed">
                当前账号已有其他设备在线。是否需要**强制注销对方**并在此登录？
              </p>
              <div className="flex flex-col gap-3">
                <button 
                  onClick={handleConfirmKick}
                  className="w-full btn-primary py-3 font-bold"
                >
                  是，强制顶号登录
                </button>
                <button 
                  onClick={handleLogout}
                  className="w-full btn-secondary py-3 text-gray-600"
                >
                  否，暂不登录
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 多端登录警告条 (仅显示，不阻断) */}
        {!isKicked && !showForceConfirm && otherUsersCount > 0 && (
          <div className="bg-amber-50 border-b border-amber-100 px-4 py-1.5 flex items-center justify-center gap-2 animate-in slide-in-from-top duration-300">
            <AlertTriangle size={14} className="text-amber-600" />
            <span className="text-[10px] font-bold text-amber-700 uppercase tracking-tight">
              注意：当前账号在另外 {otherUsersCount} 台设备也有登录。操作时请确认数据版本。
            </span>
          </div>
        )}

        <div className="px-4 lg:px-8 py-4 flex items-center justify-between relative">
          {/* 实时操作广播通知 */}
          <div className="absolute top-full left-0 right-0 pointer-events-none z-50 flex flex-col items-center gap-2 pt-2">
            {notifications.map(n => (
              <button type="button" key={n.id} onClick={() => { if (n.route) window.location.hash = `#${n.route}?document=${encodeURIComponent(n.documentId || '')}`; }} className="bg-blue-600 text-white px-4 py-2 rounded-lg shadow-xl text-xs font-bold flex items-center gap-2 animate-in slide-in-from-top-4 duration-300 pointer-events-auto">
                <Bell size={14} className="animate-bounce" />
                {n.message || `${n.actor} 刚刚修改了：${n.item}`}
              </button>
            ))}
          </div>

          <div className="flex items-center lg:hidden gap-3">
            <button onClick={() => setIsMobileMenuOpen(true)} className="p-2 -ml-2">
              <Menu size={24} />
            </button>
            <img src="/assets/images/logo-xw.png" alt="Logo" className="h-8 w-auto" />
          </div>

          <div className="hidden lg:block">
            <h2 className="text-sm font-medium text-[var(--color-text-muted)]">系统工作台 / {allNavItems.find(i => isActive(i.path))?.label || '概览'}</h2>
          </div>

          <div className="flex items-center gap-4">
            <div className="relative">
              <button type="button" onClick={() => { setNotificationCenterOpen((open) => !open); refreshPersistentNotifications(); }} className="relative rounded-full bg-amber-50 p-2 text-amber-600" title="通知中心">
                <Bell size={18} />
                {unreadNotificationCount > 0 && <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-red-500 px-1 text-[9px] font-black leading-4 text-white">{unreadNotificationCount > 99 ? '99+' : unreadNotificationCount}</span>}
              </button>
              {notificationCenterOpen && (
                <div className="absolute right-0 top-full z-[80] mt-3 w-[min(23rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
                  <div className="flex items-center justify-between border-b bg-slate-50 px-4 py-3">
                    <div><p className="text-sm font-black text-slate-800">通知中心</p><p className="text-[10px] text-slate-400">{unreadNotificationCount} 条未读 · 消息永久保留</p></div>
                    {unreadNotificationCount > 0 && <button type="button" onClick={markAllPersistentNotificationsRead} className="text-[10px] font-bold text-blue-600">全部已读</button>}
                  </div>
                  {notificationPermission !== 'granted' && notificationPermission !== 'unsupported' && <button type="button" onClick={enableNotifications} className="mx-3 mt-3 w-[calc(100%-1.5rem)] rounded-lg bg-amber-50 px-3 py-2 text-left text-[10px] font-bold text-amber-700">开启浏览器提醒，页面关闭后也更容易及时看到</button>}
                  <div className="max-h-[60vh] overflow-y-auto">
                    {workflowNotifications.length === 0 ? <p className="px-4 py-12 text-center text-xs text-slate-400">暂无通知</p> : workflowNotifications.map((notification) => (
                      <button type="button" key={notification.id} onClick={() => openPersistentNotification(notification)} className={`block w-full border-b px-4 py-3 text-left transition last:border-0 hover:bg-blue-50 ${notification.is_read ? 'bg-white' : 'bg-blue-50/60'}`}>
                        <div className="flex items-start gap-2">
                          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${notification.is_read ? 'bg-slate-200' : 'bg-blue-600'}`} />
                          <div className="min-w-0 flex-1"><p className="text-xs font-black text-slate-800">{notification.title}</p><p className="mt-1 text-[10px] leading-relaxed text-slate-500">{notification.message}</p><p className="mt-1.5 text-[9px] text-slate-400">{new Date(notification.created_at).toLocaleString('zh-CN', { hour12: false })}</p></div>
                        </div>
                      </button>
                    ))}
                  </div>
                  <button type="button" onClick={() => { setNotificationCenterOpen(false); window.location.hash = '#/approval'; }} className="block w-full border-t bg-slate-50 px-4 py-3 text-center text-xs font-black text-blue-600">进入审批与申请中心</button>
                </div>
              )}
            </div>
            <div className="hidden sm:flex flex-col items-end">
              <span className="text-sm font-semibold text-[var(--color-text-base)]">{roleLabel}</span>
              <span className="text-xs text-[var(--color-text-muted)]">{user.username}</span>
            </div>
            <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center text-[var(--color-primary)]">
              <User size={20} />
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Drawer Overlay */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Mobile Sidebar */}
      <div className={`fixed inset-y-0 left-0 w-64 bg-white z-50 transform transition-transform duration-300 lg:hidden ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-6 border-b border-[var(--color-border)] flex items-center justify-between">
          <img src="/assets/images/logo-xw.png" alt="Logo" className="h-8 w-auto" />
          <button onClick={() => setIsMobileMenuOpen(false)}>
            <X size={24} />
          </button>
        </div>
        <nav className="p-4 space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              onClick={() => setIsMobileMenuOpen(false)}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium ${
                isActive(item.path)
                  ? 'bg-blue-50 text-[var(--color-primary)]'
                  : 'text-[var(--color-text-base)]'
              }`}
            >
              <item.icon size={20} />
              {item.label}
              {item.badge > 0 && <span className="ml-auto min-w-5 rounded-full bg-red-500 px-1.5 py-0.5 text-center text-[10px] font-black text-white">{item.badge}</span>}
            </Link>
          ))}
          <button 
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-4 py-3 text-sm font-medium text-red-600 mt-4"
          >
            <LogOut size={20} />
            退出系统
          </button>
        </nav>
      </div>
    </>
  );
};

export default Header;
