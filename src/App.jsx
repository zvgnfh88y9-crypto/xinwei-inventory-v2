import React, { useEffect, useState, lazy, Suspense } from 'react';
import { getSessionProfile, signOut, subscribeAuth } from './lib/inventoryApi';
import { getUserErrorMessage } from './lib/userError';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Header from './components/header/Header';
import Footer from './components/footer/Footer';
import LoginPage from './pages/LoginPage';
import { Loader2 } from 'lucide-react';

// 路由拆包：核心首页同步加载，其余业务模块按需异步加载
import DashboardPage from './pages/DashboardPage';
import QuickUploadPage from './pages/QuickUploadPage';

// 手机浏览器可能长时间保留旧入口页。新版发布后如果旧入口引用的按需
// 加载文件已不存在，自动刷新一次，取得同一版本的完整资源。
const lazyWithRefresh = (loader, key) => lazy(async () => {
  try {
    const module = await loader();
    sessionStorage.removeItem(`xinwei-chunk-retry:${key}`);
    return module;
  } catch (error) {
    const retryKey = `xinwei-chunk-retry:${key}`;
    if (!sessionStorage.getItem(retryKey)) {
      sessionStorage.setItem(retryKey, '1');
      window.location.reload();
      return new Promise(() => {});
    }
    sessionStorage.removeItem(retryKey);
    throw error;
  }
});

const InventoryPage = lazyWithRefresh(() => import('./pages/InventoryPage'), 'inventory');
const SalesOrderPage = lazyWithRefresh(() => import('./pages/SalesOrderPage'), 'orders');
const ProductionPage = lazyWithRefresh(() => import('./pages/ProductionPage'), 'production');
const QualityControlPage = lazyWithRefresh(() => import('./pages/QualityControlPage'), 'qc');
const ExceptionCenterPage = lazyWithRefresh(() => import('./pages/ExceptionCenterPage'), 'exceptions');
const TraceChainPage = lazyWithRefresh(() => import('./pages/TraceChainPage'), 'trace');
const SyncPage = lazyWithRefresh(() => import('./pages/SyncPage'), 'sync');
const ReportsPage = lazyWithRefresh(() => import('./pages/ReportsPage'), 'reports');
const TermsPage = lazyWithRefresh(() => import('./pages/TermsPage'), 'terms');
const PrivacyPage = lazyWithRefresh(() => import('./pages/PrivacyPage'), 'privacy');
const HelpPage = lazyWithRefresh(() => import('./pages/HelpPage'), 'help');
const WorkflowPage = lazyWithRefresh(() => import('./pages/WorkflowCenterPage'), 'workflow');
const PartnerLedgerPage = lazyWithRefresh(() => import('./pages/PartnerLedgerPage'), 'partners');

const PageLoader = () => (
  <div className="h-[60vh] flex flex-col items-center justify-center gap-4 text-gray-400">
    <Loader2 className="animate-spin text-blue-500" size={32} />
    <p className="text-sm font-medium">正在按需加载模块...</p>
  </div>
);

const hasRole = (user, roles) => roles.includes(user.role);

