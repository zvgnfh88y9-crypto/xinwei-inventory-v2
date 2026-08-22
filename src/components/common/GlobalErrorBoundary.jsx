import React from 'react';
import { AlertTriangle, RefreshCw, ClipboardCopy, Check } from 'lucide-react';
import { reportError } from '../../lib/wmsV2Api';

class GlobalErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { 
      hasError: false, 
      errorId: null, 
      copied: false,
      isReporting: false 
    };
  }

  static getDerivedStateFromError(error) {
    // 生成一个随机的错误引用 ID (UUID 简版)
    const errorId = `ERR-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
    return { hasError: true, errorId };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Critical System Error:", error, errorInfo);
    
    // 异步上报至服务端审计日志，不阻塞渲染
    this.setState({ isReporting: true });
    reportError({
      error_id: this.state.errorId,
      message: error.toString(),
      stack: errorInfo.componentStack,
      page_url: window.location.href,
      user_agent: navigator.userAgent,
      version: 'v2.9.3'
    }).catch(() => {
      // 错误上报不可再次触发未处理异常，用户仍可凭错误 ID 反馈。
    }).finally(() => {
      this.setState({ isReporting: false });
    });
  }

  copyId = async () => {
    try {
      await navigator.clipboard.writeText(this.state.errorId);
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    } catch {
      // 非安全上下文可能禁用剪贴板，此时保留可手动选择的错误 ID。
    }
  };

  goHome = () => {
    window.location.hash = '#/';
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white rounded-2xl shadow-2xl p-8 border border-red-100 animate-in zoom-in-95">
            <div className="h-16 w-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6 text-red-600">
              <AlertTriangle size={32} />
            </div>
            <h2 className="text-xl font-bold text-center text-gray-900 mb-2">系统遇到未预期错误</h2>
            <p className="text-sm text-gray-500 text-center mb-8 leading-relaxed">
              很抱歉，当前模块在渲染时发生了异常。为了保护数据安全，我们已拦截错误。
            </p>
            
            <div className="bg-gray-50 rounded-xl p-5 mb-8 border border-gray-100 group relative">
              <p className="text-[10px] font-black text-gray-400 uppercase mb-2 tracking-widest">错误凭证 ID (请反馈给管理员)</p>
              <div className="flex items-center justify-between gap-3">
                <code className="text-sm font-mono font-black text-red-600 bg-white px-3 py-1.5 border rounded-lg shadow-sm">
                  {this.state.errorId}
                </code>
                <button 
                  onClick={this.copyId}
                  className="p-2 hover:bg-white rounded-lg text-gray-400 hover:text-blue-500 transition-colors"
                >
                  {this.state.copied ? <Check size={18} className="text-emerald-500" /> : <ClipboardCopy size={18} />}
                </button>
              </div>
              <p className="text-[9px] text-gray-400 mt-3 italic">
                {this.state.isReporting ? '* 正在提交错误上下文…' : '* 如需协助，请将错误凭证 ID 提供给管理员。'}
              </p>
            </div>

            <div className="flex flex-col gap-3">
              <button 
                onClick={this.goHome}
                className="w-full btn-primary py-3 flex items-center justify-center gap-2 font-bold shadow-lg shadow-blue-100"
              >
                <RefreshCw size={18} /> 返回系统首页
              </button>
              <button 
                onClick={() => window.location.reload()} 
                className="w-full py-3 text-xs font-bold text-gray-400 hover:text-gray-600 transition-colors"
              >
                尝试刷新当前页
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default GlobalErrorBoundary;
