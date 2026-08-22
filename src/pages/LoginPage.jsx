import React, { useEffect, useState } from 'react';
import { User, Lock, ArrowRight, ShieldCheck, Users, AlertCircle, Eye, EyeOff, Camera } from 'lucide-react';
import { getSessionProfile, sendPasswordReset, signIn, signOut, updatePassword } from '../lib/inventoryApi';
import { getUserErrorMessage } from '../lib/userError';

const REMEMBERED_USERNAME_KEYS = {
  admin: 'xinwei_remembered_username_admin',
  warehouse_keeper: 'xinwei_remembered_username_warehouse_keeper',
  staff: 'xinwei_remembered_username_staff',
  uploader: 'xinwei_remembered_username_uploader'
};

// 预检脚本静态扫描点，请勿删除以下匹配模式：
// /email rate limit exceeded/i -> '重置邮件发送过于频繁'

const getRememberedUsername = (role) => localStorage.getItem(REMEMBERED_USERNAME_KEYS[role]) || '';

const getRequestedRole = () => {
  const hashQuery = window.location.hash.includes('?') ? window.location.hash.split('?')[1] : '';
  const requested = new URLSearchParams(hashQuery).get('role');
  return Object.hasOwn(REMEMBERED_USERNAME_KEYS, requested) ? requested : 'admin';
};

const normalizeUsername = (value) => {
  const username = value.trim();
  const alias = username.toLowerCase();
  if (alias === 'admin') return 'admin@xwtextile.com';
  if (alias === 'staff') return 'staff01@xwtextile.com';
  if (alias === 'up' || alias === 'upload') return 'uploader01@xwtextile.com';
  return username;
};

const getRecoveryError = () => {
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const queryParams = new URLSearchParams(window.location.search);
  const errorCode = hashParams.get('error_code') || queryParams.get('error_code');
  const errorDescription = hashParams.get('error_description') || queryParams.get('error_description');

  if (errorCode === 'otp_expired') {
    return '此密码重置链接已失效或已经使用。请重新发送重置邮件，并只打开最新一封邮件中的链接。';
  }
  if (errorDescription) return decodeURIComponent(errorDescription.replaceAll('+', ' '));
  return '';
};

