const { getHistory, removeRecord, clearHistory } = require('../../utils/storage');
const { formatTime } = require('../../utils/format');

function decorate(records) {
  return records.map((record) => ({
    ...record,
    timeText: formatTime(record.createdAt),
    typeText: record.type === 'debate' ? '财经圆桌' : '资讯卡片',
  }));
}

Page({
  data: {
    filter: 'all',
    allRecords: [],
    records: [],
  },

  onShow() {
    this.loadRecords();
  },

  loadRecords() {
    const allRecords = decorate(getHistory());
    this.setData({ allRecords, records: this.applyFilter(allRecords, this.data.filter) });
  },

  applyFilter(records, filter) {
    return filter === 'all' ? records : records.filter((record) => record.type === filter);
  },

  changeFilter(event) {
    const filter = event.currentTarget.dataset.filter;
    this.setData({ filter, records: this.applyFilter(this.data.allRecords, filter) });
  },

  openRecord(event) {
    wx.navigateTo({ url: `/pages/history-detail/index?id=${event.currentTarget.dataset.id}` });
  },

  deleteRecord(event) {
    const id = event.currentTarget.dataset.id;
    wx.showModal({
      title: '删除这条记录？',
      content: '删除后无法恢复。',
      confirmText: '删除',
      confirmColor: '#9b3f34',
      success: (result) => {
        if (result.confirm) {
          removeRecord(id);
          this.loadRecords();
        }
      },
    });
  },

  clearAll() {
    if (!this.data.allRecords.length) return;
    wx.showModal({
      title: '清空全部记录？',
      content: '所有本地学习卡片都会被删除，云端不受影响。',
      confirmText: '清空',
      confirmColor: '#9b3f34',
      success: (result) => {
        if (result.confirm) {
          clearHistory();
          this.loadRecords();
        }
      },
    });
  },

  goLearn() {
    wx.navigateTo({ url: '/pages/debate/index' });
  },
});
