import { config } from '../../config.js';
import { ComponentsV2Builder } from '../../ui/componentsV2.js';

export class SettingsHandler {
  static render(context) {
    const payload = ComponentsV2Builder.buildSettingsView();
    const isComponent = typeof context.isMessageComponent === 'function' && context.isMessageComponent();

    if (isComponent) {
      return context.update(payload);
    } else if (typeof context.reply === 'function') {
      return context.reply(payload);
    }
  }

  static async handleButton(interaction, fleetMonitor) {
    const [action, settingKey] = interaction.customId.split(':');

    if (action === 'settings_toggle') {
      if (settingKey === 'autoSync') {
        config.settings.autoSync = !config.settings.autoSync;
        if (fleetMonitor) fleetMonitor.restart();
      } else if (settingKey === 'cpuAlerts') {
        config.settings.cpuAlerts = !config.settings.cpuAlerts;
      } else if (settingKey === 'ramAlerts') {
        config.settings.ramAlerts = !config.settings.ramAlerts;
      }

      const payload = ComponentsV2Builder.buildSettingsView();
      return interaction.update(payload);
    }

    if (action === 'settings_modal' && settingKey === 'interval') {
      const modalPayload = ComponentsV2Builder.buildIntervalModal();
      return interaction.showModal(modalPayload);
    }
  }
}
