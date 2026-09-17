const path = require('path');

const rootDir = __dirname;

module.exports = {
  apps: [
    {
      name: process.env.ARCHON_PM2_NAME || 'archon',
      cwd: rootDir,
      script: path.join(rootDir, 'scripts', 'pm2-start.sh'),
      interpreter: '/bin/bash',
      autorestart: true,
      // Self-heal across transient external-volume (WD_BLACK) stalls/remounts:
      // exponential backoff (superseding restart_delay, capped ~15s) keeps PM2
      // retrying with growing delay instead of burning through max_restarts in
      // the stall window and stopping permanently. min_uptime makes a start
      // count as healthy only after 15s, so the restart counter resets once the
      // drive recovers and Archon stays up.
      max_restarts: 100,
      exp_backoff_restart_delay: 3000,
      min_uptime: 15000,
      time: true,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
