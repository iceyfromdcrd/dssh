import { inventory } from '../../fleet/inventory.js';
import { ComponentsV2Builder, ComponentType, IS_COMPONENTS_V2 } from '../../ui/componentsV2.js';
import { SSHExecutor } from '../../ssh/executor.js';
import { DashHandler } from './dashHandler.js';

export class NodeHandler {
  static async handleButton(interaction) {
    const [action, machineId] = interaction.customId.split(':');
    const machine = inventory.getById(machineId);

    if (!machine && action !== 'dash_page') {
      return interaction.reply({
        content: `\`[ERR]: Machine "${machineId}" not found in inventory.\``,
        ephemeral: true
      });
    }

    if (action === 'node_manage') {
      const payload = ComponentsV2Builder.buildNodeManagementView(machine);
      return interaction.update(payload);
    }

    if (action === 'node_refresh') {
      // 1. Instant loading feedback
      const loadingPayload = {
        flags: IS_COMPONENTS_V2,
        components: [
          {
            type: ComponentType.Container,
            accent_color: 0x5865F2,
            components: [
              {
                type: ComponentType.TextDisplay,
                content: `## ${machine.hostname}\n*Fetching fresh telemetry from \`${machine.ip}\`...*`
              }
            ]
          }
        ]
      };
      await interaction.update(loadingPayload);

      // 2. Fetch telemetry
      const res = await SSHExecutor.fetchTelemetry(machine);
      if (res.success) {
        let status = 'ONLINE';
        if (res.metrics.cpu > 80 || (res.metrics.ramUsed / (res.metrics.ramTotal || 1)) > 0.85) {
          status = 'HIGH_LOAD';
        }
        inventory.updateMetrics(machine.id, res.metrics, status);
      } else {
        inventory.setOffline(machine.id);
      }

      const updated = inventory.getById(machineId);
      const payload = ComponentsV2Builder.buildNodeManagementView(updated);
      return interaction.editReply(payload);
    }

    if (action === 'node_exec_modal') {
      const modalPayload = ComponentsV2Builder.buildExecModal(machine.id);
      return interaction.showModal(modalPayload);
    }

    if (action === 'node_logs') {
      // 1. Instant loading feedback
      const loadingPayload = {
        flags: IS_COMPONENTS_V2,
        components: [
          {
            type: ComponentType.Container,
            accent_color: 0x5865F2,
            components: [
              {
                type: ComponentType.TextDisplay,
                content: `## ${machine.hostname}\n*Streaming journalctl / syslog logs from \`${machine.ip}\`...*`
              }
            ]
          }
        ]
      };
      await interaction.update(loadingPayload);

      // 2. Fetch logs
      try {
        const result = await SSHExecutor.fetchLogs(machine, 30);
        const payload = ComponentsV2Builder.buildExecutionResultView({
          machine,
          command: 'journalctl -n 30 -q / syslog tail',
          stdout: result.stdout,
          stderr: result.stderr,
          code: result.code,
          durationMs: result.durationMs
        });
        return interaction.editReply(payload);
      } catch (err) {
        const payload = ComponentsV2Builder.buildExecutionResultView({
          machine,
          command: 'journalctl -n 30 -q / syslog tail',
          stdout: '',
          stderr: `Log retrieval failed: ${err.message}`,
          code: 1,
          durationMs: 0
        });
        return interaction.editReply(payload);
      }
    }

    if (action === 'node_sessions') {
      // 1. Instant loading feedback
      const loadingPayload = {
        flags: IS_COMPONENTS_V2,
        components: [
          {
            type: ComponentType.Container,
            accent_color: 0x5865F2,
            components: [
              {
                type: ComponentType.TextDisplay,
                content: `## ${machine.hostname}\n*Inspecting tmux, screen, and systemd processes on \`${machine.ip}\`...*`
              }
            ]
          }
        ]
      };
      await interaction.update(loadingPayload);

      // 2. Fetch sessions
      try {
        const result = await SSHExecutor.listBackgroundSessions(machine);
        const payload = ComponentsV2Builder.buildExecutionResultView({
          machine,
          command: 'tmux ls / screen -ls / systemctl services',
          stdout: result.stdout,
          stderr: result.stderr,
          code: result.code,
          durationMs: result.durationMs
        });
        return interaction.editReply(payload);
      } catch (err) {
        const payload = ComponentsV2Builder.buildExecutionResultView({
          machine,
          command: 'tmux ls / screen -ls / systemctl services',
          stdout: '',
          stderr: `Session inspection failed: ${err.message}`,
          code: 1,
          durationMs: 0
        });
        return interaction.editReply(payload);
      }
    }

    if (action === 'node_delete') {
      inventory.deleteNode(machineId);
      return DashHandler.render(interaction, 1, false);
    }
  }
}
