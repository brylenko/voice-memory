import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AudioTrackEntity, AudioTrackStatus } from '../audio-track/audio-track.entity';
import { UserEntity } from '../user/user.entity';
import { TelegramApiClient } from '../audio-ingest/adapters/inbound/telegram/telegram-api.client';
import { EncryptionService } from '../common/services/encryption.service';

// Round eventDate to HH:MM in Kyiv time — used as de-dup key
function timeSlotKey(track: AudioTrackEntity): string {
  const time = track.eventDate!.toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv',
  });
  return `${track.userId}:${time}`;
}

// Keep only the most recently created track per (userId, HH:MM) slot
function deduplicateByTimeSlot(tracks: AudioTrackEntity[]): AudioTrackEntity[] {
  const best = new Map<string, AudioTrackEntity>();
  for (const t of tracks) {
    const key = timeSlotKey(t);
    const existing = best.get(key);
    if (!existing || t.createdAt > existing.createdAt) {
      best.set(key, t);
    }
  }
  return [...best.values()].sort((a, b) => a.eventDate!.getTime() - b.eventDate!.getTime());
}

@Injectable()
export class DailyBriefingCron {
  private readonly logger = new Logger(DailyBriefingCron.name);

  // trackId → timestamp when we last notified about it
  private readonly notified = new Map<string, number>();

  constructor(
    @InjectRepository(AudioTrackEntity) private readonly trackRepo: Repository<AudioTrackEntity>,
    @InjectRepository(UserEntity) private readonly userRepo: Repository<UserEntity>,
    private readonly telegram: TelegramApiClient,
    private readonly encryption: EncryptionService,
  ) {}

  @Cron('*/15 * * * *')
  async run(): Promise<void> {
    const now = new Date();
    const windowEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const upcoming = await this.trackRepo
      .createQueryBuilder('t')
      .where('t.status = :status', { status: AudioTrackStatus.COMPLETED })
      .andWhere('t."eventDate" >= :now', { now })
      .andWhere('t."eventDate" <= :end', { end: windowEnd })
      .orderBy('t."eventDate"', 'ASC')
      .getMany();

    // Evict stale entries (events that already passed)
    for (const [id, ts] of this.notified) {
      if (ts < now.getTime() - 25 * 60 * 60 * 1000) this.notified.delete(id);
    }

    // Keep only tracks we haven't notified about yet
    const newTracks = upcoming.filter((t) => !this.notified.has(t.id));
    if (newTracks.length === 0) return;

    // De-duplicate by eventDate rounded to the minute — multiple recordings
    // about the same event should produce one notification, not N.
    // Keep the most recently created track per (userId, HH:MM slot).
    const deduped = deduplicateByTimeSlot(newTracks);

    // Group by userId
    const byUser = new Map<string, AudioTrackEntity[]>();
    for (const track of deduped) {
      const list = byUser.get(track.userId) ?? [];
      list.push(track);
      byUser.set(track.userId, list);
    }

    for (const [userId, tracks] of byUser) {
      const user = await this.userRepo.findOneBy({ id: userId });
      if (!user?.telegramId) continue;

      tracks.forEach((t) => this.encryption.decryptTrack(t));

      const lines = tracks.map((t) => {
        const time = t.eventDate!.toLocaleTimeString('en-GB', {
          hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv',
        });
        // Show only short noun-tags (≤3 words); skip action-phrase tags from legacy records
        const cleanTags = t.tags.filter((tag) => tag.trim().split(/\s+/).length <= 3);
        const tagsStr = cleanTags.length > 0 ? cleanTags.map((tag) => `#${tag}`).join(' ') : '';
        const executive = t.summaries?.executive ?? '';
        const firstSentence = executive.match(/^[^.!?]+[.!?]/)?.[0] ?? executive.slice(0, 120);
        return `🕐 <b>${time}</b>${tagsStr ? ' — ' + tagsStr : ''}\n${firstSentence}`;
      });

      const text = lines.length === 1
        ? `📅 <b>Reminder:</b>\n\n${lines[0]}`
        : `📅 <b>Upcoming events:</b>\n\n${lines.join('\n\n')}`;

      try {
        await this.telegram.sendMessage(user.telegramId, text, 'HTML');
        // Mark all tracks in the same time slot as notified, not just the winner,
        // so duplicates are suppressed on the next cron tick too.
        upcoming
          .filter((t) => t.userId === userId)
          .forEach((t) => this.notified.set(t.id, now.getTime()));
        this.logger.log(`Briefing sent to user ${userId}: ${tracks.length} event(s)`);
      } catch (err) {
        this.logger.error(`Failed to send briefing to ${userId}: ${(err as Error).message}`);
      }
    }
  }
}
