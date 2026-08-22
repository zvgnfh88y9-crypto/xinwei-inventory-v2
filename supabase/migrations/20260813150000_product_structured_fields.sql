-- Structured product attributes used by inventory search and product master data.
-- Keep the legacy category/spec columns intact so historical imports and documents
-- continue to work while products are gradually classified.

alter table public.inventory_products
  add column if not exists primary_category text not null default '',
  add column if not exists secondary_type text not null default '',
  add column if not exists material text not null default '',
  add column if not exists adhesive_type text not null default '',
  add column if not exists width_mm numeric(10, 2),
  add column if not exists color text not null default '';

alter table public.inventory_products
  drop constraint if exists inventory_products_width_mm_check;

alter table public.inventory_products
  add constraint inventory_products_width_mm_check
  check (width_mm is null or width_mm >= 0);

-- Existing category remains the compatible source for the first-level category.
update public.inventory_products
set primary_category = category
where coalesce(primary_category, '') = ''
  and coalesce(category, '') <> '';

create index if not exists inventory_products_primary_category_idx
  on public.inventory_products(primary_category);
create index if not exists inventory_products_secondary_type_idx
  on public.inventory_products(secondary_type);
create index if not exists inventory_products_material_idx
  on public.inventory_products(material);
create index if not exists inventory_products_adhesive_type_idx
  on public.inventory_products(adhesive_type);
create index if not exists inventory_products_width_mm_idx
  on public.inventory_products(width_mm);
create index if not exists inventory_products_color_idx
  on public.inventory_products(color);

comment on column public.inventory_products.primary_category is '一级品类，如魔术贴、织带、松紧带';
comment on column public.inventory_products.secondary_type is '二级类型，如勾面、毛面、勾毛一体';
comment on column public.inventory_products.material is '产品材质，如尼龙、涤纶';
comment on column public.inventory_products.adhesive_type is '背胶类型，如无背胶、普通背胶、强力背胶';
comment on column public.inventory_products.width_mm is '产品宽度，统一按毫米记录';
comment on column public.inventory_products.color is '产品颜色';
