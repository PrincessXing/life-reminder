// notify.js - GitHub Actions 每分钟运行，检查并发送提醒

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

const CAT = { life:'🌿', work:'💼', health:'❤️', study:'📚', food:'🍽️', sport:'🏃', farm:'🌾', other:'📌' };

(async () => {
  for (const r of reminders) {
    if (r.done || r._sent) continue;
    const trigAt = r.at - (r.adv || 0) * 60000;
    if (now >= trigAt && now < trigAt + 90000) {
      r._sent = true;
      changed = true;
      const emoji = CAT[r.cat] || '📌';
      const text = `${emoji} *${r.title}*${r.note ? '\n' + r.note : ''}`;
      try {
        const res = await fetch(WEBHOOK, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text })
        });
        console.log('已发送:', r.title, '状态:', res.status);
      } catch (e) {
        console.log('发送失败:', e.message);
      }
    }
  }

  if (changed) {
    fs.writeFileSync(FILE, JSON.stringify({ reminders }, null, 2));
    console.log('reminders.json 已更新');
  } else {
    console.log('当前无需发送的提醒, now:', now);
  }
})();
