const { getRecord, removeRecord } = require('../../utils/storage');
const { formatTime } = require('../../utils/format');

Page({
  data: {
    record: null,
  },

  onLoad(options) {
    const record = getRecord(options.id);
    if (!record) {
      wx.showToast({ title: '记录不存在', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 500);
      return;
    }
    this.setData({ record: { ...record, timeText: formatTime(record.createdAt) } });
  },

  deleteRecord() {
    wx.showModal({
      title: '删除这条记录？',
      content: '删除后无法恢复。',
      confirmText: '删除',
      confirmColor: '#9b3f34',
      success: (result) => {
        if (result.confirm && this.data.record) {
          removeRecord(this.data.record.id);
          wx.navigateBack();
        }
      },
    });
  },
});
