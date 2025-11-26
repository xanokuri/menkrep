const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals: { GoalBlock } } = require('mineflayer-pathfinder');
const config = require('./settings.json');

const express = require('express');
const app = express();

// ================== GLOBAL UTILS / CONFIG ==================
const utils = config.utils || {};
const cronMonitor = utils['cron-monitor'] || {};

// ============= CRON PING MONITOR =============
let lastPingTime = Date.now();      // kapan terakhir ada request ke HTTP server
let lastCronAlertTime = 0;          // kapan terakhir ngirim warning soal cron

// Endpoint simple untuk Render / cron-job.org
app.get('/', (req, res) => {
  lastPingTime = Date.now(); // tiap kali ada ping, update waktu
  res.set('Content-Type', 'text/plain');
  res.send('OK');
});

// PENTING: pakai PORT dari environment Render
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`HTTP server listening on port ${PORT}`);
  sendDiscord('✅ HTTP server started on Render.');
});

// Kalau cron-monitor diaktifkan di settings.json, cek berkala
if (cronMonitor.enabled) {
  const checkEveryMs = (cronMonitor.checkEveryMinutes || 5) * 60 * 1000;   // default cek tiap 5 menit
  const maxGapMs = (cronMonitor.maxGapMinutes || 15) * 60 * 1000;          // default kalau >15 menit tanpa ping = warning

  setInterval(() => {
    const now = Date.now();
    const gap = now - lastPingTime;

    if (gap > maxGapMs && now - lastCronAlertTime > maxGapMs) {
      const gapMinutes = Math.round(gap / 60000);
      console.log(`[CronMonitor] No HTTP ping for ~${gapMinutes} minutes. Possible cron stop.`);
      sendDiscord(`⚠️ Cron ping warning: tidak ada HTTP ping ke Render selama ~${gapMinutes} menit. Cek cron-job.org ya.`);
      lastCronAlertTime = now;
    }
  }, checkEveryMs);
}

function createBot() {
  let leftBecausePlayers = false; // flag: bot keluar karena ada player lain

  const bot = mineflayer.createBot({
    host: config.server.ip,
    port: config.server.port,
    username: config['bot-account'].username,
    password: config['bot-account'].password || undefined,
    auth: config['bot-account'].type === 'mojang' ? 'mojang' : 'microsoft',
    version: config.server.version
  });

  bot.loadPlugin(pathfinder);

  const mcData = require('minecraft-data')(bot.version);
  const defaultMovements = new Movements(bot, mcData);
  bot.pathfinder.setMovements(defaultMovements);

  const position = config.position || {};

  function leaveForPlayers(reason) {
    if (leftBecausePlayers) return; // biar gak dipanggil berulang
    leftBecausePlayers = true;
    const msg = `[Auto-Leave] ${reason} Leaving server and will try again later...`;
    console.log(msg);
    sendDiscord(`👋 Bot leave: ${reason}`);
    bot.quit('Player joined');
  }

  bot.once('spawn', () => {
    const msg = `[AfkBot] Bot successfully connected to ${config.server.ip}:${config.server.port}`;
    console.log(msg);
    sendDiscord(`✅ Bot connected to ${config.server.ip}:${config.server.port}`);

    // ❗ Cek kondisi awal: kalau pas bot connect sudah ada player lain → langsung keluar
    const others = Object.values(bot.players).filter(p => p.username !== bot.username);
    if (others.length > 0) {
      leaveForPlayers(`Detected ${others.length} other player(s) already online.`);
      return;
    }

    // Gerak ke koordinat AFK (kalau di-enable)
    if (position.enabled) {
      const goal = new GoalBlock(position.x, position.y, position.z);
      bot.pathfinder.setGoal(goal);
      console.log(`[Movements] Moving to position (${position.x}, ${position.y}, ${position.z})`);
    }

    // Log chat ke console
    if (utils['chat-log']) {
      bot.on('chat', (username, message) => {
        console.log(`[ChatLog] <${username}> ${message}`);
      });
    }

    // Auto-auth sederhana (/register + /login)
    if (utils['auto-auth'] && utils['auto-auth'].enabled) {
      const password = utils['auto-auth'].password;
      if (password && password.length > 0) {
        tryAutoAuth(bot, password);
      }
    }

    // Pesan chat otomatis
    if (utils['chat-messages'] && utils['chat-messages'].enabled) {
      const chatConfig = utils['chat-messages'];
      const messages = chatConfig.messages || [];

      if (messages.length > 0) {
        if (chatConfig.repeat) {
          const delayMs = (chatConfig['repeat-delay'] || 60) * 1000;
          let i = 0;
          setInterval(() => {
            bot.chat(messages[i]);
            i = (i + 1) % messages.length;
          }, delayMs);
        } else {
          messages.forEach((msg, idx) => {
            setTimeout(() => bot.chat(msg), 1000 * (idx + 1));
          });
        }
      }
    }

    // Anti-AFK Mode 4: gerak + lompat kecil berkala
    if (utils['anti-afk'] && utils['anti-afk'].enabled) {
      startMoveAndJump(bot, utils['anti-afk']);
      console.log('[Anti-AFK] Move+Jump anti-AFK enabled.');
    }
  });

  // ❗ Auto-leave saat ada player lain join
  bot.on('playerJoined', (player) => {
    if (!player || !player.username) return;
    if (player.username === bot.username) return; // jangan trigger kalau itu bot sendiri

    // Di sini artinya ada "pemain asli" / player lain masuk
    leaveForPlayers(`Player ${player.username} joined.`);
  });

  bot.on('goal_reached', () => {
    console.log(`[AfkBot] Bot arrived at the target location. ${bot.entity.position}`);
  });

  bot.on('death', () => {
    console.log(`[AfkBot] Bot has died and was respawned at ${bot.entity.position}`);
  });

  bot.on('end', () => {
    console.log('[AfkBot] Bot disconnected from server.');

    if (utils['auto-reconnect']) {
      // baseDelay: 30 detik (30000 ms) kalau config kosong, atau pakai yang di settings.json kalau ada
      const baseDelay = utils['auto-recconect-delay'] || 30000;

      // Kalau keluar karena ada player lain → tambah 90 detik (90000 ms)
      // Total: 30000 + 90000 = 120000 ms (2 menit)
      const extraDelay = leftBecausePlayers ? 90000 : 0; // 1.5 menit
      const delay = baseDelay + extraDelay;

      console.log(`[AfkBot] Reconnecting in ${delay} ms...`);
      sendDiscord(`🔁 Bot disconnected, will reconnect in ${Math.round(delay / 1000)} seconds.`);
      setTimeout(createBot, delay);
    } else {
      sendDiscord('⛔ Bot disconnected and auto-reconnect is disabled.');
    }
  });

  bot.on('kicked', (reason) => {
    console.log(`[AfkBot] Bot was kicked from the server. Reason:\n${reason}`);
    sendDiscord(`⚠️ Bot was kicked from server. Reason:\n\`\`\`\n${reason}\n\`\`\``);
  });

  bot.on('error', (err) => {
    console.log(`[ERROR] ${err.message}`);
    sendDiscord(`❌ Bot error: \`${err.message}\``);
  });
}

