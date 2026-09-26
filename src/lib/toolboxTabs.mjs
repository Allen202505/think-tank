export const DEFAULT_TOOLBOX_TAB = 'fundamental';

export const TOOLBOX_TAB_IDS = [
  DEFAULT_TOOLBOX_TAB,
  'munger',
  'zen',
  'naval',
  'strategy-gallery',
];

export function isToolboxTab(id) {
  return TOOLBOX_TAB_IDS.includes(id);
}
