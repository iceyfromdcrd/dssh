import { Client } from 'ssh2';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KeyManager } from '../fleet/keymanager.js';

class SSHPoolManager {
  constructor() {
    /** @type {Map<string, { client: Client, connected: boolean, lastUsed: number }>} */
    this.pool = new Map();
    this.idleTimeoutMs = 5 * 60 * 1000; // 5 min idle reaper
    this.startReaper();
  }

  resolveKeyPath(keyPath) {
    if (!keyPath) return null;
    if (keyPath.startsWith('~')) {
      return path.join(os.homedir(), keyPath.slice(1));
    }
    return path.resolve(keyPath);
  }

  getPrivateKey(node) {
    if (node.privateKeyContent) {
      return Buffer.from(node.privateKeyContent);
    }
    if (node.privateKeyPath) {
      const resolved = this.resolveKeyPath(node.privateKeyPath);
      if (fs.existsSync(resolved)) {
        return fs.readFileSync(resolved);
      }
    }

    // Check cluster master key in data/keys/
    try {
      const masterKey = KeyManager.getPrivateKey();
      if (masterKey) return masterKey;
    } catch (_) {}

    // Default fallback to ~/.ssh/id_ed25519 or id_rsa
    const defaultEd25519 = path.join(os.homedir(), '.ssh', 'id_ed25519');
    if (fs.existsSync(defaultEd25519)) return fs.readFileSync(defaultEd25519);
    const defaultRsa = path.join(os.homedir(), '.ssh', 'id_rsa');
    if (fs.existsSync(defaultRsa)) return fs.readFileSync(defaultRsa);

    return null;
  }

  async acquire(node) {
    const key = node.id;
    const existing = this.pool.get(key);

    if (existing && existing.connected) {
      existing.lastUsed = Date.now();
      return existing.client;
    }

    if (existing) {
      try { existing.client.end(); } catch (_) {}
      this.pool.delete(key);
    }

    return new Promise((resolve, reject) => {
      const client = new Client();
      let connected = false;

      // 4-second aggressive handshake timeout for fast failure feedback
      const timer = setTimeout(() => {
        if (!connected) {
          try { client.end(); } catch (_) {}
          this.pool.delete(key);
          reject(new Error(`SSH connection timeout to ${node.hostname} (${node.ip}:22)`));
        }
      }, 4000);

      client
        .on('ready', () => {
          connected = true;
          clearTimeout(timer);
          this.pool.set(key, { client, connected: true, lastUsed: Date.now() });
          resolve(client);
        })
        .on('error', (err) => {
          clearTimeout(timer);
          this.pool.delete(key);
          if (!connected) reject(err);
        })
        .on('end', () => {
          this.pool.delete(key);
        })
        .on('close', () => {
          this.pool.delete(key);
        });

      const privateKey = this.getPrivateKey(node);

      /** @type {import('ssh2').ConnectConfig} */
      const connectConfig = {
        host: node.ip,
        port: node.port || 22,
        username: node.username || 'dssh',
        readyTimeout: 4000,
        keepaliveInterval: 10000,
        keepaliveCountMax: 3
      };

      if (privateKey) {
        connectConfig.privateKey = privateKey;
        if (node.passphrase) connectConfig.passphrase = node.passphrase;
      } else if (node.password) {
        connectConfig.password = node.password;
      }

      try {
        client.connect(connectConfig);
      } catch (err) {
        clearTimeout(timer);
        this.pool.delete(key);
        reject(err);
      }
    });
  }

  release(nodeId) {
    const entry = this.pool.get(nodeId);
    if (entry) {
      entry.lastUsed = Date.now();
    }
  }

  disconnect(nodeId) {
    const entry = this.pool.get(nodeId);
    if (entry) {
      try { entry.client.end(); } catch (_) {}
      this.pool.delete(nodeId);
    }
  }

  startReaper() {
    setInterval(() => {
      const now = Date.now();
      for (const [id, entry] of this.pool.entries()) {
        if (now - entry.lastUsed > this.idleTimeoutMs) {
          try { entry.client.end(); } catch (_) {}
          this.pool.delete(id);
        }
      }
    }, 60000).unref();
  }

  destroyAll() {
    for (const [id, entry] of this.pool.entries()) {
      try { entry.client.end(); } catch (_) {}
    }
    this.pool.clear();
  }
}

export const sshPool = new SSHPoolManager();
