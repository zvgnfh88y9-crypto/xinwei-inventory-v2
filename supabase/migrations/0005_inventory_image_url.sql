alter table public.inventory_products
  add column if not exists image_url text;
