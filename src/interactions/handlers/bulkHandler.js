import { inventory } from '../../fleet/inventory.js';
import { SSHExecutor } from '../../ssh/executor.js';
import { ComponentType, ButtonStyle, IS_COMPONENTS_V2 } from '../../ui/componentsV2.js';

export class BulkHandler {
  /**
   * Pending / Loading container shown while commands are executing
   */
  static buildPendingView(targetFilter, command, targetCount = null) {
    const targetLine = targetCount !== null
      ? `**Targets:** \`${targetCount} Machines Matched\` (Filter: \`${targetFilter || 'all'}\`)`
      : `**Target Filter:** \`${targetFilter || 'all'}\``;

    return {
      flags: IS_COMPONENTS_V2,
      components: [
        {
          type: ComponentType.Container,
          accent_color: 0x5865F2, // Blurple loading indicator
          components: [
            {
              type: ComponentType.TextDisplay,
              content: [
                '## Bulk Cluster Execution',
                'Sending commands...',
                `**Command:** \`$ ${command.slice(0, 60)}${command.length > 60 ? '...' : ''}\``,
                targetLine
              ].join('\n')
            },
            {
              type: ComponentType.Separator,
              divider: true,
              spacing: 1
            },
            {
              type: ComponentType.TextDisplay,
              content: '*Broadcasting commands across the fleet. Please wait...*'
            }
          ]
        }
      ]
    };
  }

  static async executeCluster(interaction, targetFilter, command, timeoutSec = 30) {
    let targets = [];
    const filter = (targetFilter || 'all').trim().toLowerCase();

    if (filter === 'all' || filter === '*') {
      targets = inventory.getAll();
    } else {
      targets = inventory.getAll().filter(m => 
        (m.tags && m.tags.includes(filter)) ||
        (m.id.toLowerCase() === filter) ||
        (m.hostname.toLowerCase() === filter)
      );
    }

    if (targets.length === 0) {
      const emptyPayload = {
        flags: IS_COMPONENTS_V2,
        components: [
          {
            type: ComponentType.Container,
            accent_color: 0xDA373C,
            components: [
              {
                type: ComponentType.TextDisplay,
                content: `## Bulk Execution: 0 Targets Matched\n*Filter "${targetFilter}" matched no machines in inventory.*`
              },
              {
                type: ComponentType.Separator,
                divider: true,
                spacing: 1
              },
              {
                type: ComponentType.ActionRow,
                components: [
                  {
                    type: ComponentType.Button,
                    style: ButtonStyle.Secondary,
                    label: '◀ fleet dashboard',
                    custom_id: 'dash_page:1'
                  }
                ]
              }
            ]
          }
        ]
      };
      return interaction.editReply(emptyPayload);
    }

    // 1. Instantly display "sending commands..." loading embed
    const pendingPayload = this.buildPendingView(targetFilter, command, targets.length);
    await interaction.editReply(pendingPayload);

    // 2. Concurrently execute commands across machines
    const t0 = Date.now();
    const results = await Promise.allSettled(
      targets.map(async (machine) => {
        try {
          const res = await SSHExecutor.exec(machine, command, { timeoutMs: timeoutSec * 1000 });
          return { machine, success: true, ...res };
        } catch (err) {
          return { machine, success: false, error: err.message, code: 1, durationMs: 0 };
        }
      })
    );

    const elapsed = Date.now() - t0;
    const successful = results.filter(r => r.status === 'fulfilled' && r.value.success && r.value.code === 0).length;
    const failed = targets.length - successful;

    const lines = [];
    lines.push(`## Bulk Cluster Execution`);
    lines.push(`**Command:** \`$ ${command.slice(0, 50)}${command.length > 50 ? '...' : ''}\``);
    lines.push(`**Targets:** ${targets.length} Machines • **Success:** ${successful} • **Failed:** ${failed} • **Time:** ${elapsed}ms`);
    lines.push('```bash');

    for (const r of results) {
      if (r.status === 'fulfilled') {
        const val = r.value;
        const statusStr = val.success && val.code === 0 ? 'OK  ' : 'FAIL';
        const outSnippet = (val.stdout || val.stderr || val.error || '').split('\n')[0].slice(0, 80);
        lines.push(`[${statusStr}] ${val.machine.hostname.padEnd(20)} (${val.durationMs}ms) : ${outSnippet}`);
      }
    }
    lines.push('```');

    // 3. Update in-place with final success or error container
    const finalPayload = {
      flags: IS_COMPONENTS_V2,
      components: [
        {
          type: ComponentType.Container,
          accent_color: failed > 0 ? 0xDA373C : 0x23A55A,
          components: [
            {
              type: ComponentType.TextDisplay,
              content: lines.join('\n')
            },
            {
              type: ComponentType.Separator,
              divider: true,
              spacing: 1
            },
            {
              type: ComponentType.ActionRow,
              components: [
                {
                  type: ComponentType.Button,
                  style: ButtonStyle.Primary,
                  label: 'exec another',
                  custom_id: 'fleet_bulk_prompt'
                },
                {
                  type: ComponentType.Button,
                  style: ButtonStyle.Secondary,
                  label: '◀ fleet dashboard',
                  custom_id: 'dash_page:1'
                }
              ]
            }
          ]
        }
      ]
    };

    return interaction.editReply(finalPayload);
  }
}
