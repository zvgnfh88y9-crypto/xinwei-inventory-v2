import { inventoryData as fallbackInventoryData, recentChanges as fallbackActivity } from './mockData';

export const INVENTORY_STORAGE_KEY = 'xinwei_inventory_data';
export const INVENTORY_UPDATED_EVENT = 'xinwei-inventory-updated';
export const INVENTORY_ACTIVITY_STORAGE_KEY = 'xinwei_inventory_activity';
export const INVENTORY_ACTIVITY_UPDATED_EVENT = 'xinwei-inventory-activity-updated';
export const CLOUD_INVENTORY_UPDATED_EVENT = 'xinwei-cloud-inventory-updated';

export const notifyCloudInventoryUpdated = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CLOUD_INVENTORY_UPDATED_EVENT));
};

export const readInventoryData = () => {
  if (typeof window === 'undefined') return fallbackInventoryData;

  const savedData = window.localStorage.getItem(INVENTORY_STORAGE_KEY);
  if (!savedData) return fallbackInventoryData;

  try {
    const parsedData = JSON.parse(savedData);
    return Array.isArray(parsedData) ? parsedData : fallbackInventoryData;
  } catch {
    return fallbackInventoryData;
  }
};

export const readInventoryActivity = () => {
  if (typeof window === 'undefined') return fallbackActivity;

  const savedActivity = window.localStorage.getItem(INVENTORY_ACTIVITY_STORAGE_KEY);
  if (!savedActivity) return fallbackActivity;

  try {
    const parsedActivity = JSON.parse(savedActivity);
    return Array.isArray(parsedActivity) ? parsedActivity : fallbackActivity;
  } catch {
    return fallbackActivity;
  }
};

export const recordInventoryActivity = ({ type, item, qty, detail, changes, actor }) => {
  if (typeof window === 'undefined') return;

  const activity = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    item,
    qty,
    detail,
    changes,
    actor: actor || '系统管理员',
    time: new Date().toLocaleString('zh-CN', { hour12: false })
  };
  const nextActivity = [activity, ...readInventoryActivity()].slice(0, 10);
  window.localStorage.setItem(INVENTORY_ACTIVITY_STORAGE_KEY, JSON.stringify(nextActivity));
  window.dispatchEvent(new CustomEvent(INVENTORY_ACTIVITY_UPDATED_EVENT));
};

export const subscribeInventoryActivity = (callback) => {
  if (typeof window === 'undefined') return () => {};

  const handleActivityUpdate = () => callback(readInventoryActivity());
  const handleStorageUpdate = (event) => {
    if (event.key === INVENTORY_ACTIVITY_STORAGE_KEY) {
      callback(readInventoryActivity());
    }
  };

  window.addEventListener(INVENTORY_ACTIVITY_UPDATED_EVENT, handleActivityUpdate);
  window.addEventListener('storage', handleStorageUpdate);

  return () => {
    window.removeEventListener(INVENTORY_ACTIVITY_UPDATED_EVENT, handleActivityUpdate);
    window.removeEventListener('storage', handleStorageUpdate);
  };
};

export const notifyInventoryUpdated = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(INVENTORY_UPDATED_EVENT));
  }
};

export const subscribeInventoryUpdates = (callback) => {
  if (typeof window === 'undefined') return () => {};

  const handleCustomUpdate = () => callback(readInventoryData());
  const handleStorageUpdate = (event) => {
    if (event.key === INVENTORY_STORAGE_KEY) {
      callback(readInventoryData());
    }
  };

  window.addEventListener(INVENTORY_UPDATED_EVENT, handleCustomUpdate);
  window.addEventListener('storage', handleStorageUpdate);

  return () => {
    window.removeEventListener(INVENTORY_UPDATED_EVENT, handleCustomUpdate);
    window.removeEventListener('storage', handleStorageUpdate);
  };
};

export const getInventoryMetrics = (data) => {
  const skuCount = data.length;
  // 物理总库存 = 数据库中的主库存 stock
  const totalStock = data.reduce((sum, item) => sum + Number(item.stock || 0), 0);
  // 可用库存 = 主库存 - 锁定库存 (locked_stock) - 次品库存 (defective_stock)
  const availableStock = data.reduce((sum, item) => {
    const locked = Number(item.locked_stock || 0);
    const defective = Number(item.defective_stock || 0);
    return sum + (Number(item.stock || 0) - locked - defective);
  }, 0);
  
  const lowStockCount = data.filter((item) => Number(item.stock || 0) > 0 && Number(item.stock || 0) <= 100).length;
  const outOfStockCount = data.filter((item) => Number(item.stock || 0) <= 0).length;

  // 统一维度：产品分类 (Category)
  const totalsByCategory = data.reduce((totals, item) => {
    const category = item.category || '未分类';
    totals[category] = (totals[category] || 0) + Number(item.stock || 0);
    return totals;
  }, {});

  const categoryColors = ['#2563eb', '#60a5fa', '#93c5fd', '#dbeafe', '#bfdbfe', '#3b82f6'];
  const categoryTotal = Object.values(totalsByCategory).reduce((sum, value) => sum + value, 0);
  const categoryEntries = Object.entries(totalsByCategory);
  const distribution = categoryEntries.map(([name, value], index) => {
    const previousValues = categoryEntries.slice(0, index).reduce((sum, [, previousValue]) => sum + previousValue, 0);
    const percentage = categoryTotal > 0 ? (value / categoryTotal) * 100 : 0;
    const previousPercentage = categoryTotal > 0 ? (previousValues / categoryTotal) * 100 : 0;
    
    return {
      name,
      total: value,
      value: Math.round(percentage),
      offset: -Math.round(previousPercentage),
      color: categoryColors[index % categoryColors.length]
    };
  });

  return {
    skuCount,
    totalStock,
    availableStock,
    lowStockCount,
    outOfStockCount,
    distribution
  };
};

const distributionPercentageSum = (entries, lastIndex, total) => {
  if (!total || lastIndex <= 0) return 0;
  return entries.slice(0, lastIndex).reduce((sum, [, value]) => sum + Math.round((value / total) * 100), 0);
};
