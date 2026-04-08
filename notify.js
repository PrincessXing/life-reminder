// notify.js - 由 GitHub Actions 每分钟运行
// 读取 reminders.json，到时间发 Google Chat 消息

const fs = require('fs');
const path = require('path');

const WEBHOOK = process.env.GC_WEBHOOK;
const FILE = path.join(__dirname, 'reminders.json');

if (!WEBHOOK) { console.log('未设置 GC_WEBHOOK'); process.exit(0); }
if (!fs.existsSync(FILE)) { console.log('reminders.json 不存在'); process.exit(0); }

const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const reminders = data.reminders || [];
const now = Date.now();
let changed = false;

(async () => {
  for (const r of reminders) {
    if (r.done) continue;
    const trigAt = r.at - (r.adv || 0) * 60000;
    // 在触发时间的 90 秒窗口内发送
    if (now >= trigAt && now < trigAt + 90000 && !r._sent) {
      r._sent = true;
      changed = true;
      const emoji = r.cat === 'farm' ? '🌾' : '🔔';
      const text = `${emoji} *${r.title}*${r.note ? '\n' + r.note : ''}`;
      try {
        const res = await fetch(WEBHOOK, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text })
        });
        console.log('推送成功:', r.title, res.status);
      } catch (e) {
        console.error('推送失败:', e.message);
      }
      // 处理重复提醒
      if (r.rep && r.rep !== 'none') {
        r._sent = false;
        if (r.rep === 'daily')    r.at += 86400000;
        else if (r.rep === 'hourly')  r.at += 3600000;
        else if (r.rep === '30min')   r.at += 1800000;
        else if (r.rep === 'weekly')  r.at += 604800000;
        else if (r.rep === 'custom')  r.at += (r.intv || 60) * 60000;
      }
    }
  }
  if (changed) {
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
    console.log('reminders.json 已更新');
  } else {
    console.log('无需推送');
  }
})();
