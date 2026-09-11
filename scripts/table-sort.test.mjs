import test from 'node:test';
import assert from 'node:assert/strict';
import { compareSortValues, compareStockSortValues, nextSortState } from '../src/lib/tableSort.mjs';

test('sorts numeric percentages in descending order', () => {
  const rows = [0, -2.24, 1.2, -7.63, -1.48];
  rows.sort((a, b) => compareSortValues(a, b, 'desc'));
  assert.deepEqual(rows, [1.2, 0, -1.48, -2.24, -7.63]);
});

test('sorts interval returns by absolute change with the largest drop first', () => {
  const rows = [-2.24, -2.43, -7.63, -2.50, -2.29, 0, -2.19, -4.47, -1.48];
  rows.sort((a, b) => compareStockSortValues('ret', a, b, 'desc'));
  assert.deepEqual(rows, [-7.63, -4.47, -2.50, -2.43, -2.29, -2.24, -2.19, -1.48, 0]);
});

test('keeps missing values at the end for descending order', () => {
  const rows = [null, -2, 1, undefined];
  rows.sort((a, b) => compareSortValues(a, b, 'desc'));
  assert.deepEqual(rows, [1, -2, null, undefined]);
});

test('uses descending first for numeric columns and ascending for text', () => {
  assert.deepEqual(nextSortState({ key: null, dir: 'asc' }, 'ret'), { key: 'ret', dir: 'desc' });
  assert.deepEqual(nextSortState({ key: null, dir: 'asc' }, 'name'), { key: 'name', dir: 'asc' });
});

test('toggles direction and clears on the third click', () => {
  const first = nextSortState({ key: null, dir: 'asc' }, 'ret');
  const second = nextSortState(first, 'ret');
  const third = nextSortState(second, 'ret');
  assert.deepEqual(second, { key: 'ret', dir: 'asc' });
  assert.deepEqual(third, { key: null, dir: 'desc' });
});
