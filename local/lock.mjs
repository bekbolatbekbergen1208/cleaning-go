import { open, readFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
export async function lockDatabase(path) {
  const file = resolve(`${path}.process-lock`);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const handle = await open(file, 'wx', 0o600);
      await handle.writeFile(String(process.pid));
      await handle.close();
      return async () => {
        await unlink(file).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        });
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const pid = Number(await readFile(file, 'utf8'));
      if (!Number.isInteger(pid) || pid <= 0)
        throw new Error(
          'Invalid database lock. Stop the API and inspect .process-lock.',
        );
      try {
        process.kill(pid, 0);
      } catch (error) {
        if (error.code === 'ESRCH') {
          await unlink(file).catch((e) => {
            if (e.code !== 'ENOENT') throw e;
          });
          continue;
        }
        throw error;
      }
      throw new Error(
        `Local database is already open by process ${pid}. Stop the API before using the database CLI.`,
      );
    }
  }
  throw new Error('Cannot acquire database lock');
}
