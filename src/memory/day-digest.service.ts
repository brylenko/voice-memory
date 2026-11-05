import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
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
}

export interface DayMemory {
  date: string;
  items: DayMemoryItem[];
  /** Short watch-friendly recap of the whole day; null when nothing was heard. */
  digest: string | null;
}

const ITEM_SUMMARY_CHARS = 400;
const DIGEST_INPUT_CHARS = 12_000;

const DIGEST_PROMPT =
  'You get short notes of everything the user\'s smartwatch heard today, in chronological order. ' +
  'Write a recap that fits a round watch screen: at most 6 short lines, each starting with "• ". ' +
  'Keep concrete facts: names, numbers, dates, decisions, promises and to-dos. Skip small talk. ' +
  'No markdown headers. Reply in the dominant language of the notes.';

/** "What did I hear today?" — per-recording notes plus one LLM recap. */
@Injectable()
export class DayDigestService {
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
        status: AudioTrackStatus.COMPLETED,
        createdAt: Between(window.from, new Date(window.to.getTime() - 1)),
      },
      order: { createdAt: 'ASC' },
    });

    const items = rows
      .map((t) => this.encryption.decryptTrack(t))
      .map((t) => toItem(t))
      .filter((i) => i.summary.length > 0);

    return { date: window.date, items, digest: await this.digest(items) };
  }

  private async digest(items: DayMemoryItem[]): Promise<string | null> {
    if (items.length === 0) return null;
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
  const executive = t.summaries?.executive?.trim();
  const fallback = (t.fullText ?? '').trim();
  const summary = executive || (fallback.length > ITEM_SUMMARY_CHARS
    ? `${fallback.slice(0, ITEM_SUMMARY_CHARS)}…`
    : fallback);
  return {
    trackId: t.id,
    at: t.createdAt,
    durationSeconds: t.duration,
    channel: t.channel,
    tags: t.tags ?? [],
    summary,
  };
}
