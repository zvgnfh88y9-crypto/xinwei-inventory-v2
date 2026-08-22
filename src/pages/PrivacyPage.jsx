import React from 'react';
import { LockKeyhole, UserCheck, FileSearch, Trash2 } from 'lucide-react';

const PrivacyPage = () => {
  const sections = [
    {
      title: '一、我们处理的信息',
      content: '系统可能处理登录账号、角色信息、库存产品资料、库存操作记录以及管理员主动上传的 Excel 或 CSV 文件内容。系统不会要求用户在页面中填写与库存管理无关的个人信息。'
    },
    {
      title: '二、信息使用目的',
      content: '相关信息仅用于身份识别、权限控制、库存查询、库存统计、操作追踪、文件导入和系统运行维护。操作记录用于帮助管理员了解库存数据的新增、编辑和删除情况。'
    },
    {
      title: '三、数据存储与访问',
      content: '当前演示版本会在浏览器本地保存登录状态、库存数据和操作记录。不同浏览器或设备之间不会自动共享本地数据。系统权限控制用于限制不同角色可访问的页面和操作。'
    },
    {
      title: '四、数据安全责任',
      content: '用户应妥善保管账号和密码，避免在公共设备上保存登录状态。上传文件前应确认文件来源和内容，避免上传不必要的个人信息、账号密码或其他敏感资料。'
    },
    {
      title: '五、数据更正与删除',
      content: '具备权限的管理员或员工可以在库存管理页面编辑或删除业务记录。删除前系统会要求确认。若需要处理系统范围之外的数据请求，应由企业指定的系统管理员按照内部流程执行。'
    },
    {
      title: '六、政策更新',
      content: '当系统功能、数据处理方式或管理要求发生变化时，我们会更新本页面内容。更新后的政策从页面发布之日起适用。'
    }
  ];

  return (
    <div className="space-y-6" data-component="privacy-page">
      <div className="card p-6 md:p-8 bg-gradient-to-br from-slate-700 to-blue-800 text-white">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-white/15 rounded-xl"><LockKeyhole size={28} /></div>
          <div>
            <h1 className="text-2xl font-bold">隐私政策</h1>
            <p className="text-slate-200 text-sm mt-2">鑫威库存管理系统的信息处理与数据保护说明</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card p-5"><UserCheck className="text-blue-600 mb-3" size={22} /><p className="font-semibold">最小化收集</p><p className="text-xs text-[var(--color-text-muted)] mt-1">只处理库存管理所需信息。</p></div>
        <div className="card p-5"><FileSearch className="text-blue-600 mb-3" size={22} /><p className="font-semibold">操作可追踪</p><p className="text-xs text-[var(--color-text-muted)] mt-1">保留库存变更的操作记录。</p></div>
        <div className="card p-5"><Trash2 className="text-blue-600 mb-3" size={22} /><p className="font-semibold">按权限处理</p><p className="text-xs text-[var(--color-text-muted)] mt-1">编辑和删除受角色权限限制。</p></div>
      </div>

      <article className="card p-6 md:p-8 space-y-7">
        <p className="text-sm text-[var(--color-text-muted)]">适用系统：鑫威库存管理系统当前版本</p>
        {sections.map((section) => (
          <section key={section.title}>
            <h2 className="text-lg font-bold mb-2">{section.title}</h2>
            <p className="text-sm text-[var(--color-text-muted)] leading-7">{section.content}</p>
          </section>
        ))}
      </article>
    </div>
  );
};

export default PrivacyPage;
