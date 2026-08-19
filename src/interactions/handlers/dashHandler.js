import { inventory } from '../../fleet/inventory.js';
import { ComponentsV2Builder } from '../../ui/componentsV2.js';
import { SSHExecutor } from '../../ssh/executor.js';

export class DashHandler {
  static activeFilters = new Map(); // userId -> query string

  /**
   * Handle /dash command, text prefix (.dash), or pagination/refresh interaction
   */
  static async render(context, page = 1, forceTelemetry = false) {
    const isComponent = typeof context.isMessageComponent === 'function' && context.isMessageComponent();
    const userId = context.user?.id || context.author?.id;
    const filterQuery = this.activeFilters.get(userId) || '';

    if (forceTelemetry && isComponent) {
      await context.deferUpdate();
    }

    let machines = inventory.getAll();

    // Apply search filter if active
    if (filterQuery && filterQuery.toLowerCase() !== 'all' && filterQuery.trim() !== '') {
      const q = filterQuery.toLowerCase().trim();
      machines = machines.filter(m =>
        m.hostname.toLowerCase().includes(q) ||
        m.ip.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q) ||
        (m.tags && m.tags.some(t => t.toLowerCase().includes(q)))
      );
    }

    const stats = inventory.getStatsSummary();

    if (forceTelemetry) {
      const pageSize = 4;
      const startIdx = (page - 1) * pageSize;
      const visibleMachines = machines.slice(startIdx, startIdx + pageSize);

      await Promise.allSettled(
        visibleMachines.map(async (m) => {
          const res = await SSHExecutor.fetchTelemetry(m);
          if (res.success) {
            let status = 'ONLINE';
            if (res.metrics.cpu > 80 || (res.metrics.ramUsed / (res.metrics.ramTotal || 1)) > 0.85) {
              status = 'HIGH_LOAD';
            }
            inventory.updateMetrics(m.id, res.metrics, status);
          } else {
            inventory.setOffline(m.id);
          }
        })
      );
    }

    // Refresh after potential telemetry updates
    const refreshedAll = inventory.getAll();
    let updatedMachines = refreshedAll;
    if (filterQuery && filterQuery.toLowerCase() !== 'all' && filterQuery.trim() !== '') {
      const q = filterQuery.toLowerCase().trim();
      updatedMachines = refreshedAll.filter(m =>
        m.hostname.toLowerCase().includes(q) ||
        m.ip.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q) ||
        (m.tags && m.tags.some(t => t.toLowerCase().includes(q)))
      );
    }

    const updatedStats = inventory.getStatsSummary();

    const payload = ComponentsV2Builder.buildDashboard({
      machines: updatedMachines,
      page,
      pageSize: 4,
      totalCount: updatedMachines.length,
      stats: updatedStats,
      filterQuery
    });

    if (context.deferred) {
      return context.editReply(payload);
    } else if (isComponent) {
      return context.update(payload);
    } else if (typeof context.reply === 'function') {
      return context.reply(payload);
    }
  }

  static async handleButton(interaction) {
    const [action, param] = interaction.customId.split(':');

    if (action === 'dash_page') {
      const page = parseInt(param, 10) || 1;
      return this.render(interaction, page, false);
    }

    if (action === 'dash_refresh') {
      const page = parseInt(param, 10) || 1;
      return this.render(interaction, page, true);
    }

    if (interaction.customId === 'node_add_modal') {
      const modalPayload = ComponentsV2Builder.buildAddNodeModal();
      return interaction.showModal(modalPayload);
    }

    if (interaction.customId === 'fleet_bulk_prompt') {
      const modalPayload = ComponentsV2Builder.buildBulkExecModal();
      return interaction.showModal(modalPayload);
    }

    if (interaction.customId === 'fleet_add_machine_view') {
      const payload = ComponentsV2Builder.buildAddMachineView();
      return interaction.update(payload);
    }

    if (interaction.customId === 'fleet_search_prompt') {
      const currentFilter = this.activeFilters.get(interaction.user.id) || '';
      const modalPayload = ComponentsV2Builder.buildSearchFilterModal(currentFilter);
      return interaction.showModal(modalPayload);
    }

    if (interaction.customId === 'fleet_settings_view') {
      const payload = ComponentsV2Builder.buildSettingsView();
      return interaction.update(payload);
    }
  }
}
