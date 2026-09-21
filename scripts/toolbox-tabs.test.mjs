import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TOOLBOX_TAB,
  TOOLBOX_TAB_IDS,
  isToolboxTab,
} from '../src/lib/toolboxTabs.mjs';

test('鱼大基础面研究是功能箱第一个且默认打开的 Tab', () => {
  assert.equal(DEFAULT_TOOLBOX_TAB, 'fundamental');
  assert.equal(TOOLBOX_TAB_IDS[0], 'fundamental');
  assert.deepEqual(TOOLBOX_TAB_IDS, ['fundamental', 'munger', 'zen', 'naval']);
});

test('功能箱 Tab 白名单覆盖四个模块并拒绝未知值', () => {
  for (const id of TOOLBOX_TAB_IDS) assert.equal(isToolboxTab(id), true);
  assert.equal(isToolboxTab('unknown'), false);
});
