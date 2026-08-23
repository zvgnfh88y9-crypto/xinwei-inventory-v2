-- 2026-08-23 Data Synchronization Fix: Integrated Product and Real-time Stock View.
-- This RPC provides combined data for the production order modal.

CREATE OR REPLACE FUNCTION public.v2_get_products_with_stock()
RETURNS TABLE (
    sku_code text,
    name text,
    formal_name text,
    primary_category text,
    spec text,
    base_unit text,
    image_path text,
    available_stock numeric
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.sku_code,
        p.name,
        p.formal_name,
        p.primary_category,
        p.spec,
        p.base_unit,
        p.image_path,
        COALESCE(SUM(b.quantity), 0) as available_stock
    FROM 
        public.v2_product_main p
    LEFT JOIN 
        public.v2_inventory_balances b ON p.sku_code = b.sku_code AND b.status = 'available'
    GROUP BY 
        p.sku_code, p.name, p.formal_name, p.primary_category, p.spec, p.base_unit, p.image_path
    ORDER BY 
        p.sku_code ASC;
END;
$$;
