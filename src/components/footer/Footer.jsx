import React from 'react';
import { Link } from 'react-router-dom';

const Footer = () => {
  const currentYear = new Date().getFullYear();
  
  return (
    <footer className="bg-white border-t border-[var(--color-border)] py-6 px-8" data-component="site-footer">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-[var(--color-text-muted)]">
        <div>
          © {currentYear} 中山鑫威织造有限公司 版权所有
        </div>
        <div className="flex gap-6">
          <Link to="/terms" className="hover:text-[var(--color-primary)] transition-colors">使用条款</Link>
          <Link to="/privacy" className="hover:text-[var(--color-primary)] transition-colors">隐私政策</Link>
          <Link to="/help" className="hover:text-[var(--color-primary)] transition-colors">帮助中心</Link>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
