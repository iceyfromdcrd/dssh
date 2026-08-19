import { sshPool } from './pool.js';

export class SSHExecutor {
  /**
   * Run a shell command on a machine
   * @param {Object} node 
   * @param {string} command 
   * @param {Object} options 
   * @returns {Promise<{ stdout: string, stderr: string, code: number, durationMs: number }>}
   */
  static async exec(node, command, options = { timeoutMs: 15000 }) {
    const startTime = Date.now();
    const client = await sshPool.acquire(node);

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let isDone = false;

      const timer = setTimeout(() => {
        if (!isDone) {
          isDone = true;
          sshPool.release(node.id);
          reject(new Error(`Command timed out after ${options.timeoutMs}ms`));
        }
      }, options.timeoutMs);

      client.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          sshPool.release(node.id);
          return reject(err);
        }

        stream
          .on('close', (code, signal) => {
            if (!isDone) {
              isDone = true;
              clearTimeout(timer);
              sshPool.release(node.id);
              resolve({
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                code: code !== null ? code : (signal ? 128 : 0),
                durationMs: Date.now() - startTime
              });
            }
          })
          .on('data', (data) => {
            stdout += data.toString('utf-8');
            if (stdout.length > 500000) stdout = stdout.slice(0, 500000) + '\n... [output truncated]';
          })
          .stderr.on('data', (data) => {
            stderr += data.toString('utf-8');
            if (stderr.length > 100000) stderr = stderr.slice(0, 100000) + '\n... [stderr truncated]';
          });
      });
    });
  }

  /**
   * Fast telemetry fetcher (CPU, RAM, Uptime)
   */
  static async fetchTelemetry(node) {
    const t0 = Date.now();
    const script = `
      top -bn1 | grep "Cpu(s)" | awk '{print 100 - $8}' 2>/dev/null || cat <(grep 'cpu ' /proc/stat) <(sleep 0.1; grep 'cpu ' /proc/stat) | awk -v RS="" '{print ($13-$2+$15-$4)*100/($13-$2+$15-$4+$16-$5)}'
      free -m | awk '/Mem:/ {printf "%.1f %.1f", $3/1024, $2/1024}'
      uptime -p 2>/dev/null || uptime | awk -F'( |,|:)+' '{print $6"h "$7"m"}'
    `;
    
    try {
      const res = await this.exec(node, script, { timeoutMs: 5000 });
      const latencyMs = Date.now() - t0;
      const lines = res.stdout.split('\n').map(l => l.trim()).filter(Boolean);

      const cpu = parseFloat(lines[0]) || 0;
      const memParts = (lines[1] || '0 0').split(' ');
      const ramUsed = parseFloat(memParts[0]) || 0;
      const ramTotal = parseFloat(memParts[1]) || 0;
      const uptime = lines[2] || 'up';

      return {
        success: true,
        metrics: {
          cpu: Math.round(cpu * 10) / 10,
          ramUsed: Math.round(ramUsed * 10) / 10,
          ramTotal: Math.round(ramTotal * 10) / 10,
          uptime: uptime.replace('up ', ''),
          latencyMs
        }
      };
    } catch (err) {
      return {
        success: false,
        error: err.message
      };
    }
  }

  /**
   * Inspect background sessions (tmux, screen, systemd services)
   */
  static async listBackgroundSessions(node) {
    const script = `
      echo "=== TMUX SESSIONS ==="
      tmux ls 2>/dev/null || echo "No tmux sessions"
      echo ""
      echo "=== SCREEN SESSIONS ==="
      screen -ls 2>/dev/null || echo "No screen sessions"
      echo ""
      echo "=== TOP RUNNING SERVICES ==="
      systemctl list-units --type=service --state=running --no-pager --no-legend 2>/dev/null | head -n 8 | awk '{print $1}' || echo "N/A"
    `;
    return this.exec(node, script, { timeoutMs: 5000 });
  }

  /**
   * Fetch recent syslog or journalctl log tail
   */
  static async fetchLogs(node, lines = 30) {
    const script = `journalctl -n ${lines} --no-pager -q 2>/dev/null || tail -n ${lines} /var/log/syslog 2>/dev/null || tail -n ${lines} /var/log/messages 2>/dev/null || echo "Log files not found or permission restricted"`;
    return this.exec(node, script, { timeoutMs: 5000 });
  }
}
