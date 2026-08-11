-- Snapshot the selected company's cashback for every order, not only promo-locked clients.
create or replace function public.snapshot_order_fees() returns trigger
language plpgsql security definer set search_path=public as $$
declare cfg public.platform_settings; company_bps integer:=0;
begin
  select * into cfg from public.platform_settings where id=true;
  if new.selected_company_id is not null then
    select cashback_bps into company_bps from public.company_profiles where id=new.selected_company_id;
  end if;
  new.platform_fee_bps_snapshot:=cfg.platform_fee_bps;
  new.referral_fee_bps_snapshot:=cfg.referral_fee_bps;
  new.company_cashback_bps_snapshot:=coalesce(company_bps,0);
  return new;
end; $$;

comment on column public.orders.company_cashback_bps_snapshot is
  'Company cashback percentage frozen when the order is created; paid after every paid completed order.';
