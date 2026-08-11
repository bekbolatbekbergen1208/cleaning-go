import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
const env={};for(const line of readFileSync('.env','utf8').split(/\r?\n/)){const value=line.trim(),i=value.indexOf('=');if(i>0&&!value.startsWith('#'))env[value.slice(0,i).trim()]=value.slice(i+1).trim().replace(/^['"]|['"]$/g,'')}
const ref=new URL(env.SUPABASE_URL).hostname.split('.')[0];
const password=execFileSync('osascript',['-e','display dialog "Введите пароль базы Supabase для исправления загрузки постоянного кода компании" default answer "" with hidden answer buttons {"Отмена", "Продолжить"} default button "Продолжить"','-e','text returned of result'],{encoding:'utf8'}).trim();
if(!password)throw new Error('Пароль базы не введён.');
const sql=postgres(`postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-1-ap-south-1.pooler.supabase.com:5432/postgres`,{ssl:'require',max:1,connect_timeout:15,onnotice:()=>{}});
try{await sql.unsafe(readFileSync('supabase/migrations/202608010009_company_report_code.sql','utf8'));console.log('REPORT_COMPANY_CODE=READY')}finally{await sql.end({timeout:5})}

