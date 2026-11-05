import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { CHAT_COMPLETION_PORT, ChatCompletionPort } from '../ai/ports/chat-completion.port';
import { AudioTrackEntity, AudioTrackStatus } from '../audio-track/audio-track.entity';
import { EncryptionService } from '../common/services/encryption.service';
import { dayWindow } from './day-window';

export interface DayMemoryItem {
  trackId: string;
  at: Date;
  durationSeconds: number;
  channel: string;
  tags: string[];
  summary: string;
  /** Conversation still being recorded (live stream): summary is the latest transcript tail. */
  live: boolean;
}

export interface DayMemory {
  date: string;
  items: DayMemoryItem[];
  /** Short watch-friendly recap of the whole day; null when nothing was heard. */
  digest: string | null;
}

const ITEM_SUMMARY_CHARS = 400;
/** Recap of completed recordings is cached so the watch can poll every few seconds cheaply. */
const DIGEST_CACHE_MAX = 500;
const DIGEST_INPUT_CHARS = 12_000;

const DIGEST_PROMPT =
  'You get short notes of everything the user\'s smartwatch heard today, in chronological order. ' +
  'Write a recap that fits a round watch screen: at most 6 short lines, each starting with "• ". ' +
  'Keep concrete facts: names, numbers, dates, decisions, promises and to-dos. Skip small talk. ' +
  'No markdown headers. Reply in the dominant language of the notes.';

/** "What did I hear today?" — per-recording notes plus one LLM recap. */
@Injectable()
export class DayDigestService {
  private readonly digestCache = new Map<string, string | null>();

  constructor(
    @InjectRepository(AudioTrackEntity) private readonly tracks: Repository<AudioTrackEntity>,
    @Inject(CHAT_COMPLETION_PORT) private readonly chat: ChatCompletionPort,
    private readonly encryption: EncryptionService,
  ) {}

  async getDay(userId: string, opts: { date?: string; tzOffsetMinutes?: number }): Promise<DayMemory> {
    const window = dayWindow(opts.tzOffsetMinutes ?? 0, opts.date);
    const rows = await this.tracks.find({
      where: {
        userId,
        // PROCESSING = live conversation in progress (or a file still being transcribed).
        status: In([AudioTrackStatus.COMPLETED, AudioTrackStatus.PROCESSING]),
        createdAt: Between(window.from, new Date(window.to.getTime() - 1)),
      },
      order: { createdAt: 'ASC' },
    });

    const items = rows
      .map((t) => this.encryption.decryptTrack(t))
      .map((t) => toItem(t))
      .filter((i) => i.summary.length > 0);

    const completed = items.filter((i) => !i.live);
    return { date: window.date, items, digest: await this.cachedDigest(userId, window.date, completed) };
  }

  /** The recap only changes when a recording completes → key it by the completed track ids. */
  private async cachedDigest(userId: string, date: string, items: DayMemoryItem[]): Promise<string | null> {
    if (items.length === 0) return null;
    const key = `${userId}|${date}|${items.map((i) => i.trackId).join(',')}`;
    if (this.digestCache.has(key)) return this.digestCache.get(key)!;
    const digest = await this.digest(items);
    if (this.digestCache.size >= DIGEST_CACHE_MAX) {
      this.digestCache.delete(this.digestCache.keys().next().value as string);
    }
    this.digestCache.set(key, digest);
    return digest;
  }

  private async digest(items: DayMemoryItem[]): Promise<string | null> {
    let notes = '';
    for (const i of items) {
      const line = `[${i.at.toISOString().slice(11, 16)} UTC] ${i.summary}\n`;
      if (notes.length + line.length > DIGEST_INPUT_CHARS) break;
      notes += line;
    }
    const text = await this.chat.complete(
      [
        { role: 'system', content: DIGEST_PROMPT },
        { role: 'user', content: notes },
      ],
      { temperature: 0.2 },
    );
    return text.trim() || null;
  }
}

function toItem(t: AudioTrackEntity): DayMemoryItem {
  const live = t.status === AudioTrackStatus.PROCESSING;
  const executive = live ? undefined : t.summaries?.executive?.trim();
  const text = (t.fullText ?? '').trim();
  // Live: show the *latest* words; finished: the beginning reads better as a fallback summary.
  const fallback = text.length <= ITEM_SUMMARY_CHARS
    ? text
    : live ? `…${text.slice(-ITEM_SUMMARY_CHARS)}` : `${text.slice(0, ITEM_SUMMARY_CHARS)}…`;
  const summary = executive || fallback;
  return {
    trackId: t.id,
    at: t.createdAt,
    durationSeconds: t.duration,
    channel: t.channel,
    tags: t.tags ?? [],
    summary,
    live,
  };
}
