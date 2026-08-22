import React from 'react';
import { FileText, ShieldCheck, Database, RefreshCw } from 'lucide-react';

const TermsPage = () => {
  const sections = [
    {
      title: '一、适用范围',
      content: '本使用条款适用于中山鑫威织造有限公司内部库存管理系统及其相关页面、功能和数据服务。登录并使用系统，即表示您已阅读并理解本条款。'
    },
    {
      title: '二、账号与权限',
      content: '用户应使用分配给自己的账号登录，不得转借、共享或冒用他人账号。系统会根据管理员和员工角色分配不同权限，用户只能在授权范围内查看或修改信息。'
    },
    {
      title: '三、库存数据使用',
      content: '库存编号、产品名称、分类、规格、数量、单位、单价和来源等信息应真实、准确、完整。用户对自己录入、编辑和删除的数据负责，进行删除操作前应确认记录和影响范围。'
    },
    {
      title: '四、文件导入规范',
      content: '通过 Excel 或 CSV 导入库存时，应使用系统提供的模板，并确保文件内容不包含与业务无关的敏感信息。导入前请检查表头、数量、单价和产品编号，避免重复或错误记录。'
    },
    {
      title: '五、禁止行为',
      content: '禁止利用系统进行未授权访问、批量破坏数据、上传恶意文件、绕过权限控制或干扰系统正常运行。发现账号异常或数据异常时，应立即停止操作并向系统管理员报告。'
    },
    {
      title: '六、条款更新',
      content: '系统功能和管理要求可能随业务需要调整。条款更新后会在本页面展示，用户继续使用系统即视为接受更新后的条款。'
    }
  ];

  return (
    <div className="space-y-6" data-component="terms-page">
      <div className="card p-6 md:p-8 bg-gradient-to-br from-blue-600 to-blue-700 text-white">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-white/15 rounded-xl"><FileText size={28} /></div>
          <div>
            <h1 className="text-2xl font-bold">使用条款</h1>
            <p className="text-blue-100 text-sm mt-2">鑫威库存管理系统使用规范与用户责任说明</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card p-5"><ShieldCheck className="text-blue-600 mb-3" size={22} /><p className="font-semibold">按权限使用</p><p className="text-xs text-[var(--color-text-muted)] mt-1">仅操作授权范围内的功能。</p></div>
        <div className="card p-5"><Database className="text-blue-600 mb-3" size={22} /><p className="font-semibold">维护数据准确</p><p className="text-xs text-[var(--color-text-muted)] mt-1">录入和修改前请核对业务信息。</p></div>
        <div className="card p-5"><RefreshCw className="text-blue-600 mb-3" size={22} /><p className="font-semibold">关注系统更新</p><p className="text-xs text-[var(--color-text-muted)] mt-1">以页面展示的最新条款为准。</p></div>
      </div>

      <article className="card p-6 md:p-8 space-y-7">
        <p className="text-sm text-[var(--color-text-muted)]">生效范围：鑫威库存管理系统当前版本</p>
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

export default TermsPage;
