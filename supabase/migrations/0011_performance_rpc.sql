-- 1. 高性能汇总函数：一次性返回所有 KPI 指标
create or replace function public.get_inventory_summary_v2()
returns jsonb
language plpgsql
security definer
as $$
declare
  v_res jsonb;
begin
  select jsonb_build_object(
    'sku_count', count(*),
    'total_stock', coalesce(sum(stock), 0),
    'available_stock', coalesce(sum(available_stock), 0),
    'total_value', coalesce(sum(stock * price), 0),
    'low_stock_count', count(*) filter (where stock > 0 and stock <= 100),
    'out_of_stock_count', count(*) filter (where stock <= 0),
    'last_updated', now()
  ) into v_res
  from inventory_products;
  
  return v_res;
end;
$$;
-- 2. 高性能分类分布函数
create or replace function public.get_category_distribution()
returns jsonb
language plpgsql
security definer
as $$
declare
  v_res jsonb;
begin
  select jsonb_agg(d) into v_res
  from (
    select 
      category as name,
      sum(stock) as total,
      round(sum(stock) * 100.0 / nullif(sum(sum(stock)) over(), 0), 1) as value
    from inventory_products
    group by category
    order by total desc
    limit 10
  ) d;
  
  return coalesce(v_res, '[]'::jsonb);
end;
$$;
