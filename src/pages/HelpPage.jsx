import React from 'react';
import { HelpCircle, LogIn, PackagePlus, SlidersHorizontal, FileSpreadsheet, UserRound } from 'lucide-react';

const HelpPage = () => {
  const guides = [
    { icon: LogIn, title: '如何登录系统？', content: '在登录页选择管理员或员工角色，输入对应账号和密码后点击“立即登录”。如果无法登录，请检查角色、用户名和密码是否匹配。' },
    { icon: PackagePlus, title: '如何新增产品？', content: '进入“主库存管理”，点击“新增产品”，填写产品编号、名称、分类、规格、库存、单位和单价，点击“确认保存”即可加入列表。' },
    { icon: SlidersHorizontal, title: '如何筛选库存？', content: '点击“筛选”展开面板，可按产品分类和库存状态筛选。库存状态包括全部、有库存、库存充足、库存不足和缺货。' },
    { icon: FileSpreadsheet, title: '如何导入 Excel？', content: '进入“数据中心”，点击“下载导入模板”，按模板填写产品编号、名称、分类、规格、库存、单位、单价、来源和图片 URL，再选择文件导入。' },
    { icon: UserRound, title: '不同角色有什么区别？', content: '管理员可使用全部模块；员工可以查看库存和使用数据中心，但不能新增、编辑或删除库存数据。' },
    { icon: HelpCircle, title: '为什么修改后首页没有马上显示？', content: '正常情况下，新增、编辑或删除库存后，首页会自动更新统计和近期操作记录。如果仍未更新，请刷新页面并确认浏览器允许保存本地数据。' }
  ];

  return (
    <div className="space-y-6" data-component="help-page">
      <div className="card p-6 md:p-8 bg-gradient-to-br from-blue-600 to-indigo-700 text-white">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-white/15 rounded-xl"><HelpCircle size={28} /></div>
          <div>
            <h1 className="text-2xl font-bold">帮助中心</h1>
            <p className="text-blue-100 text-sm mt-2">快速了解登录、库存管理、数据导入和角色权限</p>
          </div>
        </div>
      </div>

      <div className="card p-5 md:p-6">
        <h2 className="text-lg font-bold mb-1">常见问题与操作指南</h2>
        <p className="text-sm text-[var(--color-text-muted)]">按照下面的步骤即可完成日常库存管理操作。</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {guides.map(({ icon: Icon, title, content }) => (
          <article key={title} className="card p-5 hover:border-blue-200 transition-colors">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-blue-50 text-blue-600 rounded-lg"><Icon size={20} /></div>
              <div>
                <h3 className="font-bold mb-2">{title}</h3>
                <p className="text-sm text-[var(--color-text-muted)] leading-6">{content}</p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
};

export default HelpPage;
