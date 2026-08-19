# DSSH Cluster Orchestrator (Discord Fleet Manager)

A production-grade Linux server fleet orchestrator bot for Discord built with Discord's **Components V2** architecture (`Containers`, `Sections`, `TextDisplays`, `Separators`, `ActionRows`, `Modals`, and `Buttons`).

## Features

- **Components V2 Dashboard (`/dash`)**: Sleek terminal-grade dark UI (`#182026` / `#0F2D37`) displaying aggregate fleet health and modular node cards with inline telemetry `[ 4.2% CPU | 1.8/8GB RAM | 42ms ]`.
- **Pooled SSH2 Engine**: High-performance persistent connection pooling with keepalives, exponential reconnects, and automatic idle reaping.
- **Interactive Shell Modals**: Trigger bash execution modals on individual nodes or broadcast cluster-wide commands by tag/region.
- **Detached Session & Log Inspection**: Tail journalctl/syslog and inspect background `tmux` / `screen` / `systemd` processes directly in Discord.
- **Non-blocking Health Monitoring**: Background poller checking latency and load spikes, firing alert containers to `#server-logs`.
- **Strict Authorization Whitelist**: Zero-trust security verifying `interaction.user.id` against a hardcoded whitelist on every single interaction and command.

## Quickstart

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
Copy `.env.example` to `.env`:
```env
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_client_id_here
GUILD_ID=your_guild_id_here (optional: for instant command sync)
AUTHORIZED_USER_IDS=your_discord_user_id_here
ALERT_CHANNEL_ID=your_alert_channel_id_here
POLL_INTERVAL_SEC=30
```

### 3. Run the Bot
```bash
# Start bot
npm start

# Development mode (auto-restarts on code changes)
npm run dev
```

## Slash Commands

- `/dash` - Opens the interactive cluster dashboard with pagination and live node cards.
- `/node [node_id]` - Directly open the management container for a specific node.
- `/exec [node_id] [command]` - Run a quick bash command on a single server.
- `/fleet [command] [target]` - Broadcast a command across all nodes or filtered by tag (e.g., `prod`, `us-east-1`).
