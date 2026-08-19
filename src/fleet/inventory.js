import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

class InventoryManager {
  constructor() {
    this.filePath = path.join(config.dataDir, 'nodes.json');
    this.nodes = new Map();
    this.ensureDataDir();
    this.load();
  }

  ensureDataDir() {
    if (!fs.existsSync(config.dataDir)) {
      fs.mkdirSync(config.dataDir, { recursive: true });
    }
  }

  load() {
    if (!fs.existsSync(this.filePath)) {
      // Seed default machines if none exist
      const defaultMachines = [
        {
          id: 'prd-edge-us-01',
          hostname: 'prd-edge-us-01',
          ip: '100.64.0.14',
          port: 22,
          username: 'root',
          privateKeyPath: '~/.ssh/id_ed25519',
          tags: ['edge', 'prod', 'ingress'],
          status: 'ONLINE',
          metrics: { cpu: 4.2, ramUsed: 1.8, ramTotal: 8.0, uptime: '48d 12h', latencyMs: 38 },
          lastChecked: Date.now()
        },
        {
          id: 'prd-db-primary-01',
          hostname: 'prd-db-primary-01',
          ip: '100.64.0.22',
          port: 22,
          username: 'ubuntu',
          privateKeyPath: '~/.ssh/id_ed25519',
          tags: ['database', 'prod', 'primary'],
          status: 'HIGH_LOAD',
          metrics: { cpu: 89.4, ramUsed: 28.5, ramTotal: 32.0, uptime: '124d 4h', latencyMs: 42 },
          lastChecked: Date.now()
        },
        {
          id: 'prd-app-eu-01',
          hostname: 'prd-app-eu-01',
          ip: '100.64.1.5',
          port: 22,
          username: 'deploy',
          privateKeyPath: '~/.ssh/id_ed25519',
          tags: ['app', 'prod'],
          status: 'ONLINE',
          metrics: { cpu: 12.1, ramUsed: 4.2, ramTotal: 16.0, uptime: '19d 8h', latencyMs: 94 },
          lastChecked: Date.now()
        },
        {
          id: 'stg-worker-ap-01',
          hostname: 'stg-worker-ap-01',
          ip: '100.64.2.88',
          port: 22,
          username: 'deploy',
          privateKeyPath: '~/.ssh/id_ed25519',
          tags: ['worker', 'staging'],
          status: 'OFFLINE',
          metrics: { cpu: 0, ramUsed: 0, ramTotal: 8.0, uptime: '0', latencyMs: 0 },
          lastChecked: Date.now()
        }
      ];
      this.save(defaultMachines);
    }

    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      this.nodes.clear();
      for (const node of data) {
        // Clean out region field if present
        delete node.region;
        this.nodes.set(node.id, node);
      }
    } catch (err) {
      console.error('[INVENTORY] Failed to read nodes.json:', err.message);
    }
  }

  save(nodesArray = null) {
    try {
      const data = nodesArray || Array.from(this.nodes.values());
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
      if (nodesArray) {
        this.nodes.clear();
        for (const node of nodesArray) {
          delete node.region;
          this.nodes.set(node.id, node);
        }
      }
    } catch (err) {
      console.error('[INVENTORY] Failed to persist nodes.json:', err.message);
    }
  }

  getAll() {
    return Array.from(this.nodes.values());
  }

  getById(id) {
    return this.nodes.get(id);
  }

  getByTag(tag) {
    return this.getAll().filter(n => n.tags && n.tags.includes(tag));
  }

  upsertNode(node) {
    if (!node.id) {
      node.id = node.hostname.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
    }
    delete node.region;
    const existing = this.nodes.get(node.id) || {};
    const merged = {
      ...existing,
      ...node,
      lastChecked: Date.now()
    };
    this.nodes.set(node.id, merged);
    this.save();
    return merged;
  }

  updateMetrics(id, metrics, status = 'ONLINE') {
    const node = this.nodes.get(id);
    if (!node) return null;
    node.metrics = { ...node.metrics, ...metrics };
    node.status = status;
    delete node.lastError;
    node.lastChecked = Date.now();
    this.save();
    return node;
  }

  setOffline(id, error = null) {
    const node = this.nodes.get(id);
    if (!node) return;
    node.status = 'OFFLINE';
    if (error) node.lastError = error;
    if (node.metrics) node.metrics.latencyMs = 0;
    node.lastChecked = Date.now();
    this.save();
  }

  deleteNode(id) {
    const deleted = this.nodes.delete(id);
    if (deleted) this.save();
    return deleted;
  }

  getStatsSummary() {
    const all = this.getAll();
    const online = all.filter(n => n.status === 'ONLINE' || n.status === 'HIGH_LOAD').length;
    const offline = all.filter(n => n.status === 'OFFLINE').length;
    const highLoad = all.filter(n => n.status === 'HIGH_LOAD').length;
    return {
      total: all.length,
      online,
      offline,
      highLoad
    };
  }
}

export const inventory = new InventoryManager();
