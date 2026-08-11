import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';

const env={};for(const line of readFileSync('.env','utf8').split(/\r?\n/)){const s=line.trim();if(!s||s.startsWith('#'))continue;const i=s.indexOf('=');if(i>0)env[s.slice(0,i).trim()]=s.slice(i+1).trim().replace(/^['"]|['"]$/g,'')}
const required=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SEED_ADMIN_EMAIL','SEED_ADMIN_PASSWORD'];
for(const key of required)if(!env[key])throw new Error(`${key} не заполнен.`);
if(env.SEED_ADMIN_PASSWORD.length<12)throw new Error('Пароль администратора должен содержать минимум 12 символов.');
const ref=new URL(env.SUPABASE_URL).hostname.split('.')[0];
const client=createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const {data:list,error:listError}=await client.auth.admin.listUsers({page:1,perPage:1000});if(listError)throw listError;
let user=list.users.find(x=>x.email?.toLowerCase()===env.SEED_ADMIN_EMAIL.toLowerCase());
if(!user){const{data,error}=await client.auth.admin.createUser({email:env.SEED_ADMIN_EMAIL,password:env.SEED_ADMIN_PASSWORD,email_confirm:true,user_metadata:{full_name:'Администратор Cleaning Go',role:'client'}});if(error)throw error;user=data.user}else{const{data,error}=await client.auth.admin.updateUserById(user.id,{password:env.SEED_ADMIN_PASSWORD,email_confirm:true});if(error)throw error;user=data.user}
console.log('AUTH_ADMIN=READY');
const password=execFileSync('osascript',['-e','display dialog "Введите пароль базы Supabase для финальной настройки Cleaning Go" default answer "" with hidden answer buttons {"Отмена", "Продолжить"} default button "Продолжить"','-e','text returned of result'],{encoding:'utf8'}).trim();
const connection=`postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-1-ap-south-1.pooler.supabase.com:5432/postgres`;
const sql=postgres(connection,{ssl:'require',max:1,connect_timeout:15,onnotice:()=>{}});
try{await sql.unsafe(readFileSync('supabase/migrations/202608010005_bootstrap.sql','utf8'));await sql`update public.profiles set role='admin',status='active' where id=${user.id}`;const rows=await sql`select role::text role from public.profiles where id=${user.id}`;if(rows[0]?.role!=='admin')throw new Error('Роль admin не сохранена.');console.log('CATALOG=READY');console.log('ADMIN_ROLE=READY')}finally{await sql.end({timeout:5})}
