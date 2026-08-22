import React, { useEffect, useState } from 'react';
import { UserPlus, ShieldAlert, Key, UserCheck, LoaderCircle, AlertTriangle, Eye, EyeOff, RotateCcw, LockKeyhole, CheckCircle2 } from 'lucide-react';
import { createUser, listUsers, resetUserPassword, toggleUser } from '../../lib/inventoryApi';

const ROLE_LABELS = { admin: '系统管理员', inv_manager: '旧仓库主管', warehouse_keeper: '仓管（专业复核）', staff: '常规员工', uploader: '快速上传员' };

const AccountSecurity = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', displayName: '', role: 'staff' });
  const [resetTarget, setResetTarget] = useState(null);
  const [resetForm, setResetForm] = useState({ newPassword: '', confirmPassword: '', adminPassword: '' });
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showAdminPassword, setShowAdminPassword] = useState(false);
  const [success, setSuccess] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const data = await listUsers();
      setUsers(data.users || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await createUser(form);
      setIsAdding(false);
      setForm({ email: '', password: '', displayName: '', role: 'staff' });
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (resetForm.newPassword.length < 8) return setError('新临时密码至少需要 8 位');
    if (resetForm.newPassword !== resetForm.confirmPassword) return setError('两次输入的新临时密码不一致');
    setLoading(true);
    try {
      await resetUserPassword(resetTarget.id, resetForm.newPassword, resetForm.adminPassword);
      setSuccess(`已为 ${resetTarget.email || resetTarget.display_name} 设置新临时密码；该用户下次登录必须修改密码。`);
      setResetTarget(null);
      setResetForm({ newPassword: '', confirmPassword: '', adminPassword: '' });
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="p-4 border-b flex justify-between items-center bg-gray-50">
          <div className="flex items-center gap-2"><Key className="text-blue-600" size={18} /><h3 className="font-bold text-sm">企业级账号安全体系</h3></div>
          <button onClick={() => setIsAdding(true)} className="btn-primary py-1.5 px-3 text-xs flex items-center gap-2"><UserPlus size={14} /> 新增独立账号</button>
        </div>
        
        {error && <div className="m-4 p-3 bg-red-50 text-red-600 text-xs rounded-lg flex items-center gap-2"><AlertTriangle size={14} />{error}</div>}
        {success && <div className="m-4 p-3 bg-emerald-50 text-emerald-700 text-xs rounded-lg flex items-center gap-2"><CheckCircle2 size={14} />{success}</div>}
        <div className="mx-4 mt-4 p-3 rounded-lg bg-blue-50 text-blue-700 text-xs leading-5">
          为保护账号安全，系统不会保存或显示用户原密码。管理员可验证自己的密码后，为用户设置新的临时密码。
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-gray-50 text-gray-500 uppercase">
              <tr><th className="px-4 py-3">用户邮箱</th><th className="px-4 py-3">姓名</th><th className="px-4 py-3">角色</th><th className="px-4 py-3">首次改密</th><th className="px-4 py-3">状态</th><th className="px-4 py-3">操作</th></tr>
            </thead>
            <tbody className="divide-y">
              {loading ? <tr><td colSpan={6} className="p-8 text-center"><LoaderCircle className="animate-spin mx-auto text-blue-500" /></td></tr> : users.map(u => (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">
                    <div>{u.email || '未绑定登录邮箱'}</div>
                    <div className="mt-0.5 text-[10px] font-normal text-gray-400">用户名：{u.username || '—'}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{u.display_name}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded font-bold ${u.role === 'admin' ? 'bg-indigo-50 text-indigo-700' : 'bg-blue-50 text-blue-700'}`}>{ROLE_LABELS[u.role] || u.role}</span></td>
                  <td className="px-4 py-3">{u.must_change_password ? <span className="text-amber-600 flex items-center gap-1"><ShieldAlert size={12} />待修改</span> : <span className="text-emerald-600 flex items-center gap-1"><UserCheck size={12} />已完成</span>}</td>
                  <td className="px-4 py-3">{u.is_disabled ? <span className="text-red-500 font-bold">已停用</span> : <span className="text-emerald-500 font-bold">使用中</span>}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-3">
                      <button onClick={() => { setError(''); setSuccess(''); setResetTarget(u); }} className="text-[10px] font-bold text-blue-600 inline-flex items-center gap-1"><RotateCcw size={12} />重设密码</button>
                      <button onClick={() => toggleUser(u.id, !u.is_disabled).then(load)} className={`text-[10px] font-bold underline ${u.is_disabled ? 'text-emerald-600' : 'text-red-600'}`}>{u.is_disabled ? '启用' : '停用'}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {isAdding && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl animate-in zoom-in-95">
            <h3 className="text-lg font-bold mb-4">创建企业员工账号</h3>
            <form onSubmit={handleCreate} className="space-y-4">
              <input placeholder="员工邮箱" className="input-field" type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} required />
              <input placeholder="初始密码 (首次登录必须修改)" className="input-field" type="password" value={form.password} onChange={e => setForm({...form, password: e.target.value})} required />
              <input placeholder="员工姓名" className="input-field" value={form.displayName} onChange={e => setForm({...form, displayName: e.target.value})} required />
              <select className="input-field" value={form.role} onChange={e => setForm({...form, role: e.target.value})}>
                <option value="staff">常规员工 (仅入出库申请)</option>
                <option value="uploader">快速上传员 (仅拍照上传)</option>
                <option value="warehouse_keeper">仓管 (专业复核后递交管理员)</option>
                <option value="admin">系统管理员 (全权限)</option>
              </select>
              <div className="pt-4 flex gap-3">
                <button type="button" onClick={() => setIsAdding(false)} className="btn-secondary flex-1">取消</button>
                <button type="submit" disabled={loading} className="btn-primary flex-1">立即创建</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {resetTarget && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[120] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl animate-in zoom-in-95">
            <div className="flex items-center gap-2 mb-2"><LockKeyhole className="text-blue-600" size={20} /><h3 className="text-lg font-bold">设置新临时密码</h3></div>
            <p className="text-xs text-gray-500 mb-5">账号：{resetTarget.email || resetTarget.display_name}。原密码不可查看；设置成功后，用户下次登录必须修改。</p>
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div className="relative">
                <input placeholder="新临时密码（至少 8 位）" className="input-field pr-11" type={showNewPassword ? 'text' : 'password'} value={resetForm.newPassword} onChange={e => setResetForm({...resetForm, newPassword: e.target.value})} required minLength={8} autoComplete="new-password" />
                <button type="button" onClick={() => setShowNewPassword(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" aria-label={showNewPassword ? '隐藏新密码' : '显示新密码'}>{showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>
              </div>
              <input placeholder="再次输入新临时密码" className="input-field" type={showNewPassword ? 'text' : 'password'} value={resetForm.confirmPassword} onChange={e => setResetForm({...resetForm, confirmPassword: e.target.value})} required minLength={8} autoComplete="new-password" />
              <div className="relative">
                <input placeholder="输入您当前的管理员密码以确认" className="input-field pr-11" type={showAdminPassword ? 'text' : 'password'} value={resetForm.adminPassword} onChange={e => setResetForm({...resetForm, adminPassword: e.target.value})} required autoComplete="current-password" />
                <button type="button" onClick={() => setShowAdminPassword(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" aria-label={showAdminPassword ? '隐藏管理员密码' : '显示管理员密码'}>{showAdminPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>
              </div>
              <div className="pt-3 flex gap-3">
                <button type="button" onClick={() => { setResetTarget(null); setResetForm({ newPassword: '', confirmPassword: '', adminPassword: '' }); }} className="btn-secondary flex-1">取消</button>
                <button type="submit" disabled={loading} className="btn-primary flex-1">{loading ? '验证并保存中…' : '验证并重设'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default AccountSecurity;
