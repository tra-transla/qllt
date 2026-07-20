// Entry point for Phusion Passenger on Hostinger / cPanel
// This file redirects execution to the compiled backend server.

async function start() {
  try {
    await import('./dist/server.cjs');
  } catch (err) {
    const fs = await import('fs');
    const path = await import('path');
    const logPath = path.resolve('passenger-error.log');
    const timestamp = new Date().toISOString();
    const errorMsg = `Startup Error [${timestamp}]:\n${err.stack || err}\n\n`;
    fs.writeFileSync(logPath, errorMsg, { flag: 'a' });
    console.error('Fatal startup error:', err);
    process.exit(1);
  }
}

start();
