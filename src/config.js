import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  token: process.env.DISCORD_TOKEN || '',
  clientId: process.env.CLIENT_ID || '',
  guildId: process.env.GUILD_ID || '',
<<<<<<< HEAD
  port: parseInt(process.env.PORT || '3000', 10),
  publicUrl: process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '',
=======
>>>>>>> 00855397e4cd6ae26a581a8125dfe37558279e0a
  
  // Whitelist: Array of authorized Discord User IDs
  authorizedUserIds: (process.env.AUTHORIZED_USER_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean),

  alertChannelId: process.env.ALERT_CHANNEL_ID || '',
  
  // Dynamic Runtime Settings with Defaults from .env
  settings: {
    autoSync: process.env.ENABLE_AUTO_SYNC !== 'false',
    pollIntervalSec: parseInt(process.env.POLL_INTERVAL_SEC || '30', 10),
    cpuAlerts: process.env.ENABLE_CPU_ALERTS !== 'false',
    ramAlerts: process.env.ENABLE_RAM_ALERTS !== 'false',
    cpuThreshold: parseFloat(process.env.ALERT_CPU_THRESHOLD || '85'),
    ramThreshold: parseFloat(process.env.ALERT_RAM_THRESHOLD || '90')
  },

<<<<<<< HEAD
  dataDir: path.resolve(__dirname, '../data'),
  scriptsDir: path.resolve(__dirname, '../scripts')
=======
  dataDir: path.resolve(__dirname, '../data')
>>>>>>> 00855397e4cd6ae26a581a8125dfe37558279e0a
};

export function isAuthorized(userId) {
  if (!config.authorizedUserIds.length) {
    console.warn('[SECURITY] No AUTHORIZED_USER_IDS configured in .env. Denying access by default.');
    return false;
  }
  return config.authorizedUserIds.includes(userId);
}
