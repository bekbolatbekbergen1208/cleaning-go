import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const mobileRequire = createRequire(new URL('../../apps/mobile/package.json', import.meta.url));
const expoPackageRequire = createRequire(mobileRequire.resolve('expo/package.json'));
const expoRequire = createRequire(expoPackageRequire.resolve('@expo/config'));
const merge = expoRequire('deepmerge');

test('patched Expo deepmerge rejects prototype-control keys in both operands and nested objects', () => {
  const poisoned = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"nested":{"__proto__":{"polluted":true}},"safe":7}');
  for (const value of [merge(poisoned, {}), merge({}, poisoned), merge.all([{}, poisoned])]) {
    assert.equal(Object.getPrototypeOf(value), Object.prototype);
    assert.equal(value.polluted, undefined);
    assert.equal(Object.hasOwn(value, '__proto__'), false);
    assert.equal(Object.hasOwn(value, 'constructor'), false);
    assert.equal(value.nested.polluted, undefined);
    assert.equal(value.safe, 7);
  }
  assert.equal({}.polluted, undefined);
});