function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [authRetry, setAuthRetry] = useState(0);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [passwordChangeRequired, setPasswordChangeRequired] = useState(false);
  const passwordRecoveryRef = React.useRef(false);

  useEffect(() => {
    let active = true;

    const loadProfileWithTimeout = async () => {
      let lastError;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          return await Promise.race([
            getSessionProfile(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('登录状态检查超时')), 12000))
          ]);
        } catch (error) {
          lastError = error;
          if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 800));
        }
      }
      throw lastError;
    };

    setAuthLoading(true);
    setAuthError('');
    loadProfileWithTimeout()
      .then((profile) => {
        if (!active || passwordRecoveryRef.current) return;
        if (profile?.mustChangePassword) {
          setPasswordChangeRequired(true);
          setUser(null);
        } else {
          setPasswordChangeRequired(false);
          setUser(profile);
        }
      })
      .catch((error) => {
        if (!active) return;
        setUser(null);
        const message = error.message || '无法检查登录状态';
        if (/invalid authentication token|auth session missing|invalid.*jwt|jwt.*expired|refresh.*token.*(?:invalid|expired)|session.*(?:expired|missing|invalid)|no current user/i.test(message)) {
          // 失效会话不是系统故障：清理后直接展示登录页。
          signOut().catch(() => {});
          setAuthError('');
          return;
        }
        setAuthError(getUserErrorMessage(error, '登录状态检查失败'));
      })
      .finally(() => { if (active) setAuthLoading(false); });

    const subscription = subscribeAuth((session, event) => {
      if (!active) return;
      if (event === 'PASSWORD_RECOVERY') {
        passwordRecoveryRef.current = true;
        setPasswordRecovery(true);
        setPasswordChangeRequired(false);
        setUser(null);
        setAuthLoading(false);
        return;
      }
      if (!session) {
        passwordRecoveryRef.current = false;
        setPasswordRecovery(false);
        setPasswordChangeRequired(false);
        setUser(null);
        setAuthLoading(false);
        return;
      }

      // 初次会话由上面的请求负责，避免启动时重复拉取 profile。
      if (event === 'INITIAL_SESSION') return;
      // 认证回调内部持有 Supabase 会话锁；延迟读取资料以避免锁内再次访问 Auth。
      setTimeout(() => {
        if (!active) return;
        loadProfileWithTimeout()
          .then((profile) => {
            if (!active) return;
            if (profile?.mustChangePassword) {
              setPasswordChangeRequired(true);
              setUser(null);
            } else {
              setPasswordChangeRequired(false);
              setUser(profile);
            }
          })
          .catch(() => { if (active) setUser(null); });
      }, 0);
    });

    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, [authRetry]);

  const handleLogin = (userData) => {
    passwordRecoveryRef.current = false;
    setPasswordRecovery(false);
    setPasswordChangeRequired(false);
    setUser(userData);
  };

  const handleLogout = async () => {
    await signOut();
    setUser(null);
  };

  if (authLoading) {
    return <div className="min-h-screen flex flex-col gap-3 items-center justify-center text-sm text-[var(--color-text-muted)]"><Loader2 className="animate-spin text-blue-500" size={24} />正在检查登录状态...</div>;
  }

  if (authError) {
    return <div className="min-h-screen flex items-center justify-center p-6 bg-[var(--color-bg-main)]"><div className="card max-w-md w-full p-8 text-center"><p className="font-bold text-gray-800">登录状态检查失败</p><p className="text-sm text-red-600 mt-2">{authError}</p><button className="btn-primary mt-6 px-6" onClick={() => setAuthRetry((value) => value + 1)}>重新检查</button></div></div>;
  }

  if (!user) {
    return <LoginPage onLogin={handleLogin} passwordRecovery={passwordRecovery} forcePasswordChange={passwordChangeRequired} />;
  }

  if (user.role === 'uploader') {
    return <QuickUploadPage user={user} onLogout={handleLogout} />;
  }

  return (
    <Router>
      <div className="min-h-screen flex flex-col lg:flex-row bg-[var(--color-bg-main)]">
        {/* Navigation Sidebar/Header */}
        <Header user={user} onLogout={handleLogout} />

        {/* Main Content Area */}
        <div className="flex-grow flex flex-col min-h-screen lg:pl-0">
          {/* Spacer for fixed mobile header */}
          <div className="lg:hidden h-[73px]"></div>
          
          {/* Spacer for desktop fixed top header header */}
          <div className="hidden lg:block h-[73px]"></div>

          <main className="flex-grow p-4 lg:p-8 max-w-7xl mx-auto w-full">
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/" element={<DashboardPage user={user} />} />
                <Route path="/v2/orders" element={<SalesOrderPage user={user} />} />
                <Route path="/v2/production" element={<ProductionPage user={user} />} />
                <Route path="/v2/qc" element={hasRole(user, ['admin', 'inv_manager']) ? <QualityControlPage user={user} /> : <Navigate to="/" replace />} />
                <Route path="/v2/exceptions" element={hasRole(user, ['admin', 'inv_manager']) ? <ExceptionCenterPage user={user} /> : <Navigate to="/" replace />} />
                <Route path="/v2/trace/:id" element={<TraceChainPage user={user} />} />
                <Route path="/inventory" element={<InventoryPage user={user} />} />
                <Route path="/inbound" element={<WorkflowPage key="workflow-inbound" user={user} mode="in" />} />
                <Route path="/outbound" element={<WorkflowPage key="workflow-outbound" user={user} mode="out" />} />
                <Route path="/operations" element={<WorkflowPage key="workflow-operations" user={user} mode="internal" />} />
                <Route path="/inventory-count" element={<WorkflowPage user={user} mode="count" />} />
                <Route path="/partners" element={<PartnerLedgerPage user={user} />} />
                <Route path="/approval" element={<WorkflowPage user={user} mode="approval" />} />
                <Route path="/sync" element={hasRole(user, ['admin']) ? <SyncPage user={user} /> : <Navigate to="/" replace />} />
                <Route path="/reports" element={
                  hasRole(user, ['admin', 'inv_manager']) ? <ReportsPage user={user} /> : <Navigate to="/" replace />
                } />
                <Route path="/terms" element={<TermsPage />} />
                <Route path="/privacy" element={<PrivacyPage />} />
                <Route path="/help" element={<HelpPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </main>

          <Footer />
        </div>
      </div>
    </Router>
  );
}

export default App;
// Rebuild at Thu Aug  6 11:54:49 CST 2026
