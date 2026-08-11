create or replace function public.protect_privileged_fields() returns trigger
language plpgsql set search_path=public as $$
begin
  if current_user not in ('postgres','service_role') and not public.is_admin() then
    if tg_table_name='profiles' then
      new.role:=old.role; new.status:=old.status; new.referral_code:=old.referral_code; new.referred_by:=old.referred_by;
    elsif tg_table_name='cleaner_profiles' then new.verification_status:=old.verification_status;
    elsif tg_table_name='company_profiles' then
      new.verification_status:=old.verification_status; new.tariff_status:=old.tariff_status;
    end if;
  end if;
  return new;
end; $$;

insert into public.cleaning_services(id,slug,name,description,base_price_minor,unit,duration_minutes,sort_order) values
 ('10000000-0000-0000-0000-000000000001','standard','Стандартная уборка','Регулярная уборка квартиры',800000,'за выезд',120,1),
 ('10000000-0000-0000-0000-000000000002','deep','Генеральная уборка','Тщательная уборка всех зон',1800000,'за выезд',300,2),
 ('10000000-0000-0000-0000-000000000003','renovation','После ремонта','Удаление строительной пыли',2500000,'за выезд',420,3),
 ('10000000-0000-0000-0000-000000000004','office','Уборка офиса','Для коммерческих помещений',1500000,'за выезд',240,4),
 ('10000000-0000-0000-0000-000000000005','windows','Мойка окон','Окна и рамы',500000,'за окно',90,5),
 ('10000000-0000-0000-0000-000000000006','furniture','Химчистка мебели','Диваны и кресла',1200000,'за предмет',150,6),
 ('10000000-0000-0000-0000-000000000007','extra','Дополнительная услуга','Индивидуальная задача',300000,'за услугу',60,7)
on conflict(id) do update set name=excluded.name,description=excluded.description,base_price_minor=excluded.base_price_minor,
 unit=excluded.unit,duration_minutes=excluded.duration_minutes,sort_order=excluded.sort_order,is_active=true;

insert into public.service_options(service_id,name,price_minor) values
 ('10000000-0000-0000-0000-000000000001','Внутри холодильника',250000),
 ('10000000-0000-0000-0000-000000000001','Внутри духовки',200000),
 ('10000000-0000-0000-0000-000000000002','Балкон',300000)
on conflict(service_id,name) do update set price_minor=excluded.price_minor,is_active=true;
