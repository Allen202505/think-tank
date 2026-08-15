// src/lib/breakfast.js —— 早餐圆桌：主持人与嘉宾选角逻辑
// 主持人固定为巴菲特；嘉宾按「流派」各抽一位，保证观点碰撞。
import { PRESET_MASTERS } from '../data/masters';
import { normalizeGroup } from '../data/masterGroups';

export const HOST_ID = 'buffett';

// 可抽取嘉宾的流派池（都是人数充足的组，避免抽空）
const GUEST_GROUP_POOL = [
  '价值投资', '宏观对冲', '成长投资', '中国价值',
  'A股游资', '短线', '技术趋势', '科技领袖', '量化投资',
];

function shuffle(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function findMasterById(id) {
  return PRESET_MASTERS.find((m) => m.id === id) || null;
}

export function getHost() {
  return findMasterById(HOST_ID);
}

/**
 * 按流派各抽一位：随机选 count 个不同流派，每个流派随机抽一位大师。
 * @param {number} count 嘉宾人数（默认 3）
 * @param {string[]} excludeIds 需要排除的大师（如当前嘉宾，避免换一批没变化）
 * @param {{realAvatarOnly?: boolean}} opts realAvatarOnly=true 时只从有真人头像
 *   （avatar 为本地图片路径）的大师里抽，避免圆桌出现字母占位头像
 * @returns {{master: object, groupKey: string}[]}
 */
/**
 * 按人数随机抽大师（不管流派）：只要求有真人头像（avatar 为本地图片路径）。
 * 早餐解读按固定框架出结果、不依赖大师流派，所以选角只保证真实头像。
 * @param {number} count 要抽的人数（默认 3）
 * @param {string[]} excludeIds 需要排除的大师 id
 * @param {{realAvatarOnly?: boolean}} opts realAvatarOnly=true 时只抽本地真人头像大师
 * @returns {{master: object, groupKey: string}[]}
 */
export function pickGuestsByStyle(count = 3, excludeIds = [], opts = {}) {
  const { realAvatarOnly = false } = opts || {};
  const pool = PRESET_MASTERS.filter((m) => {
    if (m.id === HOST_ID || (excludeIds || []).includes(m.id)) return false;
    if (realAvatarOnly && !String(m.avatar || '').startsWith('/')) return false;
    return true;
  });
  return shuffle(pool).slice(0, count).map((master) => ({
    master,
    groupKey: normalizeGroup(master.tag),
  }));
}

