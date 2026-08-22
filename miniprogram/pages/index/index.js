const app = getApp();

function today() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

Page({
  data: {
    loading: true,
    uploading: false,
    type: '',
    date: today(),
    partner: '',
    notes: '',
    files: [],
    recent: [],
    user: null
  },

  onLoad() { this.login(); },

  request(action, data = {}, token = '') {
    return new Promise((resolve, reject) => {
      wx.request({
        url: app.globalData.functionUrl,
        method: 'POST',
        header: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        data: { action, ...data },
        success: (response) => response.statusCode >= 200 && response.statusCode < 300
          ? resolve(response.data)
          : reject(new Error(response.data?.error || '服务请求失败')),
        fail: () => reject(new Error('网络连接失败'))
      });
    });
  },

  async login() {
    this.setData({ loading: true });
    try {
      const login = await new Promise((resolve, reject) => wx.login({ success: resolve, fail: reject }));
      const session = await this.request('login', { code: login.code });
      app.globalData.session = session;
      wx.setStorageSync('xinwei_wechat_session', session);
      this.setData({ user: session.user });
      await this.loadRecent();
    } catch (error) {
      wx.showModal({ title: '登录失败', content: error.message || '请稍后重试', showCancel: false });
    } finally { this.setData({ loading: false }); }
  },

  async loadRecent() {
    const token = app.globalData.session?.access_token;
    if (!token) return;
    try {
      const result = await this.request('recent', {}, token);
      this.setData({ recent: result.documents || [] });
    } catch (_) {}
  },

  selectType(event) { this.setData({ type: event.currentTarget.dataset.type, files: [] }); },
  goBack() { this.setData({ type: '', files: [] }); },
  changeDate(event) { this.setData({ date: event.detail.value }); },
  changePartner(event) { this.setData({ partner: event.detail.value }); },
  changeNotes(event) { this.setData({ notes: event.detail.value }); },

  chooseFiles() {
    wx.chooseMedia({
      count: 9,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (result) => this.setData({ files: result.tempFiles.map((file, index) => ({
        path: file.tempFilePath,
        name: `wechat-${Date.now()}-${index + 1}.jpg`
      })) })
    });
  },

  removeFile(event) {
    const index = Number(event.currentTarget.dataset.index);
    this.setData({ files: this.data.files.filter((_, itemIndex) => itemIndex !== index) });
  },

  readBase64(path) {
    return new Promise((resolve, reject) => wx.getFileSystemManager().readFile({ filePath: path, encoding: 'base64', success: resolve, fail: reject }));
  },

  async upload() {
    if (!this.data.type || !this.data.files.length || this.data.uploading) return;
    this.setData({ uploading: true });
    wx.showLoading({ title: `上传 0/${this.data.files.length}`, mask: true });
    try {
      const token = app.globalData.session?.access_token;
      for (let i = 0; i < this.data.files.length; i += 1) {
        wx.showLoading({ title: `上传 ${i + 1}/${this.data.files.length}`, mask: true });
        const encoded = await this.readBase64(this.data.files[i].path);
        await this.request('upload', {
          document_kind: this.data.type,
          document_date: this.data.date,
          partner_name: this.data.partner,
          notes: this.data.notes || '微信小程序快速上传',
          filename: this.data.files[i].name,
          data_url: `data:image/jpeg;base64,${encoded.data}`
        }, token);
      }
      wx.hideLoading();
      wx.showToast({ title: '已通知管理员', icon: 'success' });
      this.setData({ type: '', files: [], partner: '', notes: '' });
      await this.loadRecent();
    } catch (error) {
      wx.hideLoading();
      wx.showModal({ title: '上传失败', content: error.message || '请重试', showCancel: false });
    } finally { this.setData({ uploading: false }); }
  }
});

