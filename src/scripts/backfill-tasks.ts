/**
 * Backfill structured tasks for COMPLETED tracks that pre-date the tasks feature.
 *
 * Usage:
 *   docker exec voice-memory-app-1 node dist/scripts/backfill-tasks.js
 */

import 'reflect-metadata';
import { randomUUID } from 'crypto';
import OpenAI from 'openai';
import { dataSource } from '../data-source';
import { AudioTrackEntity, AudioTrackStatus } from '../audio-track/audio-track.entity';
import type { ActionTask } from '../audio-track/audio-track.entity';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function extractTasks(fullText: string): Promise<ActionTask[]> {
  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'Extract all action items / tasks from the transcript as a JSON object with key "tasks" containing an array. ' +
          'Each element: { "text": "<task description in the transcript language>" }. ' +
          'If no tasks found, return { "tasks": [] }. ' +
          'Use ONLY information from the transcript — do NOT invent anything.',
      },
      { role: 'user', content: fullText },
    ],
  });

  const raw = response.choices[0]?.message?.content ?? '{"tasks":[]}';
  const parsed = JSON.parse(raw) as { tasks?: Array<{ text: string }> };
  const items = parsed.tasks ?? [];
  return items
    .filter((item) => typeof item?.text === 'string' && item.text.trim().length > 0)
    .map((item) => ({ id: randomUUID(), text: item.text.trim(), done: false }));
}

async function main() {
  await dataSource.initialize();
  const repo = dataSource.getRepository(AudioTrackEntity);

  const tracks = await repo
    .createQueryBuilder('t')
    .where('t.status = :status', { status: AudioTrackStatus.COMPLETED })
    .andWhere('t.summaries IS NOT NULL')
    .andWhere("t.summaries->'tasks' IS NULL")
    .andWhere('t."fullText" IS NOT NULL')
    .getMany();

  console.log(`Found ${tracks.length} track(s) without tasks.`);
  if (tracks.length === 0) {
    await dataSource.destroy();
    return;
  }

  for (const track of tracks) {
    try {
      const tasks = await extractTasks(track.fullText!);
      await repo.update(track.id, {
        summaries: { ...track.summaries!, tasks },
      });
      console.log(`✓ track ${track.id} — ${tasks.length} task(s) extracted`);
    } catch (err) {
      console.error(`✗ track ${track.id} — ${(err as Error).message}`);
    }
  }

  await dataSource.destroy();
  console.log('Done.');
}

main().catch((e) => { console.error(e); process.exit(1); });
