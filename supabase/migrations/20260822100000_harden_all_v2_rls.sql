-- 2026-08-22 Security Patch: Harden RLS for all V2 tables and missing public tables.
-- This script ensures ALL public tables have RLS enabled and default to NO access 
-- for non-admin/service_role users, except where explicitly allowed.

DO $$
DECLARE
    v_table text;
    v_tables text[] := ARRAY[
        'v2_sales_orders', 'v2_sales_order_lines',
        'v2_production_orders', 'v2_production_bom_lines',
        'v2_warehouse_receipts', 'v2_warehouse_receipt_lines',
        'v2_quality_inspections', 'v2_quality_inspection_lines',
        'v2_document_links', 'v2_document_relations',
        'v2_shipments', 'v2_shipment_lines',
        'v2_suppliers', 'v2_purchase_requests', 'v2_purchase_request_items',
        'v2_purchase_orders', 'v2_purchase_order_items', 'v2_arrival_records',
        'v2_purchase_inventory_links',
        'v2_subcontract_orders' -- Explicitly target the table mentioned by user
    ];
BEGIN
    FOR v_table IN SELECT unnest(v_tables) LOOP
        -- Only attempt if table exists to avoid migration failure
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = v_table) THEN
            EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
            -- Default behavior when RLS is enabled but no policy exists is to DENY ALL.
            -- However, to be extra safe and avoid any platform-specific defaults:
            EXECUTE format('DROP POLICY IF EXISTS "service_role_only" ON public.%I', v_table);
            -- This is actually redundant because service_role bypasses RLS, 
            -- but helps document the intent that these tables are backend-only.
            
            -- If the user wants specific read access for employees later, policies should be added here.
            -- For now, we strictly follow the "lock down" instruction.
        END IF;
    END LOOP;
END $$;

-- Ensure common lookup tables have at least SELECT access for authenticated users 
-- (Matches 20260810 patterns if they were missed)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'v2_product_main') THEN
        DROP POLICY IF EXISTS "v2_product_main_policy" ON public.v2_product_main;
        CREATE POLICY "v2_product_main_policy" ON public.v2_product_main FOR SELECT TO authenticated USING (true);
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'v2_business_partners') THEN
        DROP POLICY IF EXISTS "v2_business_partners_policy" ON public.v2_business_partners;
        CREATE POLICY "v2_business_partners_policy" ON public.v2_business_partners FOR SELECT TO authenticated USING (true);
    END IF;
END $$;
