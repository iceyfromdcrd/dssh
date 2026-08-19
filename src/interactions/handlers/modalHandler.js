import { inventory } from '../../fleet/inventory.js';
import { SSHExecutor } from '../../ssh/executor.js';
import { ComponentsV2Builder, ComponentType, IS_COMPONENTS_V2 } from '../../ui/componentsV2.js';
import { BulkHandler } from './bulkHandler.js';
import { DashHandler } from './dashHandler.js';
import { config } from '../../config.js';

export class ModalHandler {
  static async handleModalSubmit(interaction, fleetMonitor = null) {
    const customId = interaction.customId;

    // Search / Filter Modal
    if (customId === 'modal_search_filter') {
      const query = (interaction.fields.getTextInputValue('search_query_input') || '').trim();
      DashHandler.activeFilters.set(interaction.user.id, query);
      return DashHandler.render(interaction, 1, false);
    }

    // Set Polling Interval Modal
    if (customId === 'modal_set_interval') {
      const val = parseInt(interaction.fields.getTextInputValue('interval_input'), 10);
      if (!isNaN(val) && val >= 5 && val <= 3600) {
        config.settings.pollIntervalSec = val;
        if (fleetMonitor) fleetMonitor.restart();
      }
      const payload = ComponentsV2Builder.buildSettingsView();
      return interaction.update(payload);
    }

    // Single Machine Execution Modal
    if (customId.startsWith('modal_exec:')) {
      const machineId = customId.split(':')[1];
      const machine = inventory.getById(machineId);

      if (!machine) {
        return interaction.reply({
          content: `\`[ERR]: Machine ${machineId} not found in inventory.\``,
          ephemeral: true
        });
      }

      const command = interaction.fields.getTextInputValue('command_input');
      const timeoutSec = parseInt(interaction.fields.getTextInputValue('timeout_input') || '30', 10);

      // Edit message in-place
      await interaction.deferUpdate();

      // Show immediate pending feedback
      const pendingPayload = {
        flags: IS_COMPONENTS_V2,
        components: [
          {
            type: ComponentType.Container,
            accent_color: 0x5865F2,
            components: [
              {
                type: ComponentType.TextDisplay,
                content: `## ${machine.hostname}\nExecuting: \`$ ${command.slice(0, 60)}${command.length > 60 ? '...' : ''}\`\n*Streaming SSH output. Please wait...*`
              }
            ]
          }
        ]
      };
      await interaction.editReply(pendingPayload);

      try {
        const result = await SSHExecutor.exec(machine, command, { timeoutMs: timeoutSec * 1000 });
        const payload = ComponentsV2Builder.buildExecutionResultView({
          machine,
          command,
          stdout: result.stdout,
          stderr: result.stderr,
          code: result.code,
          durationMs: result.durationMs
        });
        return interaction.editReply(payload);
      } catch (err) {
        const payload = ComponentsV2Builder.buildExecutionResultView({
          machine,
          command,
          stdout: '',
          stderr: err.message,
          code: 1,
          durationMs: 0
        });
        return interaction.editReply(payload);
      }
    }

    // Add Machine Modal
    if (customId === 'modal_add_node') {
      const hostname = interaction.fields.getTextInputValue('hostname_input').trim();
      const ipRaw = interaction.fields.getTextInputValue('ip_input').trim();
      const username = interaction.fields.getTextInputValue('user_input').trim();
      const tags = (interaction.fields.getTextInputValue('tags_input') || '').split(',').map(s => s.trim()).filter(Boolean);
      const keyInput = (interaction.fields.getTextInputValue('key_path_input') || '').trim();

      let [ip, portStr] = ipRaw.split(':');
      const port = parseInt(portStr || '22', 10);

      const newMachine = {
        hostname,
        ip,
        port,
        username,
        tags,
        status: 'ONLINE',
        metrics: { cpu: 0, ramUsed: 0, ramTotal: 0, uptime: '0', latencyMs: 0 }
      };

      if (keyInput.includes('-----BEGIN')) {
        newMachine.privateKeyContent = keyInput;
      } else if (keyInput) {
        newMachine.privateKeyPath = keyInput;
      }

      const saved = inventory.upsertNode(newMachine);

      // Edit dashboard message in-place
      await interaction.deferUpdate();

      // Test connection immediately
      const testRes = await SSHExecutor.fetchTelemetry(saved);
      if (testRes.success) {
        inventory.updateMetrics(saved.id, testRes.metrics, 'ONLINE');
      } else {
        inventory.setOffline(saved.id);
      }

      return DashHandler.render(interaction, 1, false);
    }

    // Bulk Cluster Exec Modal
    if (customId === 'modal_bulk_exec') {
      const targetFilter = interaction.fields.getTextInputValue('target_filter');
      const command = interaction.fields.getTextInputValue('command_input');

      // Edit in-place
      await interaction.deferUpdate();

      return BulkHandler.executeCluster(interaction, targetFilter, command, 45);
    }
  }
}
