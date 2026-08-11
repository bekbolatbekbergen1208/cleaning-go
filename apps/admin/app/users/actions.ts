'use server';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../../lib/require-admin';
export async function setUserStatus(form: FormData) { const db=await requireAdmin(); const id=String(form.get('id')); const status=String(form.get('status')); const reason=String(form.get('reason')??'').trim(); if(!['active','blocked'].includes(status)||status==='blocked'&&!reason) throw new Error('Для блокировки укажите причину'); const {error}=await db.from('profiles').update({status}).eq('id',id).neq('role','admin'); if(error)throw error; await db.from('admin_action_logs').insert({admin_id:(await db.auth.getUser()).data.user!.id,action:status==='blocked'?'block_user':'unblock_user',entity_type:'profile',entity_id:id,new_data:{status,reason}}); revalidatePath('/users'); }
