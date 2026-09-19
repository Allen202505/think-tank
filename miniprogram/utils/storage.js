const HISTORY_KEY = 'finance_notes_history_v1';
const MAX_RECORDS = 30;

function getHistory() {
  try {
    const value = wx.getStorageSync(HISTORY_KEY);
    return Array.isArray(value) ? value : [];
  } catch (error) {
    return [];
  }
}

function saveRecord(record) {
  const next = [record, ...getHistory().filter((item) => item.id !== record.id)].slice(0, MAX_RECORDS);
  wx.setStorageSync(HISTORY_KEY, next);
  return next;
}

function getRecord(id) {
  return getHistory().find((item) => item.id === id) || null;
}

function removeRecord(id) {
  const next = getHistory().filter((item) => item.id !== id);
  wx.setStorageSync(HISTORY_KEY, next);
  return next;
}

function clearHistory() {
  wx.removeStorageSync(HISTORY_KEY);
}

module.exports = {
  getHistory,
  saveRecord,
  getRecord,
  removeRecord,
  clearHistory,
};
