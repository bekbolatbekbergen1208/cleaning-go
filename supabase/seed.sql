-- Демо-данные не предназначены для production. Пароли здесь намеренно не заданы:
-- интерактивные тестовые аккаунты создавайте через Dashboard/seed script с .env.
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select (md5('demo-user-'||n)::uuid),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
  'demo'||n||'@example.test',extensions.crypt(encode(extensions.gen_random_bytes(32),'hex'),extensions.gen_salt('bf')),now(),'{}',
  jsonb_build_object('full_name',case when n=27 then 'Администратор Demo' else 'Пользователь '||n end,'role','client'),now(),now()
from generate_series(1,27)n on conflict(id) do nothing;

-- Доверенная подготовка ролей для seed; публичная регистрация применяет проверку кода.
update public.profiles set role='cleaner' where id in(select md5('demo-user-'||n)::uuid from generate_series(6,22)n);
update public.profiles set role='company_owner' where id in(select md5('demo-user-'||n)::uuid from generate_series(23,25)n);
update public.profiles set role='admin' where id=md5('demo-user-27')::uuid;
insert into public.cleaner_profiles(user_id)
select md5('demo-user-'||n)::uuid from generate_series(6,22)n on conflict(user_id) do nothing;
insert into public.company_profiles(owner_id,name)
select md5('demo-user-'||n)::uuid,'Компания '||n from generate_series(23,25)n on conflict(owner_id) do nothing;
update public.cleaner_profiles set verification_status='approved',experience_years=(1+extract(day from created_at)::int%8),bio='Проверенный специалист Cleaning Go',work_zone='Актау',is_available=true
where user_id in(select md5('demo-user-'||n)::uuid from generate_series(6,22)n);

-- Владельцы 23–25 получили company_profiles из auth-триггера.
update public.company_profiles c set name=x.name,verification_status='approved',service_cities=array['Актау'],description='Проверенная клининговая компания'
from(values(md5('demo-user-23')::uuid,'Таза Үй'),(md5('demo-user-24')::uuid,'Aqtau Clean'),(md5('demo-user-25')::uuid,'Sea Breeze Cleaning'))x(owner_id,name)
where c.owner_id=x.owner_id;

-- По три сотрудника для каждой компании (часть demo-клинеров).
insert into public.company_cleaners(company_id,cleaner_id)
select ranked.id,md5('demo-user-'||n)::uuid from
  (select id,row_number() over(order by id)::int rn from public.company_profiles where owner_id in(md5('demo-user-23')::uuid,md5('demo-user-24')::uuid,md5('demo-user-25')::uuid)) ranked
cross join lateral generate_series(6+(ranked.rn-1)*3,8+(ranked.rn-1)*3)n
on conflict do nothing;

insert into public.cleaning_services(id,slug,name,description,base_price_minor,unit,duration_minutes,sort_order) values
 ('10000000-0000-0000-0000-000000000001','standard','Стандартная уборка','Регулярная уборка квартиры',800000,'за выезд',120,1),
 ('10000000-0000-0000-0000-000000000002','deep','Генеральная уборка','Тщательная уборка всех зон',1800000,'за выезд',300,2),
 ('10000000-0000-0000-0000-000000000003','renovation','После ремонта','Удаление строительной пыли',2500000,'за выезд',420,3),
 ('10000000-0000-0000-0000-000000000004','office','Уборка офиса','Для коммерческих помещений',1500000,'за выезд',240,4),
 ('10000000-0000-0000-0000-000000000005','windows','Мойка окон','Окна и рамы',500000,'за окно',90,5),
 ('10000000-0000-0000-0000-000000000006','furniture','Химчистка мебели','Диваны и кресла',1200000,'за предмет',150,6),
 ('10000000-0000-0000-0000-000000000007','extra','Дополнительная услуга','Индивидуальная задача',300000,'за услугу',60,7)
on conflict(id) do update set name=excluded.name;
insert into public.service_options(service_id,name,price_minor) values
 ('10000000-0000-0000-0000-000000000001','Внутри холодильника',250000),
 ('10000000-0000-0000-0000-000000000001','Внутри духовки',200000),
 ('10000000-0000-0000-0000-000000000002','Балкон',300000) on conflict do nothing;

insert into public.addresses(id,user_id,label,city,address_line,is_default)
select md5('demo-address-'||n)::uuid,md5('demo-user-'||n)::uuid,'Дом','Актау','Микрорайон '||n||', дом '||(10+n),true from generate_series(1,5)n
on conflict(id) do nothing;

insert into public.orders(id,client_id,service_id,address_id,city,address_text,scheduled_at,area_sq_m,rooms_count,status,payment_method,payment_status,subtotal_minor,total_minor,completed_at)
select md5('demo-order-'||n)::uuid,md5('demo-user-'||(1+(n%5)))::uuid,
 ('10000000-0000-0000-0000-00000000000'||(1+(n%7)))::uuid,md5('demo-address-'||(1+(n%5)))::uuid,'Актау','Микрорайон '||(1+(n%5))||', дом '||(11+n),
 now()+((n-10)||' days')::interval,40+n*3,1+(n%4),
  case when n<=15 then 'completed'::public.order_status else (array['searching','accepted','on_the_way','cancelled','disputed']::public.order_status[])[n-15] end,
 (array['cash','card','test']::public.payment_method[])[1+(n%3)],case when n%4=0 then 'pending'::public.payment_status else 'paid'::public.payment_status end,
  800000+(n%7)*200000,800000+(n%7)*200000,case when n<=15 then now()-interval '1 day' end
from generate_series(1,20)n on conflict(id) do nothing;

insert into public.order_assignments(order_id,cleaner_id,assigned_by,accepted_at)
select o.id,md5('demo-user-'||(6+(row_number() over(order by o.id)%8)))::uuid,md5('demo-user-27')::uuid,now()-interval '2 hours'
from public.orders o where o.status not in('searching','cancelled') on conflict do nothing;

insert into public.reviews(order_id,client_id,cleaner_id,rating,text,tags)
select o.id,o.client_id,a.cleaner_id,3+(row_number() over()%3),'Демонстрационный отзыв о выполненном заказе',array['качественная уборка','рекомендую']
from public.orders o join public.order_assignments a on a.order_id=o.id and a.is_active
where o.status in('completed','completed_by_cleaner') limit 15 on conflict(order_id) do nothing;

-- Демо-реферал и начисление создаются той же серверной финансовой функцией.
insert into public.referrals(referrer_id,referred_user_id,code_id)
select p1.id,p2.id,c.id from public.profiles p1 join public.referral_codes c on c.owner_id=p1.id cross join public.profiles p2
where p1.id=md5('demo-user-1')::uuid and p2.id=md5('demo-user-2')::uuid on conflict(referred_user_id) do nothing;
select public.finalize_order_finances((select id from public.orders where client_id=md5('demo-user-2')::uuid and status='completed' order by created_at limit 1));
