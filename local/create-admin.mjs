import { openDatabase } from './database.mjs';
import { passwordHash } from './server.mjs';
const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase(),
  password = process.env.SEED_ADMIN_PASSWORD;
if (!email || !password || password.length < 12)
  throw new Error(
    'Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (at least 12 characters) in .env.local',
  );
const db = await openDatabase();
try {
  await db.transaction(async (tx) => {
    const existing = (
      await tx.query('select id from auth.users where email=$1', [email])
    ).rows[0];
    const id =
      existing?.id ||
      (
        await tx.query(
          'insert into auth.users(email,encrypted_password,raw_user_meta_data) values($1,$2,$3) returning id',
          [
            email,
            await passwordHash(password),
            { full_name: 'Администратор', role: 'client' },
          ],
        )
      ).rows[0].id;
    await tx.query('update auth.users set encrypted_password=$1 where id=$2', [
      await passwordHash(password),
      id,
    ]);
    await tx.query(
      "update public.profiles set role='admin',status='active' where id=$1",
      [id],
    );
    await tx.query('delete from auth.sessions where user_id=$1', [id]);
  });
  console.log('Local administrator ready');
} finally {
  await db.close();
}
