import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { openDatabase } from '../database.mjs';
import { queryDatabase } from '../query.mjs';
async function* sources(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', '.expo'].includes(entry.name)) continue;
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) yield* sources(path);
    else if (/\.tsx?$/.test(path)) yield path;
  }
}
test('every static application query compiles against the complete local schema', async () => {
  const db = await openDatabase(':memory:');
  let count = 0;
  try {
    for await (const path of sources('apps')) {
      const source = await readFile(path, 'utf8');
      for (const match of source.matchAll(
        /\.from\('([^']+)'\)\s*\.select\('([^']+)'/g,
      )) {
        try {
          await queryDatabase(db, {
            table: match[1],
            columns: match[2],
            limit: 0,
          });
          count++;
        } catch (error) {
          assert.fail(`${path}: ${match[1]}(${match[2]}): ${error.message}`);
        }
      }
    }
    assert.ok(count > 80, `Checked ${count} queries`);
  } finally {
    await db.close();
  }
});
