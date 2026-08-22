ALTER TABLE public.v2_source_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "v2_source_docs_policy" ON public.v2_source_documents;
CREATE POLICY "v2_source_docs_policy" ON public.v2_source_documents FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.v2_product_main ENABLE ROW LEVEL SECURITY;
CREATE POLICY "v2_product_main_policy" ON public.v2_product_main FOR SELECT TO authenticated USING (true);

ALTER TABLE public.v2_product_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "v2_product_aliases_policy" ON public.v2_product_aliases FOR SELECT TO authenticated USING (true);

ALTER TABLE public.v2_business_partners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "v2_business_partners_policy" ON public.v2_business_partners FOR SELECT TO authenticated USING (true);

ALTER TABLE public.v2_inventory_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "v2_inventory_balances_policy" ON public.v2_inventory_balances FOR SELECT TO authenticated USING (true);

ALTER TABLE public.v2_business_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "v2_business_events_policy" ON public.v2_business_events FOR ALL TO authenticated USING (true) WITH CHECK (true);
;
