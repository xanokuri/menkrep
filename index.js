const mineflayer = require('mineflayer');
const Movements = require('mineflayer-pathfinder').Movements;
const pathfinder = require('mineflayer-pathfinder').pathfinder;
const { GoalBlock } = require('mineflayer-pathfinder').goals;

const config = require('./settings.json');
const express = require('express');

const app = express();

app.get('/', (req, res) => {
  res.send('Bot has arrived');
});

// PENTING UNTUK RENDER: pakai PORT dari environment
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});

function createBot() {
   const bot = mineflayer.createBot({
      username: config['bot-account']['username'],
      password: config['bot-account']['password'],
      version: config.server.version,
      host: config.server.ip,
      port: config.server.port,
      auth: config['bot-account']['type'] == 'mojang' ? 'mojang' : 'microsoft',
   });

   bot.loadPlugin(pathfinder);

   const mcData = require('minecraft-data')(bot.version);
   const defaultMovements = new Movements(bot, mcData);
   bot.pathfinder.setMovements(defaultMovements);

   bot.once('spawn', () => {
      console.log('\x1b[32m', `[AfkBot] Bot successfully connected to ${config.server.ip}:${config.server.port}`, '\x1b[0m');

      if (config.position.enabled) {
         const pos = config.position;
         const goal = new GoalBlock(pos.x, pos.y, pos.z);
         bot.pathfinder.setGoal(goal);

         console.log(`\x1b[34m[Movements] Moving to position (${pos.x}, ${pos.y}, ${pos.z})\x1b[0m`);
      }

      if (config.utils['chat-log']) {
         bot.on('chat', (username, message) => {
            console.log(`[ChatLog] <${username}> ${message}`);
         });
      }

      if (config['anti-afk'].enabled) {
         startAntiAfk(bot, config['anti-afk']);
      }

      if (config.auth && config.auth.enabled) {
         handleAuth(bot, config.auth);
      }
   });

   bot.on('end', () => {
      console.log('\x1b[33m', '[AfkBot] Bot disconnected from server.', '\x1b[0m');

      if (config.utils['auto-reconnect']) {
         console.log('\x1b[33m', `[AfkBot] Attempting to reconnect in ${config.utils['auto-recconect-delay']} ms...`, '\x1b[0m');
         setTimeout(() => {
            createBot();
         }, config.utils['auto-recconect-delay']);
      }
   });

   bot.on('kicked', (reason) =>
      console.log(
         '\x1b[33m',
         `[AfkBot] Bot was kicked from the server. Reason: \n${reason}`,
         '\x1b[0m'
      )
   );

   bot.on('error', (err) =>
      console.log(`\x1b[31m[ERROR] ${err.message}`, '\x1b[0m')
   );
}

function startAntiAfk(bot, afkConfig) {
   console.log('\x1b[32m', '[Anti-AFK] Anti-AFK enabled.', '\x1b[0m');

   const actions = [];

   if (afkConfig['chat-messages'].enabled) {
      actions.push(() => sendRandomChatMessage(bot, afkConfig['chat-messages']));
   }

   if (afkConfig['jump'].enabled) {
      actions.push(() => bot.setControlState('jump', true));
      actions.push(() => bot.setControlState('jump', false));
   }

   if (afkConfig['rotate'].enabled) {
      actions.push(() => {
         const yaw = Math.random() * Math.PI * 2;
         const pitch = (Math.random() - 0.5) * Math.PI;
         bot.look(yaw, pitch, true);
      });
   }

   if (afkConfig['move'].enabled) {
      actions.push(() => {
         const directions = ['forward', 'back', 'left', 'right'];
         const direction = directions[Math.floor(Math.random() * directions.length)];
         bot.setControlState(direction, true);

         setTimeout(() => {
            bot.setControlState(direction, false);
         }, afkConfig['move']['move-duration'] || 1000);
      });
   }

   setInterval(() => {
      const action = actions[Math.floor(Math.random() * actions.length)];
      if (action) action();
   }, afkConfig['interval'] || 30000);
}

function sendRandomChatMessage(bot, chatConfig) {
   const messages = chatConfig.messages;
   const message =
      messages[Math.floor(Math.random() * messages.length)];
   bot.chat(message);
   console.log(`[Anti-AFK] Sent chat message: ${message}`);
}

function handleAuth(bot, authConfig) {
   let pendingPromise = Promise.resolve();

   function sendRegister(password) {
      return new Promise((resolve, reject) => {
         bot.chat(`/register ${password} ${password}`);
         console.log(`[Auth] Sent /register command.`);

         bot.once('chat', (username, message) => {
            console.log(`[ChatLog] <${username}> ${message}`);

            if (message.includes('successfully registered')) {
               console.log('[INFO] Registration successful! Joining the game...');
               resolve();
            } else if (message.includes('You are already registered')) {
               console.log('[INFO] Already registered. Try logging in...');
               resolve();
            } else {
               console.log('[WARN] Unexpected message after /register:', message);
               reject(new Error('Unexpected register response'));
            }
         });
      });
   }

   function sendLogin(password) {
      return new Promise((resolve, reject) => {
         bot.chat(`/login ${password}`);
         console.log(`[Auth] Sent /login command.`);

         bot.once('chat', (username, message) => {
            console.log(`[ChatLog] <${username}> ${message}`);

            if (message.includes('successfully logged in')) {
               console.log('[INFO] Login successful! Joining the game...');
               resolve();
            } else if (message.includes('Incorrect password')) {
               console.log('[WARN] Incorrect password.');
               reject(new Error('Incorrect password'));
            } else {
               console.log('[WARN] Unexpected message after /login:', message);
               reject(new Error('Unexpected login response'));
            }
         });
      });
   }

   if (authConfig.enabled) {
      const password = authConfig.password;

      if (!password) {
         console.error('[ERROR] No password configured for auth.');
         return;
      }

      pendingPromise = pendingPromise
         .then(() => sendRegister(password))
         .catch((err) => {
            console.error('[ERROR] Error during registration:', err.message);
         })
         .then(() => sendLogin(password))
         .catch((err) => {
            console.error('[ERROR] Error during login:', err.message);
         });
   }

   bot.settings.colorsEnabled = false;
}

createBot();