// Anti-AFK Mode 4: lompat + gerak kecil berkala + LOG tiap ~30 detik
function startMoveAndJump(bot, afkConfig) {
  // Gerak tiap 3 detik (bisa diatur via settings.json -> utils.anti-afk.intervalMs)
  const moveInterval = afkConfig.intervalMs || 3000;
  // Log tiap 30 detik (bisa diatur via settings.json -> utils.anti-afk.logIntervalMs)
  const logInterval = afkConfig.logIntervalMs || 30000;

  let lastLog = Date.now();

  setInterval(() => {
    const now = Date.now();
    const shouldLog = now - lastLog >= logInterval;

    const pos = bot.entity.position;

    if (shouldLog) {
      console.log(
        `[Anti-AFK] (30s) Tick: x=${pos.x.toFixed(1)}, y=${pos.y.toFixed(1)}, z=${pos.z.toFixed(1)}`
      );
      lastLog = now;
    }

    // Lompat sebentar
    if (shouldLog) console.log('[Anti-AFK] (30s) Jump');
    bot.setControlState('jump', true);
    setTimeout(() => bot.setControlState('jump', false), 400);

    // Pilih arah random: kiri/kanan/maju/mundur
    const dirs = ['left', 'right', 'forward', 'back'];
    const dir = dirs[Math.floor(Math.random() * dirs.length)];

    if (shouldLog) console.log(`[Anti-AFK] (30s) Move: ${dir}`);
    bot.setControlState(dir, true);
    setTimeout(() => bot.setControlState(dir, false), 600);
  }, moveInterval);
}

// Auto-auth sederhana: kirim /register lalu /login
function tryAutoAuth(bot, password) {
  bot.chat(`/register ${password} ${password}`);
  console.log('[Auth] Sent /register command.');
  setTimeout(() => {
    bot.chat(`/login ${password}`);
    console.log('[Auth] Sent /login command.');
  }, 3000);
}

// ============= DISCORD WEBHOOK HELPER =============
async function sendDiscord(message) {
  const discordCfg = utils['discord-webhook'] || {};
  if (!discordCfg.enabled || !discordCfg.url) return;

  try {
    await fetch(discordCfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message })
    });
  } catch (err) {
    console.log(`[Discord] Failed to send webhook: ${err.message}`);
  }
}

createBot();
