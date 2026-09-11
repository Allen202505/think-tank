import test from 'node:test';
import assert from 'node:assert/strict';
import { compareSortValues } from '../src/lib/tableSort.mjs';

test('sorts numeric percentages in descending order', () => {
  const rows = [0, -2.24, 1.2, -7.63, -1.48];
  rows.sort((a, b) => compareSortValues(a, b, 'desc'));
  assert.deepEqual(rows, [1.2, 0, -1.48, -2.24, -7.63]);
});

test('sorts signed interval returns in descending order', () => {
  const rows = [1.2, 0, -1.48, -2.24, -7.63, 10.3, -3.75];
  rows.sort((a, b) => compareSortValues(a, b, 'desc'));
  assert.deepEqual(rows, [10.3, 1.2, 0, -1.48, -2.24, -3.75, -7.63]);
});

test('sorts signed interval returns in ascending order', () => {
  const rows = [1.2, 0, -1.48, -2.24, -7.63, 10.3, -3.75];
  rows.sort((a, b) => compareSortValues(a, b, 'asc'));
  assert.deepEqual(rows, [-7.63, -3.75, -2.24, -1.48, 0, 1.2, 10.3]);
});

test('keeps missing values at the end for descending order', () => {
  const rows = [null, -2, 1, undefined];
  rows.sort((a, b) => compareSortValues(a, b, 'desc'));
  assert.deepEqual(rows, [1, -2, null, undefined]);
});
