const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals: { GoalBlock } } = require('mineflayer-pathfinder');

const config = require('./settings.json');

const express = require('express');
const app = express();

// Endpoint simple buat dicek Render / cron-job.org
app.get('/', (req, res) => {
  res.send('Bot is running');
});

// PENTING: pakai PORT dari environment Render
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`HTTP server listening on port ${PORT}`);
});

function createBot() {
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

  const utils = config.utils || {};
  const position = config.position || {};

  bot.once('spawn', () => {
    console.log(`[AfkBot] Bot successfully connected to ${config.server.ip}:${config.server.port}`);

    // Gerak ke koordinat AFK kalau di-enable
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

    // Auto /register + /login (kalau server pakai AuthMe dsb)
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

    // Anti-AFK simple: lompat + sneak terus
    if (utils['anti-afk'] && utils['anti-afk'].enabled) {
      bot.setControlState('jump', true);
      if (utils['anti-afk'].sneak) {
        bot.setControlState('sneak', true);
      }
      console.log('[Anti-AFK] Enabled jump/sneak anti-AFK.');
    }
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
      const delay = utils['auto-recconect-delay'] || 5000;
      console.log(`[AfkBot] Reconnecting in ${delay} ms...`);
      setTimeout(createBot, delay);
    }
  });

  bot.on('kicked', (reason) => {
    console.log(`[AfkBot] Bot was kicked from the server. Reason:\n${reason}`);
  });

  bot.on('error', (err) => {
    console.log(`[ERROR] ${err.message}`);
  });
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

createBot();
