/**
 * Re-queues all FAILED audio tracks for reprocessing.
 *
 * Usage:
 *   docker exec voice-memory-app-1 node dist/scripts/retry-failed-tracks.js
 *
 * Or for a specific user (pass the UUID from the users table):
 *   docker exec voice-memory-app-1 node dist/scripts/retry-failed-tracks.js --userId=<uuid>
 */

import 'reflect-metadata';
import { dataSource } from '../data-source';
import { AudioTrackEntity, AudioTrackStatus } from '../audio-track/audio-track.entity';
import Queue from 'bull';

const userId = process.argv.find((a) => a.startsWith('--userId='))?.split('=')[1];

async function main() {
  await dataSource.initialize();

  const repo = dataSource.getRepository(AudioTrackEntity);
  const where = userId
    ? { status: AudioTrackStatus.FAILED, userId }
    : { status: AudioTrackStatus.FAILED };

  const failed = await repo.findBy(where);
  console.log(`Found ${failed.length} FAILED track(s)${userId ? ` for user ${userId}` : ''}`);

  if (failed.length === 0) {
    await dataSource.destroy();
    return;
  }

  const queue = new Queue('audio-processing', {
    redis: {
      host: process.env.REDIS_HOST ?? 'localhost',
      port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    },
  });

  for (const track of failed) {
    // Reset status so the processor can update it
    await repo.update(track.id, { status: AudioTrackStatus.INITIALIZED });

    await queue.add(
      'process-audio-track',
      {
        trackId: track.id,
        storageKey: track.fileUrl, // fileUrl IS the storageKey for local disk driver
        userId: track.userId,
      },
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true },
    );

    console.log(`✓ Re-queued track ${track.id} (user=${track.userId} file=${track.fileUrl})`);
  }

  await queue.close();
  await dataSource.destroy();
  console.log('Done.');
}

main().catch((e) => { console.error(e); process.exit(1); });
