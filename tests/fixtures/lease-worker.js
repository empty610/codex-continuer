import { acquireLease } from '../../server/lease.js';
process.send({ type: 'ready' });
process.once('message', async ({ directory }) => {
  try {
    const release = await acquireLease(directory, 'service');
    process.send({ type: 'acquired', pid: process.pid });
    process.once('message', async () => { await release(); process.disconnect(); });
  } catch (error) { process.send({ type: 'rejected', message: error.message }); process.disconnect(); }
});
