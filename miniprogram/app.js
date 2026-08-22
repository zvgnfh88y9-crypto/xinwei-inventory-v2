App({
  globalData: {
    functionUrl: 'https://oatkrwhniidjharkautu.supabase.co/functions/v1/wechat-auth',
    session: null
  },
  onLaunch() {
    this.globalData.session = wx.getStorageSync('xinwei_wechat_session') || null;
  }
});

