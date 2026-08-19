import { config } from '../config.js';
import { KeyManager } from '../fleet/keymanager.js';

/**
 * Official Discord Components V2 Specification
 * Reference: https://docs.discord.com/developers/components/reference
 */
export const ComponentType = {
  ActionRow: 1,
  Button: 2,
  StringSelect: 3,
  TextInput: 4,
  Section: 9,
  TextDisplay: 10,
  Thumbnail: 11,
  MediaGallery: 12,
  File: 13,
  Separator: 14,
  Container: 17
};

export const ButtonStyle = {
  Primary: 1,    // Blurple
  Secondary: 2,  // Neutral / Slate
  Success: 3,    // Green
  Danger: 4,     // Red
  Link: 5
};

export const TextInputStyle = {
  Short: 1,
  Paragraph: 2
};

// Bitwise flag 1 << 15 (32768) enables Discord Components V2 rendering
export const IS_COMPONENTS_V2 = 1 << 15; // 32768

export class ComponentsV2Builder {
  /**
   * Primary Fleet Dashboard (/dash or .dash) built with Components V2:
   * Container -> Header TextDisplay -> Top Separator -> Machine Sections with Accessory Buttons -> Bottom Separator -> ActionRows
   */
  static buildDashboard({ machines, page = 1, pageSize = 4, totalCount, stats, filterQuery = '' }) {
    const totalPages = Math.ceil(totalCount / pageSize) || 1;
    const currentPage = Math.max(1, Math.min(page, totalPages));
    const startIdx = (currentPage - 1) * pageSize;
    const pageMachines = machines.slice(startIdx, startIdx + pageSize);

    const containerChildren = [];

    // 1. Cluster Header
    const syncStatus = config.settings.autoSync ? `Auto-Sync: ${config.settings.pollIntervalSec}s` : 'Auto-Sync: OFF';
    const statusText = [
      stats.offline > 0 ? `Showing ${stats.total} machines  •  ${stats.online}/${stats.total} online\n` : '',
      // `**Active:** ${stats.online}/${stats.total} online\n`,
      // stats.highLoad > 0 ? `• **High Load:** ${stats.highLoad}` : '',
      filterQuery ? `• *Filter: "${filterQuery}"*` : ''
    ].filter(Boolean).join(' ');

    containerChildren.push({
      type: ComponentType.TextDisplay,
      content: `## Fleet Dashboard\n${statusText}`
    });

    // 2. Top Divider (Separating header from machines)
    containerChildren.push({
      type: ComponentType.Separator,
      divider: true,
      spacing: 1
    });

    // 3. Machine Sections (No dividers between machines)
    if (machines.length === 0) {
      containerChildren.push({
        type: ComponentType.TextDisplay,
        content: '*No nodes have been added yet*'
      });
    } else {
      for (const machine of pageMachines) {
        const isOffline = machine.status === 'OFFLINE';
        const isHighLoad = machine.status === 'HIGH_LOAD';

        let statusStyle = ButtonStyle.Success; // Green (3)
        let statusLabel = 'online';
        if (isOffline) {
          statusStyle = ButtonStyle.Danger; // Red (4)
          statusLabel = 'offline';
        } else if (isHighLoad) {
          statusStyle = ButtonStyle.Primary;
          statusLabel = 'high load';
        }

        const cpuStr = `${machine.metrics?.cpu ?? 0}% CPU`;
        const ramStr = `${machine.metrics?.ramUsed ?? 0}/${machine.metrics?.ramTotal ?? 0}GB RAM`;
        const latStr = `${machine.metrics?.latencyMs ?? 0}ms`;
        const uptimeStr = machine.metrics?.uptime ? `up ${machine.metrics.uptime}` : 'unreachable';
        const tagsStr = (machine.tags || []).map(t => `#${t}`).join(' ');

        const textContent = [
          `**${machine.hostname}**`,
          `\`${machine.ip}\` • ${uptimeStr}`,
          `\`[ ${cpuStr} | ${ramStr} | ${latStr} ]\` ${tagsStr ? `• ${tagsStr}` : ''}`
        ].join('\n');

        containerChildren.push({
          type: ComponentType.TextDisplay,
          content: textContent
        });

        containerChildren.push({
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.Button,
              style: statusStyle,
              label: statusLabel,
              custom_id: `status_ind:${machine.id}`,
              disabled: true
            },
            {
              type: ComponentType.Button,
              style: ButtonStyle.Secondary,
              label: 'manage',
              custom_id: `node_manage:${machine.id}`
            }
          ]
        });
      }
    }

    // 4. Bottom Divider (Separating machines from buttons)
    containerChildren.push({
      type: ComponentType.Separator,
      divider: true,
      spacing: 1
    });

    // 5. Navigation & Refresh Row
    containerChildren.push({
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.Button,
          style: ButtonStyle.Secondary,
          label: '◀ prev',
          custom_id: `dash_page:${currentPage - 1}`,
          disabled: currentPage <= 1
        },
        {
          type: ComponentType.Button,
          style: ButtonStyle.Secondary,
          label: `${currentPage}/${totalPages}`,
          custom_id: 'fleet_search_prompt',
          disabled: false
        },
        {
          type: ComponentType.Button,
          style: ButtonStyle.Secondary,
          label: 'next ▶',
          custom_id: `dash_page:${currentPage + 1}`,
          disabled: currentPage >= totalPages
        },
        {
          type: ComponentType.Button,
          style: ButtonStyle.Secondary,
          label: 'sync',
          custom_id: `dash_refresh:${currentPage}`
        }
      ]
    });

    // 6. Fleet Actions & Config Row
    containerChildren.push({
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.Button,
          style: ButtonStyle.Success,
          label: '+ add machine',
          custom_id: 'fleet_add_machine_view'
        },
        {
          type: ComponentType.Button,
          style: ButtonStyle.Primary,
          label: 'bulk exec',
          custom_id: 'fleet_bulk_prompt'
        },
        {
          type: ComponentType.Button,
          style: ButtonStyle.Secondary,
          label: 'settings',
          custom_id: 'fleet_settings_view'
        }
      ]
    });

    return {
      flags: IS_COMPONENTS_V2,
      components: [
        {
          type: ComponentType.Container,
          components: containerChildren
        }
      ]
    };
  }

  /**
   * Machine Specific Control Container View
   * Title shows ONLY the machine hostname (e.g. ## prd-edge-us-01)
   */
  static buildNodeManagementView(machine) {
    const isOffline = machine.status === 'OFFLINE';
    const isHighLoad = machine.status === 'HIGH_LOAD';

    let statusStyle = ButtonStyle.Success; // Green (3)
    let statusLabel = 'online';
    if (isOffline) {
      statusStyle = ButtonStyle.Danger; // Red (4)
      statusLabel = 'offline';
    } else if (isHighLoad) {
      statusStyle = ButtonStyle.Primary;
      statusLabel = 'high load';
    }

    const cpu = machine.metrics?.cpu ?? 0;
    const ramU = machine.metrics?.ramUsed ?? 0;
    const ramT = machine.metrics?.ramTotal ?? 0;
    const lat = machine.metrics?.latencyMs ?? 0;
    const uptime = machine.metrics?.uptime ?? 'n/a';
    const tags = (machine.tags || []).map(t => `#${t}`).join(' ') || '*none*';

    const cpuBarFilled = Math.min(10, Math.max(0, Math.round(cpu / 10)));
    const cpuBar = '█'.repeat(cpuBarFilled) + '░'.repeat(10 - cpuBarFilled);

    return {
      flags: IS_COMPONENTS_V2,
      components: [
        {
          type: ComponentType.Container,
          components: [
            {
              type: ComponentType.TextDisplay,
              content: [
                `## ${machine.hostname}`,
                `**Endpoint:** \`${machine.username || 'dssh'}@${machine.ip}:${machine.port || 22}\``
              ].join('\n')
            },
            {
              type: ComponentType.Separator,
              divider: true,
              spacing: 1
            },
            {
              type: ComponentType.TextDisplay,
              content: [
                '### Telemetry & Resource Utilization',
                `**CPU Load:** \`[ ${cpu}% ]\`  \`${cpuBar}\``,
                `**Memory:**   \`[ ${ramU}GB / ${ramT}GB (${Math.round((ramU / (ramT || 1)) * 100)}%) ]\``,
                `**Latency:**  \`[ ${lat}ms ]\``,
                `**Uptime:**   \`${uptime}\``,
                `**Tags:**     ${tags}`
              ].join('\n')
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
                  style: statusStyle,
                  label: statusLabel,
                  custom_id: `status_ind:${machine.id}`,
                  disabled: true
                },
                {
                  type: ComponentType.Button,
                  style: ButtonStyle.Primary,
                  label: 'exec bash',
                  custom_id: `node_exec_modal:${machine.id}`
                },
                {
                  type: ComponentType.Button,
                  style: ButtonStyle.Secondary,
                  label: 'tail logs',
                  custom_id: `node_logs:${machine.id}`
                },
                {
                  type: ComponentType.Button,
                  style: ButtonStyle.Secondary,
                  label: 'sessions (tmux)',
                  custom_id: `node_sessions:${machine.id}`
                },
                {
                  type: ComponentType.Button,
                  style: ButtonStyle.Secondary,
                  label: 'refresh',
                  custom_id: `node_refresh:${machine.id}`
                }
              ]
            },
            {
              type: ComponentType.ActionRow,
              components: [
                {
                  type: ComponentType.Button,
                  style: ButtonStyle.Danger,
                  label: 'terminate process',
                  custom_id: `node_kill_modal:${machine.id}`
                },
                {
                  type: ComponentType.Button,
                  style: ButtonStyle.Danger,
                  label: 'remove machine',
                  custom_id: `node_delete:${machine.id}`
                },
                {
                  type: ComponentType.Button,
                  style: ButtonStyle.Secondary,
                  label: '◀ fleet',
                  custom_id: 'dash_page:1'
                }
              ]
            }
          ]
        }
      ]
    };
  }

  /**
   * Interactive Settings View (/settings)
   */
  static buildSettingsView() {
    const s = config.settings;
    const autoSyncLabel = s.autoSync ? 'Auto-Sync: ON' : 'Auto-Sync: OFF';
    const cpuAlertsLabel = s.cpuAlerts ? `CPU Alerts: ON (${s.cpuThreshold}%)` : 'CPU Alerts: OFF';
    const ramAlertsLabel = s.ramAlerts ? `RAM Alerts: ON (${s.ramThreshold}%)` : 'RAM Alerts: OFF';

    return {
      flags: IS_COMPONENTS_V2,
      components: [
        {
          type: ComponentType.Container,
          components: [
            {
              type: ComponentType.TextDisplay,
              content: [
                '## Fleet Settings',
                'Configure background health polling, metric alerts, and threshold triggers.'
              ].join('\n')
            },
            {
              type: ComponentType.Separator,
              divider: true,
              spacing: 1
            },
            {
              type: ComponentType.TextDisplay,
              content: [
                `**Background Auto-Sync:** \`${s.autoSync ? 'ENABLED' : 'DISABLED'}\` (Interval: \`${s.pollIntervalSec}s\`)`,
                `**CPU Spike Alerts:** \`${s.cpuAlerts ? `ENABLED (>= ${s.cpuThreshold}%)` : 'DISABLED'}\``,
                `**RAM Exhaustion Alerts:** \`${s.ramAlerts ? `ENABLED (>= ${s.ramThreshold}%)` : 'DISABLED'}\``,
                `**Alert Channel:** ${config.alertChannelId ? `<#${config.alertChannelId}>` : '*None configured*'}`
              ].join('\n')
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
                  style: s.autoSync ? ButtonStyle.Success : ButtonStyle.Secondary,
                  label: autoSyncLabel,
                  custom_id: 'settings_toggle:autoSync'
                },
                {
                  type: ComponentType.Button,
                  style: s.cpuAlerts ? ButtonStyle.Success : ButtonStyle.Secondary,
                  label: cpuAlertsLabel,
                  custom_id: 'settings_toggle:cpuAlerts'
                },
                {
                  type: ComponentType.Button,
                  style: s.ramAlerts ? ButtonStyle.Success : ButtonStyle.Secondary,
                  label: ramAlertsLabel,
                  custom_id: 'settings_toggle:ramAlerts'
                }
              ]
            },
            {
              type: ComponentType.ActionRow,
              components: [
                {
                  type: ComponentType.Button,
                  style: ButtonStyle.Secondary,
                  label: `Interval: ${s.pollIntervalSec}s`,
                  custom_id: 'settings_modal:interval'
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
  }

  /**
   * Add Machine View — shows a simple one-liner to run on the target machine,
   * plus a manual add button for machines already provisioned.
   */
  static buildAddMachineView() {
    const pubKey = KeyManager.getPublicKey();
    const baseUrl = config.publicUrl ? config.publicUrl.replace(/\/+$/, '') : '';
    const endpoint = baseUrl ? `${baseUrl}/setup` : 'https://raw.githubusercontent.com/your-org/dssh/main/scripts/setup-node.sh';

    const oneLiner = baseUrl
      ? `curl -sL "${endpoint}" | sudo bash`
      : `curl -sL "${endpoint}" | sudo bash -s -- --key "${pubKey}"`;

    return {
      flags: IS_COMPONENTS_V2,
      components: [
        {
          type: ComponentType.Container,
          components: [
            {
              type: ComponentType.TextDisplay,
              content: [
                '## Add Machine',
                'Run this one-liner on your target Linux machine to automatically configure and connect it to your fleet:'
              ].join('\n')
            },
            {
              type: ComponentType.Separator,
              divider: true,
              spacing: 1
            },
            {
              type: ComponentType.TextDisplay,
              content: [
                '```bash',
                oneLiner,
                '```',
                '',
                '• Automatically configures dedicated `dssh` service account & SSH keys.',
                '• Automatically enrolls and appears live on your `/dash` immediately.',
                '• No copy-pasting or manual setup required.'
              ].join('\n')
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
                },
                {
                  type: ComponentType.Button,
                  style: ButtonStyle.Secondary,
                  label: 'manual add (fallback)',
                  custom_id: 'node_add_modal'
                }
              ]
            }
          ]
        }
      ]
    };
  }

  /**
   * Formats terminal command output inside a Components V2 Container
   * Title shows ONLY machine hostname (e.g. ## prd-edge-us-01)
   */
  static buildExecutionResultView({ machine, command, stdout, stderr, code, durationMs }) {
    const isSuccess = code === 0;
    const accentColor = isSuccess ? 0x23A55A : 0xDA373C; // Green for success, Red for error
    const statusLine = `**Exit Code:** \`${code} ${isSuccess ? '(OK)' : '(ERR)'}\` • **Duration:** \`${durationMs}ms\``;

    let outputText = '';
    if (stdout) outputText += stdout;
    if (stderr) outputText += (outputText ? '\n[STDERR]\n' : '') + stderr;
    if (!outputText) outputText = '(no stdout / stderr produced)';

    if (outputText.length > 3500) {
      outputText = outputText.slice(0, 3500) + '\n... [output truncated due to length]';
    }

    const titleText = machine ? `## ${machine.hostname}` : '## Fleet Cluster';

    return {
      flags: IS_COMPONENTS_V2,
      components: [
        {
          type: ComponentType.Container,
          accent_color: accentColor,
          components: [
            {
              type: ComponentType.TextDisplay,
              content: [
                titleText,
                `**Command:** \`$ ${command.slice(0, 60)}${command.length > 60 ? '...' : ''}\``,
                statusLine
              ].join('\n')
            },
            {
              type: ComponentType.Separator,
              divider: true,
              spacing: 1
            },
            {
              type: ComponentType.TextDisplay,
              content: `\`\`\`bash\n${outputText}\n\`\`\``
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
                  label: 'exec again',
                  custom_id: machine ? `node_exec_modal:${machine.id}` : 'fleet_bulk_prompt'
                },
                {
                  type: ComponentType.Button,
                  style: ButtonStyle.Secondary,
                  label: '◀ back to machine',
                  custom_id: machine ? `node_manage:${machine.id}` : 'dash_page:1'
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
  }

  /**
   * Alert Container for #server-logs
   */
  static buildAlertView({ machine, eventType, detail, metrics }) {
    let badge = 'HIGH LOAD WARNING';
    let accentColor = 0xF0B232; // Amber

    if (eventType === 'OFFLINE') {
      badge = 'MACHINE UNREACHABLE';
      accentColor = 0xDA373C; // Red
    } else if (eventType === 'RECOVERED') {
      badge = 'MACHINE RECOVERED';
      accentColor = 0x23A55A; // Green
    }

    const cpuStr = metrics?.cpu !== undefined ? `${metrics.cpu}% CPU` : 'N/A';
    const ramStr = metrics?.ramUsed !== undefined ? `${metrics.ramUsed}/${metrics.ramTotal}GB RAM` : 'N/A';

    return {
      flags: IS_COMPONENTS_V2,
      components: [
        {
          type: ComponentType.Container,
          accent_color: accentColor,
          components: [
            {
              type: ComponentType.TextDisplay,
              content: [
                `## ${badge}: ${machine.hostname}`,
                `**Endpoint:** \`${machine.ip}\` • **Time:** \`${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC\``,
                `**Telemetry:** \`[ ${cpuStr} | ${ramStr} ]\``,
                `**Incident:** ${detail}`
              ].join('\n')
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
                  label: 'inspect machine',
                  custom_id: `node_manage:${machine.id}`
                },
                {
                  type: ComponentType.Button,
                  style: ButtonStyle.Secondary,
                  label: 'view logs',
                  custom_id: `node_logs:${machine.id}`
                }
              ]
            }
          ]
        }
      ]
    };
  }

  /**
   * Modals
   */
  static buildExecModal(machineId = null) {
    return {
      title: (machineId ? `Exec: ${machineId}` : 'Bulk Fleet Execution').slice(0, 45),
      custom_id: machineId ? `modal_exec:${machineId}` : 'modal_bulk_exec',
      components: [
        {
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.TextInput,
              custom_id: 'command_input',
              label: 'Bash Command / Script',
              style: TextInputStyle.Paragraph,
              placeholder: 'uname -a && uptime\nsystemctl status nginx\ndocker ps',
              required: true,
              max_length: 4000
            }
          ]
        },
        {
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.TextInput,
              custom_id: 'timeout_input',
              label: 'Execution Timeout (seconds)',
              style: TextInputStyle.Short,
              value: '30',
              required: false,
              max_length: 4
            }
          ]
        }
      ]
    };
  }

  static buildAddNodeModal() {
    return {
      title: 'Register Linux Machine to Fleet',
      custom_id: 'modal_add_node',
      components: [
        {
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.TextInput,
              custom_id: 'hostname_input',
              label: 'Hostname',
              style: TextInputStyle.Short,
              placeholder: 'prd-worker-02',
              required: true
            }
          ]
        },
        {
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.TextInput,
              custom_id: 'ip_input',
              label: 'Host / IP Address & Port',
              style: TextInputStyle.Short,
              placeholder: 'node1.example.com:22 or 192.168.1.50:22',
              required: true
            }
          ]
        },
        {
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.TextInput,
              custom_id: 'user_input',
              label: 'SSH Username',
              style: TextInputStyle.Short,
              value: 'dssh',
              required: true
            }
          ]
        },
        {
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.TextInput,
              custom_id: 'tags_input',
              label: 'Tags (e.g. prod, worker, ingress)',
              style: TextInputStyle.Short,
              placeholder: 'prod, worker',
              required: false
            }
          ]
        },
        {
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.TextInput,
              custom_id: 'key_path_input',
              label: 'Private Key Path (blank for master key)',
              style: TextInputStyle.Paragraph,
              placeholder: 'Leave blank to use the bot\'s master cluster key',
              required: false
            }
          ]
        }
      ]
    };
  }

  static buildBulkExecModal() {
    return {
      title: 'Cluster Bulk Command Runner',
      custom_id: 'modal_bulk_exec',
      components: [
        {
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.TextInput,
              custom_id: 'target_filter',
              label: 'Target Tag or Hostname (or "all")',
              style: TextInputStyle.Short,
              value: 'all',
              placeholder: 'all / prod / worker',
              required: true
            }
          ]
        },
        {
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.TextInput,
              custom_id: 'command_input',
              label: 'Bash Command to Broadcast',
              style: TextInputStyle.Paragraph,
              placeholder: 'apt-get update -y && apt-get upgrade -y\ndocker pull redis:alpine',
              required: true
            }
          ]
        }
      ]
    };
  }

  static buildSearchFilterModal(currentFilter = '') {
    return {
      title: 'Filter & Search Machines',
      custom_id: 'modal_search_filter',
      components: [
        {
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.TextInput,
              custom_id: 'search_query_input',
              label: 'Search by Hostname, IP, or Tag',
              style: TextInputStyle.Short,
              value: currentFilter,
              placeholder: 'e.g. prd, worker, 100.64, all (or leave empty to reset)',
              required: false
            }
          ]
        }
      ]
    };
  }

  static buildIntervalModal() {
    return {
      title: 'Set Auto-Sync Interval',
      custom_id: 'modal_set_interval',
      components: [
        {
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.TextInput,
              custom_id: 'interval_input',
              label: 'Polling Interval in Seconds (10 - 300)',
              style: TextInputStyle.Short,
              value: `${config.settings.pollIntervalSec}`,
              required: true
            }
          ]
        }
      ]
    };
  }
}