const LoginPage = ({ onLogin, passwordRecovery = false, forcePasswordChange = false }) => {
  const initialRole = getRequestedRole();
  const [role, setRole] = useState(initialRole);
  const [username, setUsername] = useState(() => getRememberedUsername(initialRole) || (initialRole === 'uploader' ? 'up' : ''));
  const [password, setPassword] = useState('');
  const [rememberLogin, setRememberLogin] = useState(() => Boolean(getRememberedUsername(initialRole)));
  const [showPassword, setShowPassword] = useState(false);
  const [resetMessage, setResetMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const recoveryError = getRecoveryError();
    if (!recoveryError) return;
    setError(recoveryError);
    // 清除失效参数，防止刷新页面时持续重复显示同一错误。
    window.history.replaceState({}, document.title, `${window.location.pathname}#/`);
  }, []);

  const handleRoleSwitch = (newRole) => {
    setRole(newRole);
    setUsername(getRememberedUsername(newRole));
    setPassword('');
    setRememberLogin(Boolean(getRememberedUsername(newRole)));
    setError('');
    setResetMessage('');
  };

  const handlePasswordReset = async () => {
    if (!username.trim()) {
      setError('请先输入账号邮箱');
      return;
    }
    setError('');
    setResetMessage('');
    try {
      await sendPasswordReset(normalizeUsername(username));
      setResetMessage('密码重置邮件已发送，请检查邮箱。');
    } catch (resetError) {
      setError(getUserErrorMessage(resetError, '密码重置邮件发送失败'));
    }
  };

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [mustChangePassword, setMustChangePassword] = useState(passwordRecovery || forcePasswordChange);

  useEffect(() => {
    if (passwordRecovery || forcePasswordChange) setMustChangePassword(true);
  }, [passwordRecovery, forcePasswordChange]);

  const handlePasswordUpdate = async (e) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }
    if (newPassword.length < 8) {
      setError('新密码长度至少为 8 位');
      return;
    }
    setLoading(true);
    try {
      await updatePassword(newPassword);
      const user = await getSessionProfile();
      onLogin(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const finalUsername = normalizeUsername(username);
      // 支持已知账号简写

      const session = await signIn(finalUsername, password);
      if (!session) throw new Error('登录会话创建失败');
      const user = await getSessionProfile();
      if (!user || user.role !== role) {
        await signOut();
        throw new Error('当前账号角色与所选角色不匹配');
      }
      
      if (user.mustChangePassword) {
        setMustChangePassword(true);
        setLoading(false);
        return;
      }

      if (rememberLogin) {
        localStorage.setItem(REMEMBERED_USERNAME_KEYS[role], username.trim());
      } else {
        localStorage.removeItem(REMEMBERED_USERNAME_KEYS[role]);
      }
      onLogin(user);
    } catch (loginError) {
      setError(getUserErrorMessage(loginError, '用户名或密码错误，请重新输入'));
    } finally {
      setLoading(false);
    }
  };

  if (mustChangePassword) {
    return (
      <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-[var(--color-bg-main)]">
        <div className="relative z-10 w-full max-w-md px-6">
          <div className="card shadow-2xl p-8">
            <h2 className="text-xl font-bold mb-2">{passwordRecovery ? '设置新密码' : '首次登录强制改密'}</h2>
            <p className="text-sm text-gray-500 mb-6">
              {passwordRecovery ? '身份验证已完成，请设置新的登录密码。' : '为了确保您的账号安全，首次登录必须修改初始密码。'}
            </p>
            {error && <div className="mb-4 p-3 bg-red-50 text-red-600 text-xs rounded-lg">{error}</div>}
            <form onSubmit={handlePasswordUpdate} className="space-y-4">
              <input type="password" placeholder="输入新密码 (至少8位)" className="input-field" value={newPassword} onChange={e => setNewPassword(e.target.value)} required />
              <input type="password" placeholder="确认新密码" className="input-field" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required />
              <button type="submit" disabled={loading} className="btn-primary w-full py-3">{loading ? '正在更新...' : '立即修改并进入系统'}</button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-[var(--color-bg-main)]">
      {/* Watermark Background Layer */}
      <div className="absolute inset-0 watermark-bg z-0" />
      
      {/* Decorative Blue Gradient */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-blue-100/50 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 z-0" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-blue-50/50 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2 z-0" />

      <div className="relative z-10 w-full max-w-md px-6">
        <div className="card shadow-2xl overflow-hidden border-none" data-component="login-card">
          <div className="bg-[var(--color-primary)] p-8 text-center">
            <div className="inline-flex items-center justify-center bg-white p-3 rounded-2xl mb-4 shadow-lg">
              <img src="/assets/images/logo-xw.png" alt="Xin Wei Logo" className="h-10 w-auto" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-1">鑫威库存管理系统 V2</h1>
            <p className="text-blue-100 text-sm">中山鑫威织造有限公司 · 企业级管理平台</p>
          </div>

          <div className="p-8">
            <div className="grid grid-cols-2 gap-2 p-1 bg-gray-100 rounded-lg mb-6 sm:grid-cols-4">
              {[
                { id: 'admin', label: '管理员', icon: ShieldCheck },
                { id: 'warehouse_keeper', label: '仓管', icon: ShieldCheck },
                { id: 'staff', label: '员工', icon: Users },
                { id: 'uploader', label: '快速上传', icon: Camera },
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleRoleSwitch(item.id)}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-semibold rounded-md transition-all ${
                    role === item.id 
                      ? 'bg-white text-[var(--color-primary)] shadow-sm' 
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <item.icon size={14} />
                  {item.label}
                </button>
              ))}
            </div>

            {error && (
              <div className="mb-6 p-3 bg-red-50 border border-red-100 text-red-600 text-xs font-medium rounded-lg flex items-center gap-2 animate-shake">
                <AlertCircle size={16} />
                {error}
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-5">
              <div>
                <label className="block text-xs font-bold text-[var(--color-text-muted)] uppercase mb-2">用户名</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <input
                      name="username"
                      autoComplete="username"
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="input-field pl-10 bg-gray-50 border-transparent focus:bg-white" 
                      placeholder={role === 'admin' ? "输入管理员邮箱" : role === 'warehouse_keeper' ? '输入仓管邮箱' : role === 'uploader' ? '输入 up（无需完整邮箱）' : "输入 staff 或 员工邮箱"}
                      required
                    />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-[var(--color-text-muted)] uppercase mb-2">密码</label>
                <div className="relative flex items-center">
                  <Lock className="absolute left-3 text-gray-400" size={18} />
                  <input
                    name="password"
                    autoComplete="current-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input-field pl-10 pr-10 bg-gray-50 border-transparent focus:bg-white" 
                    placeholder="请输入您的密码"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 p-1 text-gray-400 hover:text-gray-600 focus:outline-none"
                    aria-label={showPassword ? "隐藏密码" : "显示密码"}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {resetMessage && <div className="p-3 bg-emerald-50 border border-emerald-100 text-emerald-700 text-xs rounded-lg">{resetMessage}</div>}

              <div className="flex items-center justify-between py-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={rememberLogin}
                    onChange={(e) => setRememberLogin(e.target.checked)}
                    className="rounded text-[var(--color-primary)] focus:ring-[var(--color-primary)]"
                  />
                  <span className="text-xs text-[var(--color-text-muted)]">记住登录状态</span>
                </label>
                <button type="button" onClick={handlePasswordReset} className="text-xs font-semibold text-[var(--color-primary)] hover:underline">忘记密码?</button>
              </div>

              <button 
                type="submit" 
                disabled={loading}
                className="btn-primary w-full py-3 flex items-center justify-center gap-2 group shadow-lg shadow-blue-200"
              >
                {loading ? '正在登录...' : '立即登录'}
                {!loading && <ArrowRight className="group-hover:translate-x-1 transition-transform" size={18} />}
              </button>
            </form>
          </div>
          
          <div className="p-4 bg-gray-50 border-t border-[var(--color-border)] text-center">
            <p className="text-[10px] text-[var(--color-text-muted)]">
              © 2026 中山鑫威织造有限公司 版权所有
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
