-- 1. 为产品表添加更高效的索引
create index if not exists inventory_products_sku_idx on public.inventory_products(sku);
create index if not exists inventory_products_name_idx on public.inventory_products(name);
create index if not exists inventory_products_created_at_idx on public.inventory_products(created_at desc);
-- 2. 为活动日志表添加索引
create index if not exists inventory_activity_sku_idx on public.inventory_activity(sku);
create index if not exists inventory_activity_created_at_idx on public.inventory_activity(created_at desc);
-- 3. 为单据和流水表添加索引
create index if not exists inventory_documents_status_idx on public.inventory_documents(status);
create index if not exists inventory_documents_created_at_idx on public.inventory_documents(created_at desc);
create index if not exists inventory_movements_sku_idx on public.inventory_movements(sku);
create index if not exists inventory_movements_business_date_idx on public.inventory_movements(business_date desc);
