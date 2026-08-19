import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Client, GatewayIntentBits, Events, REST, Routes, SlashCommandBuilder } from 'discord.js';
import { config, isAuthorized } from './config.js';
import { InteractionRouter } from './interactions/router.js';
import { DashHandler } from './interactions/handlers/dashHandler.js';
import { SettingsHandler } from './interactions/handlers/settingsHandler.js';
import { FleetMonitor } from './fleet/monitor.js';
import { sshPool } from './ssh/pool.js';
import { KeyManager } from './fleet/keymanager.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

let fleetMonitor = null;

// Slash Command Definitions
const commands = [
  new SlashCommandBuilder()
    .setName('dash')
    .setDescription('Open the interactive Linux fleet cluster dashboard'),

  new SlashCommandBuilder()
    .setName('settings')
    .setDescription('Manage cluster polling, auto-sync, and alerting settings'),

  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Get automated Linux machine setup script & one-liner'),

  new SlashCommandBuilder()
    .setName('node')
    .setDescription('Inspect and manage a specific cluster machine')
    .addStringOption(option =>
      option.setName('node_id')
        .setDescription('The ID or hostname of the machine')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('exec')
    .setDescription('Execute a bash command on a specific cluster machine')
    .addStringOption(option =>
      option.setName('node_id')
        .setDescription('Target machine ID')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('command')
        .setDescription('Bash command to execute')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('fleet')
    .setDescription('Broadcast a command across machines in the fleet cluster')
    .addStringOption(option =>
      option.setName('command')
        .setDescription('Bash command to execute across machines')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('target')
        .setDescription('Filter by tag, hostname, or "all"')
        .setRequired(false)
    )
].map(cmd => cmd.toJSON());

async function registerSlashCommands() {
  if (!config.token || !config.clientId) {
    console.warn('[INIT] DISCORD_TOKEN or CLIENT_ID not provided. Skipping slash command registration.');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(config.token);

  let registeredGuild = false;
  if (config.guildId) {
    try {
      console.log(`[INIT] Attempting guild command registration for Guild ID: ${config.guildId}...`);
      await rest.put(
        Routes.applicationGuildCommands(config.clientId, config.guildId),
        { body: commands }
      );
      console.log(`[INIT] Successfully registered commands to guild: ${config.guildId}`);
      registeredGuild = true;
    } catch (error) {
      console.warn(`[INIT WARNING] Could not register guild commands (${error.message}). Falling back to global commands...`);
      if (config.guildId === config.alertChannelId) {
        console.warn(`[NOTE] GUILD_ID in .env matches ALERT_CHANNEL_ID (${config.guildId}). Make sure GUILD_ID is your Discord Server ID, not a text channel ID.`);
      }
    }
  }

  if (!registeredGuild) {
    try {
      console.log('[INIT] Registering global slash commands...');
      await rest.put(
        Routes.applicationCommands(config.clientId),
        { body: commands }
      );
      console.log('[INIT] Successfully registered global commands.');
    } catch (globalErr) {
      console.error('[INIT ERROR] Failed to register global slash commands:', globalErr.message);
    }
  }
}

// 1. Lightweight HTTP Server for Webhooks, Health Checks (Render / Uptime monitors), and Script Serving
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // Dynamic /setup endpoint: serves setup-node.sh with pre-injected cluster master public key
  if (url.pathname === '/setup' || url.pathname === '/setup-node.sh') {
    const scriptPath = path.join(config.scriptsDir, 'setup-node.sh');
    if (fs.existsSync(scriptPath)) {
      let scriptContent = fs.readFileSync(scriptPath, 'utf-8');
      const masterPubKey = KeyManager.getPublicKey();
      scriptContent = scriptContent.replace('PUBLIC_KEY=""', `PUBLIC_KEY="${masterPubKey}"`);

      res.writeHead(200, {
        'Content-Type': 'text/x-shellscript; charset=utf-8',
        'Content-Disposition': 'inline; filename="setup-node.sh"'
      });
      return res.end(scriptContent);
    }
  }

  // Health check endpoint for Render / Uptime monitors
  if (url.pathname === '/health' || url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      status: 'healthy',
      bot: client.user?.tag || 'connecting',
      uptime: Math.floor(process.uptime()),
      timestamp: Date.now()
    }));
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('404 Not Found');
});

server.listen(config.port, '0.0.0.0', () => {
  console.log(`[HTTP] Web & Health server listening on 0.0.0.0:${config.port}`);
});

// 2. Discord Bot Lifecycle
client.once(Events.ClientReady, async () => {
  console.log(`\n======================================================`);
  console.log(`[DSSH ORCHESTRATOR] Logged in as ${client.user.tag}`);
  console.log(`[SECURITY] Authorized User Whitelist: ${config.authorizedUserIds.join(', ') || 'NONE'}`);
  
  // Ensure cluster master keypair exists
  KeyManager.ensureMasterKeys();
  console.log(`[SSH KEY] Cluster Master Public Key: ${KeyManager.getPublicKey()}`);
  console.log(`======================================================\n`);

  await registerSlashCommands();

  // Initialize Fleet Health Poller
  fleetMonitor = new FleetMonitor(client);
  fleetMonitor.start();
});

// Component & Slash Command Interactions
client.on(Events.InteractionCreate, async (interaction) => {
  await InteractionRouter.handle(interaction, fleetMonitor);
});

// Support for text prefixes (.dash, .settings)
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  const content = message.content.trim().toLowerCase();
  if (content === '.dash' || content === '!dash') {
    if (!isAuthorized(message.author.id)) {
      return message.reply(`\`⛔ [ACCESS DENIED]: User ID ${message.author.id} is not authorized.\``);
    }
    return DashHandler.render(message, 1, false);
  }

  if (content === '.settings' || content === '!settings') {
    if (!isAuthorized(message.author.id)) {
      return message.reply(`\`⛔ [ACCESS DENIED]: User ID ${message.author.id} is not authorized.\``);
    }
    return SettingsHandler.render(message);
  }
});

// Graceful Cleanup
const shutdown = () => {
  console.log('\n[SHUTDOWN] Terminating server, SSH connections, and bot...');
  server.close();
  if (fleetMonitor) fleetMonitor.stop();
  sshPool.destroyAll();
  client.destroy();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start bot if token present
if (config.token) {
  client.login(config.token).catch((err) => {
    console.error('[AUTH ERROR] Discord login failed:', err.message);
  });
} else {
  console.log('[INFO] Ready. Set DISCORD_TOKEN in .env or Render environment variables.');
}
