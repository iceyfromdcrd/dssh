import { isAuthorized } from '../config.js';
import { DashHandler } from './handlers/dashHandler.js';
import { NodeHandler } from './handlers/nodeHandler.js';
import { ModalHandler } from './handlers/modalHandler.js';
import { SettingsHandler } from './handlers/settingsHandler.js';
import { inventory } from '../fleet/inventory.js';
import { SSHExecutor } from '../ssh/executor.js';
import { ComponentsV2Builder, ComponentType, IS_COMPONENTS_V2 } from '../ui/componentsV2.js';
import { BulkHandler } from './handlers/bulkHandler.js';

export class InteractionRouter {
  static async handle(interaction, fleetMonitor = null) {
    // 1. Strict Whitelist Authorization Gate
    if (!isAuthorized(interaction.user.id)) {
      console.warn(`[SECURITY ALERT] Unauthorized access attempt by ${interaction.user.tag} (${interaction.user.id})`);
      const unauthorizedPayload = {
        content: `\`⛔ [ACCESS DENIED]: User ID ${interaction.user.id} is not in the authorized fleet whitelist.\``,
        ephemeral: true
      };

      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        return interaction.reply(unauthorizedPayload);
      }
      return;
    }

    try {
      // 2. Slash Commands
      if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;

        if (commandName === 'dash') {
          return DashHandler.render(interaction, 1, false);
        }

        if (commandName === 'settings') {
          return SettingsHandler.render(interaction);
        }

        if (commandName === 'setup') {
          const payload = ComponentsV2Builder.buildAddMachineView();
          return interaction.reply(payload);
        }

        if (commandName === 'node') {
          const machineId = interaction.options.getString('node_id');
          const machine = inventory.getById(machineId);
          if (!machine) {
            return interaction.reply({ content: `\`Machine ${machineId} not found.\``, ephemeral: true });
          }
          const payload = ComponentsV2Builder.buildNodeManagementView(machine);
          return interaction.reply(payload);
        }

        if (commandName === 'exec') {
          const machineId = interaction.options.getString('node_id');
          const cmd = interaction.options.getString('command');
          const machine = inventory.getById(machineId);
          if (!machine) {
            return interaction.reply({ content: `\`Machine ${machineId} not found.\``, ephemeral: true });
          }

          await interaction.deferReply();
          const pendingPayload = {
            flags: IS_COMPONENTS_V2,
            components: [
              {
                type: ComponentType.Container,
                accent_color: 0x5865F2,
                components: [
                  {
                    type: ComponentType.TextDisplay,
                    content: `## ${machine.hostname}\nExecuting: \`$ ${cmd.slice(0, 60)}${cmd.length > 60 ? '...' : ''}\`\n*Streaming SSH output. Please wait...*`
                  }
                ]
              }
            ]
          };
          await interaction.editReply(pendingPayload);

          try {
            const res = await SSHExecutor.exec(machine, cmd);
            const payload = ComponentsV2Builder.buildExecutionResultView({
              machine,
              command: cmd,
              stdout: res.stdout,
              stderr: res.stderr,
              code: res.code,
              durationMs: res.durationMs
            });
            return interaction.editReply(payload);
          } catch (err) {
            const payload = ComponentsV2Builder.buildExecutionResultView({
              machine,
              command: cmd,
              stdout: '',
              stderr: err.message,
              code: 1,
              durationMs: 0
            });
            return interaction.editReply(payload);
          }
        }

        if (commandName === 'fleet') {
          const filter = interaction.options.getString('target') || 'all';
          const cmd = interaction.options.getString('command');
          await interaction.deferReply();
          return BulkHandler.executeCluster(interaction, filter, cmd);
        }
      }

      // 3. Button Interactions
      if (interaction.isButton()) {
        const id = interaction.customId;
        if (id.startsWith('dash_') || id === 'node_add_modal' || id === 'fleet_bulk_prompt' || id === 'fleet_add_machine_view' || id === 'fleet_search_prompt' || id === 'fleet_settings_view') {
          return DashHandler.handleButton(interaction);
        }
        if (id.startsWith('settings_')) {
          return SettingsHandler.handleButton(interaction, fleetMonitor);
        }
        if (id.startsWith('status_')) {
          return interaction.deferUpdate();
        }
        if (id.startsWith('node_')) {
          return NodeHandler.handleButton(interaction);
        }
      }

      // 4. Modal Submissions
      if (interaction.isModalSubmit()) {
        return ModalHandler.handleModalSubmit(interaction, fleetMonitor);
      }
    } catch (err) {
      console.error('[ROUTER ERROR]:', err);
      const errMsg = `\`[EXCEPTION]: ${err.message}\``;
      if (interaction.deferred) {
        return interaction.editReply({ content: errMsg });
      } else if (interaction.isRepliable() && !interaction.replied) {
        return interaction.reply({ content: errMsg, ephemeral: true });
      }
    }
  }
}
