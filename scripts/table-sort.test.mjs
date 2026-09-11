import test from 'node:test';
import assert from 'node:assert/strict';
import { compareSortValues, compareStockSortValues } from '../src/lib/tableSort.mjs';

test('sorts numeric percentages in descending order', () => {
  const rows = [0, -2.24, 1.2, -7.63, -1.48];
  rows.sort((a, b) => compareSortValues(a, b, 'desc'));
  assert.deepEqual(rows, [1.2, 0, -1.48, -2.24, -7.63]);
});

test('sorts interval returns by absolute change in descending order', () => {
  const rows = [-2.24, -2.43, -7.63, -2.50, -2.29, 0, -2.19, -4.47, -1.48];
  rows.sort((a, b) => compareStockSortValues('ret', a, b, 'desc'));
  assert.deepEqual(rows, [-7.63, -4.47, -2.50, -2.43, -2.29, -2.24, -2.19, -1.48, 0]);
});

test('sorts interval returns by absolute change in ascending order', () => {
  const rows = [-2.24, -2.43, -7.63, -2.50, -2.29, 0, -2.19, -4.47, -1.48];
  rows.sort((a, b) => compareStockSortValues('ret', a, b, 'asc'));
  assert.deepEqual(rows, [0, -1.48, -2.19, -2.24, -2.29, -2.43, -2.50, -4.47, -7.63]);
});

test('keeps missing values at the end for descending order', () => {
  const rows = [null, -2, 1, undefined];
  rows.sort((a, b) => compareSortValues(a, b, 'desc'));
  assert.deepEqual(rows, [1, -2, null, undefined]);
});
