import React from 'react';
import * as LucideIcons from 'lucide-react';

const StatCard = ({ label, value, color, icon, unit, detail }) => {
  const Icon = LucideIcons[icon] || LucideIcons.Box;
  const [showTip, setShowTip] = React.useState(false);

  const colorMap = {
    blue: 'text-blue-600 bg-blue-50',
    yellow: 'text-amber-600 bg-amber-50',
    red: 'text-red-600 bg-red-50',
    green: 'text-emerald-600 bg-emerald-50',
    indigo: 'text-indigo-600 bg-indigo-50',
  };

  return (
    <div className="card p-5 flex items-center gap-4 relative group" data-component="stat-card">
      <div className={`p-3 rounded-lg ${colorMap[color] || colorMap.blue}`}>
        <Icon size={24} />
      </div>
      <div>
        <div className="flex items-center gap-1 mb-1">
          <p className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-tight">
            {label}
          </p>
          {detail && (
            <button 
              type="button"
              onMouseEnter={() => setShowTip(true)}
              onMouseLeave={() => setShowTip(false)}
              onFocus={() => setShowTip(true)}
              onBlur={() => setShowTip(false)}
              onClick={() => setShowTip((visible) => !visible)}
              aria-label={`查看${label}计算说明`}
              aria-expanded={showTip}
              className="text-gray-300 hover:text-blue-500 transition-colors"
            >
              <LucideIcons.Info size={12} />
            </button>
          )}
        </div>
        <div className="flex items-baseline gap-1">
          <h3 className="text-2xl font-black text-[var(--color-text-base)]">
            {value}
          </h3>
          {unit && <span className="text-[10px] font-bold text-gray-400">{unit}</span>}
        </div>
      </div>

      {showTip && detail && (
        <div className="absolute top-full left-0 right-0 mt-2 z-50 p-3 bg-gray-900 text-white text-[10px] rounded-lg shadow-xl animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="font-bold border-b border-white/20 pb-1 mb-1 flex items-center gap-1">
            <LucideIcons.Calculator size={10} /> 计算公式说明
          </div>
          <p className="leading-relaxed opacity-90">{detail}</p>
          <div className="absolute -top-1 left-8 w-2 h-2 bg-gray-900 rotate-45" />
        </div>
      )}
    </div>
  );
};

export default StatCard;
