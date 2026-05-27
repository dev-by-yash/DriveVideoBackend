import { app } from './app.js';
import { env } from './env.js';
import { prisma } from './db.js';
import { runBunnyPollingSync } from './app.js';
const server = app.listen(env.PORT, () => {
    console.log(`Drive app listening on http://localhost:${env.PORT}`);
});
const syncTimer = setInterval(() => {
    void runBunnyPollingSync();
}, 90000);
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
