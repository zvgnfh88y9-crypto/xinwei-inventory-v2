import React from 'react';

const StatusPill = ({ status }) => {
  const statusLabels = {
    'In Stock': '有库存',
    'High Stock': '库存充足',
    'Low Stock': '库存不足',
    'Out of Stock': '缺货'
  };

  const getStatusStyles = (status) => {
    switch (status) {
      case 'In Stock':
        return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'High Stock':
        return 'bg-green-100 text-green-700 border-green-200';
      case 'Low Stock':
        return 'bg-amber-100 text-amber-700 border-amber-200';
      case 'Out of Stock':
        return 'bg-red-100 text-red-700 border-red-200';
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  return (
    <span className={`inline-flex min-w-max items-center px-3 py-1 whitespace-nowrap rounded-full text-xs font-medium border ${getStatusStyles(status)}`}>
      {statusLabels[status] || status}
    </span>
  );
};

export default StatusPill;
