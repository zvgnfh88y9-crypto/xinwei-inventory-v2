alter table public.inventory_document_lines
  add column if not exists spec text not null default '';

-- Fill historical document lines from the product master without overwriting
-- any line-level specification that was already reviewed.
update public.inventory_document_lines l
set spec = coalesce(p.spec, '')
from public.inventory_products p
where lower(trim(p.sku)) = lower(trim(l.sku))
  and coalesce(l.spec, '') = ''
  and coalesce(p.spec, '') <> '';
