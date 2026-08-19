import { inventory } from './inventory.js';
import { SSHExecutor } from '../ssh/executor.js';
import { ComponentsV2Builder } from '../ui/componentsV2.js';
import { config } from '../config.js';

export class FleetMonitor {
  /**
   * @param {import('discord.js').Client} client
   */
  constructor(client) {
    this.client = client;
    this.intervalId = null;
    this.previousStates = new Map();
  }

  start() {
    console.log(`[MONITOR] Starting background fleet health poller (${config.settings.pollIntervalSec}s interval)...`);
    
    // Seed initial state tracker
    for (const machine of inventory.getAll()) {
      this.previousStates.set(machine.id, { status: machine.status, cpu: machine.metrics?.cpu || 0 });
    }

    this.intervalId = setInterval(() => this.poll(), config.settings.pollIntervalSec * 1000);
    // Initial run after 5s
    setTimeout(() => this.poll(), 5000);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  restart() {
    this.stop();
    if (config.settings.autoSync) {
      this.start();
    } else {
      console.log('[MONITOR] Background auto-sync is currently disabled in settings.');
    }
  }

  async poll() {
    if (!config.settings.autoSync) return;

    const machines = inventory.getAll();
    if (machines.length === 0) return;

    await Promise.allSettled(
      machines.map(async (machine) => {
        const prevState = this.previousStates.get(machine.id) || { status: 'ONLINE', cpu: 0 };
        const res = await SSHExecutor.fetchTelemetry(machine);

        if (!res.success) {
          // Machine failed to respond
          inventory.setOffline(machine.id, res.error);
          if (prevState.status !== 'OFFLINE') {
            this.previousStates.set(machine.id, { status: 'OFFLINE', cpu: 0 });
            await this.dispatchAlert(machine, 'OFFLINE', `SSH handshake failed or host unreachable: ${res.error}`);
          }
          return;
        }

        const metrics = res.metrics;
        const isCpuHigh = config.settings.cpuAlerts && metrics.cpu >= config.settings.cpuThreshold;
        const isRamHigh = config.settings.ramAlerts && (metrics.ramUsed / (metrics.ramTotal || 1)) * 100 >= config.settings.ramThreshold;
        const isHighLoad = isCpuHigh || isRamHigh;

        let currentStatus = 'ONLINE';
        if (isHighLoad) currentStatus = 'HIGH_LOAD';

        // Check for state transitions
        if (prevState.status === 'OFFLINE') {
          // Machine came back online
          await this.dispatchAlert(machine, 'RECOVERED', `Machine is now reachable. Latency: ${metrics.latencyMs}ms.`, metrics);
        } else if (prevState.status === 'ONLINE' && isHighLoad) {
          // Spiked into high load
          const reason = isCpuHigh ? `CPU usage reached ${metrics.cpu}%` : `Memory usage reached ${metrics.ramUsed}GB`;
          await this.dispatchAlert(machine, 'HIGH_LOAD', reason, metrics);
        }

        inventory.updateMetrics(machine.id, metrics, currentStatus);
        this.previousStates.set(machine.id, { status: currentStatus, cpu: metrics.cpu });
      })
    );
  }

  async dispatchAlert(machine, eventType, detail, metrics = null) {
    if (!config.alertChannelId) return;

    try {
      const channel = await this.client.channels.fetch(config.alertChannelId);
      if (channel && channel.isTextBased()) {
        const payload = ComponentsV2Builder.buildAlertView({
          machine,
          eventType,
          detail,
          metrics: metrics || machine.metrics
        });
        await channel.send(payload);
      }
    } catch (err) {
      console.error(`[MONITOR ALERT FAILED] Could not send alert for ${machine.hostname}:`, err.message);
    }
  }
}
