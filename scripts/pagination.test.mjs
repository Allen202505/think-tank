import test from 'node:test';
import assert from 'node:assert/strict';
import { paginateItems } from '../src/lib/pagination.mjs';

test('分页默认每页 10 条并返回正确页码信息', () => {
  const items = Array.from({ length: 23 }, (_, index) => index + 1);
  const third = paginateItems(items, 3, 10);
  assert.deepEqual(third.items, [21, 22, 23]);
  assert.equal(third.page, 3);
  assert.equal(third.totalPages, 3);
  assert.equal(third.total, 23);
  assert.equal(third.start, 21);
  assert.equal(third.end, 23);
});

test('分页页码越界时会自动夹到有效范围', () => {
  const items = Array.from({ length: 12 }, (_, index) => index + 1);
  assert.equal(paginateItems(items, 99, 10).page, 2);
  assert.equal(paginateItems(items, 0, 10).page, 1);
  assert.deepEqual(paginateItems([], 8, 10), {
    items: [],
    page: 1,
    pageSize: 10,
    total: 0,
    totalPages: 1,
    start: 0,
    end: 0,
  });
});
