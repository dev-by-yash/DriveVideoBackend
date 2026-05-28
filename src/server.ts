import { app } from './app.js';
import { env } from './env.js';
import { prisma } from './db.js';
import { runBunnyPollingSync } from './app.js';

const server = app.listen(env.PORT, () => {
  console.log(`Drive app listening on http://localhost:${env.PORT}`);
});

// Background polling can spam logs when the DB is unreachable.
// Allow disabling via `DISABLE_POLLING=true` in env for debugging.
let syncTimer: NodeJS.Timeout | null = null;
if (process.env.DISABLE_POLLING !== 'true') {
  syncTimer = setInterval(() => {
    void runBunnyPollingSync().catch((error) => {
      console.error('Bunny polling sync failed:', error);
    });
  }, 90_000);
}

process.on('SIGTERM', async () => {
  clearInterval(syncTimer);
  server.close();
  await prisma.$disconnect();
});

process.on('SIGINT', async () => {
  clearInterval(syncTimer);
  server.close();
  await prisma.$disconnect();
});
