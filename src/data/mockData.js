export const inventoryData = [
  {
    id: 'SKU-001',
    name: '高弹力松紧头带 - 医疗级',
    category: '头带',
    spec: '2.5cm * 45cm',
    stock: 15400,
    unit: '条',
    price: 3.5,
    source: 'A线生产',
    status: 'In Stock',
  },
  {
    id: 'SKU-002',
    name: '加厚款摇粒绒面料 - 宝蓝色',
    category: '摇粒绒',
    spec: '150cm * 100m/卷',
    stock: 85,
    unit: '卷',
    price: 450,
    source: '外购仓',
    status: 'High Stock',
  },
  {
    id: 'SKU-003',
    name: '自粘式伤口敷贴 - 灭菌型',
    category: '敷贴',
    spec: '10cm * 10cm',
    stock: 12,
    unit: '盒',
    price: 12.8,
    source: '洁净车间',
    status: 'Low Stock',
  },
  {
    id: 'SKU-004',
    name: '可调式腰部固定带 - L码',
    category: '固定带',
    spec: '120cm * 25cm',
    stock: 2,
    unit: '套',
    price: 88,
    source: 'B线生产',
    status: 'Low Stock',
  },
  {
    id: 'SKU-005',
    name: '医用级弹性绷带',
    category: '敷贴',
    spec: '7.5cm * 4.5m',
    stock: 5200,
    unit: '卷',
    price: 5.2,
    source: '外购仓',
    status: 'In Stock',
  },
  {
    id: 'SKU-006',
    name: '尼龙织带 - 黑色加固型',
    category: '头带',
    spec: '3.8cm * 50m/卷',
    stock: 320,
    unit: '卷',
    price: 28,
    source: 'A线生产',
    status: 'In Stock',
  }
];

export const kpiStats = [
  { label: '库存 SKU 总数', value: '125,400', color: 'blue', icon: 'Box' },
  { label: '低库存预警', value: '12', color: 'yellow', icon: 'AlertTriangle' },
  { label: '缺货 SKU', value: '2', color: 'red', icon: 'XCircle' },
  { label: '待处理同步', value: '5', color: 'green', icon: 'RefreshCw' },
];

export const recentChanges = [
  { id: 1, type: 'IN', item: '高弹力松紧头带', qty: '+5,000', time: '10分钟前' },
  { id: 2, type: 'OUT', item: '可调式腰部固定带', qty: '-20', time: '45分钟前' },
  { id: 3, type: 'IN', item: '加厚款摇粒绒面料', qty: '+10', time: '1小时前' },
  { id: 4, type: 'OUT', item: '自粘式伤口敷贴', qty: '-50', time: '3小时前' },
  { id: 5, type: 'IN', item: '尼龙织带', qty: '+100', time: '昨日 17:30' },
];

export const categoryDistribution = [
  { name: '头带', value: 35, color: '#2563eb' },
  { name: '摇粒绒', value: 25, color: '#3b82f6' },
  { name: '敷贴', value: 22, color: '#60a5fa' },
  { name: '固定带', value: 18, color: '#93c5fd' },
];
