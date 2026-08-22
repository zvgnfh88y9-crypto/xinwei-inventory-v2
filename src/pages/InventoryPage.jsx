import React from 'react';
import SectionHeading from '../components/common/SectionHeading';
import InventoryTable from '../components/inventory/InventoryTable';

const InventoryPage = ({ user }) => {
  return (
    <div className="space-y-6" data-component="inventory-page">
      <SectionHeading 
        title="主库存管理" 
        subtitle="管理全品类 SKU 资料、库存预警及批次追溯"
      />
      
      <InventoryTable user={user} />
    </div>
  );
};

export default InventoryPage;
