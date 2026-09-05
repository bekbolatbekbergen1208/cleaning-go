'use server';
import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../../lib/require-admin';

export async function createCommunity(formData: FormData) {
  const name=String(formData.get('name')??'').trim(); const description=String(formData.get('description')??'').trim();
  if(name.length<2||name.length>120) throw new Error('Укажите название сообщества');
  const db=await requireAdmin(); const {data:{user}}=await db.auth.getUser(); if(!user) throw new Error('Администратор не найден');
  const code=`COM-${randomBytes(4).toString('hex').toUpperCase()}`;
  const {error}=await db.from('cleaner_communities').insert({name,description:description||null,code,created_by:user.id}); if(error) throw new Error(error.message);
  revalidatePath('/communities'); revalidatePath('/admin');
}
export async function toggleCommunity(formData: FormData) {
  const db=await requireAdmin(); const {error}=await db.from('cleaner_communities').update({is_active:formData.get('active')==='true'}).eq('id',String(formData.get('id')??'')); if(error) throw new Error(error.message); revalidatePath('/communities');
}
