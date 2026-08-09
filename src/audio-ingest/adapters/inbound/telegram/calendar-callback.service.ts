import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from '../../../../user/user.entity';
import { AudioTrackEntity } from '../../../../audio-track/audio-track.entity';
import { GoogleCalendarService, CalendarEvent } from '../../../../google/google-calendar.service';
import { OAuthStateStore } from '../../../../google/oauth-state.store';
import { TelegramApiClient } from './telegram-api.client';

// callback_data payload format (all ≤64 bytes):
//   cal_events:<trackId>          → show events list (Google or DB fallback); userId resolved from track
//   cal_link:<trackId>:<eventId>  → link track to chosen Google event (eventId truncated to fit)
//   cal_db_link:<trackId>:<dbId>  → link track to another DB track
//   cal_connect:<userId>          → start OAuth flow
//   cal_cancel:<messageId>        → dismiss the keyboard

const MAX_EVENTS = 8;
const MAX_DB_TRACKS = 8;

// Calendar-type tags used to query past recordings from the DB.
// AI is instructed to always use English for calendar-type tags.
const CALENDAR_TAG_PATTERNS = [
  /^call$/i, /meeting/i, /interview/i, /sync/i, /zoom/i, /webinar/i, /conference/i, /lesson/i,
];

@Injectable()
export class CalendarCallbackService {
  private readonly logger = new Logger(CalendarCallbackService.name);

  constructor(
    @InjectRepository(UserEntity) private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(AudioTrackEntity) private readonly trackRepo: Repository<AudioTrackEntity>,
    private readonly calendar: GoogleCalendarService,
    private readonly oauthState: OAuthStateStore,
    private readonly telegram: TelegramApiClient,
  ) {}

  async handle(
    callbackQueryId: string,
    data: string,
    chatId: number,
    messageId: number,
  ): Promise<void> {
    const [action, ...rest] = data.split(':');

    switch (action) {
      case 'cal_connect':
        await this.handleConnect(callbackQueryId, rest[0], chatId);
        break;
      case 'cal_events':
        // rest[0]=trackId; userId resolved from track in DB
        await this.handleShowEvents(callbackQueryId, rest[0], chatId, messageId);
        break;
      case 'cal_link':
        // rest[0]=trackId, rest[1..]=eventId (may contain colons)
        await this.handleLink(callbackQueryId, rest[0], rest.slice(1).join(':'), chatId, messageId);
        break;
      case 'cal_db_link':
        // rest[0]=trackId, rest[1]=refTrackId
        await this.handleDbLink(callbackQueryId, rest[0], rest[1], chatId, messageId);
        break;
      case 'cal_cancel':
        await this.telegram.answerCallbackQuery(callbackQueryId);
        await this.telegram.editMessageReplyMarkup(chatId, messageId, null);
        break;
      default:
        await this.telegram.answerCallbackQuery(callbackQueryId, '❓ Unknown action');
    }
  }

  private async handleConnect(callbackQueryId: string, userId: string, chatId: number): Promise<void> {
    await this.telegram.answerCallbackQuery(callbackQueryId);
    const state = this.oauthState.generate(userId);
    const url = this.calendar.buildAuthUrl(state);
    await this.telegram.sendMessage(
      chatId,
      `🔗 Connect Google Calendar via this link:\n${url}`,
    );
  }

  private async handleShowEvents(
    callbackQueryId: string,
    trackId: string,
    chatId: number,
    messageId: number,
  ): Promise<void> {
    const track = await this.trackRepo.findOneBy({ id: trackId });
    if (!track) {
      await this.telegram.answerCallbackQuery(callbackQueryId, '❓ Track not found');
      return;
    }
    const userId = track.userId;

    const user = await this.userRepo
      .createQueryBuilder('u')
      .addSelect('u.googleAccessToken')
      .addSelect('u.googleRefreshToken')
      .where('u.id = :id', { id: userId })
      .getOne();

    if (user?.googleAccessToken) {
      await this.handleShowGoogleEvents(callbackQueryId, user, userId, trackId, chatId, messageId);
    } else {
      await this.handleShowDbEvents(callbackQueryId, userId, trackId, chatId, messageId);
    }
  }

  private async handleShowGoogleEvents(
    callbackQueryId: string,
    user: UserEntity,
    userId: string,
    trackId: string,
    chatId: number,
    messageId: number,
  ): Promise<void> {
    let accessToken = user.googleAccessToken!;
    if (user.googleTokenExpiry && user.googleTokenExpiry < new Date()) {
      try {
        const refreshed = await this.calendar.refreshAccessToken(user.googleRefreshToken!);
        accessToken = refreshed.accessToken;
        await this.userRepo.update(userId, {
          googleAccessToken: refreshed.accessToken,
          googleTokenExpiry: refreshed.expiry,
        });
      } catch (err) {
        this.logger.error(`Token refresh failed for user ${userId}: ${(err as Error).message}`);
        await this.telegram.answerCallbackQuery(callbackQueryId, '⚠️ Token expired — please reconnect Google Calendar');
        return;
      }
    }

    await this.telegram.answerCallbackQuery(callbackQueryId, 'Loading events...');

    let events: CalendarEvent[];
    try {
      events = await this.calendar.getUpcomingEvents(accessToken, MAX_EVENTS);
    } catch (err) {
      this.logger.error(`Calendar fetch failed: ${(err as Error).message}`);
      await this.telegram.sendMessage(chatId, '❌ Failed to load Calendar events.');
      return;
    }

    if (events.length === 0) {
      await this.telegram.sendMessage(chatId, '📅 No upcoming events found.');
      await this.telegram.editMessageReplyMarkup(chatId, messageId, null);
      return;
    }

    // cal_link:<trackId(36)>:<eventId> — keep eventId short enough; total ≤64 bytes
    const keyboard = events.map((e) => {
      const eid = e.id.slice(0, 16); // Google event IDs are long; first 16 chars are unique enough
      return [{ text: formatGoogleEventLabel(e), callback_data: `cal_link:${trackId}:${eid}` }];
    });
    keyboard.push([{ text: '✖️ Cancel', callback_data: `cal_cancel:${messageId}` }]);
    await this.telegram.editMessageReplyMarkup(chatId, messageId, keyboard);
  }

  private async handleShowDbEvents(
    callbackQueryId: string,
    userId: string,
    trackId: string,
    chatId: number,
    messageId: number,
  ): Promise<void> {
    await this.telegram.answerCallbackQuery(callbackQueryId, 'Searching archive...');

    // Pull completed tracks with calendar-type tags.
    // Order: future eventDate first (upcoming), then past, then no eventDate — all by eventDate/createdAt desc.
    const tracks = await this.trackRepo
      .createQueryBuilder('t')
      .where('t."userId" = :userId', { userId })
      .andWhere('t.status = :status', { status: 'COMPLETED' })
      .andWhere('t.id != :trackId', { trackId })
      .andWhere(
        'EXISTS (SELECT 1 FROM unnest(t.tags) tag WHERE ' +
        CALENDAR_TAG_PATTERNS.map((_, i) => `tag ~* :pat${i}`).join(' OR ') + ')',
        Object.fromEntries(CALENDAR_TAG_PATTERNS.map((re, i) => [`pat${i}`, re.source])),
      )
      .orderBy(`CASE WHEN t."eventDate" IS NOT NULL THEN t."eventDate" ELSE t."createdAt" END`, 'DESC')
      .limit(MAX_DB_TRACKS)
      .getMany();

    const now = new Date();
    // cal_db_link:<trackId(36)>:<refId(36)> = 10+36+1+36 = 83 — still too long.
    // Use first 8 chars of each UUID (collision risk negligible in context).
    const keyboard: Array<Array<{ text: string; callback_data: string }>> = tracks.map((t) => {
      return [{ text: formatDbTrackLabel(t, now), callback_data: `cal_db_link:${trackId.slice(0, 8)}:${t.id.slice(0, 8)}` }];
    });

    keyboard.push([{ text: '🔗 Connect Google Calendar', callback_data: `cal_connect:${userId}` }]);
    keyboard.push([{ text: '✖️ Cancel', callback_data: `cal_cancel:${messageId}` }]);

    if (tracks.length === 0) {
      await this.telegram.sendMessage(chatId, '📂 No meeting recordings in archive yet.');
      await this.telegram.editMessageReplyMarkup(chatId, messageId, [
        [{ text: '🔗 Connect Google Calendar', callback_data: `cal_connect:${userId}` }],
        [{ text: '✖️ Cancel', callback_data: `cal_cancel:${messageId}` }],
      ]);
      return;
    }

    await this.telegram.editMessageReplyMarkup(chatId, messageId, keyboard);
  }

  private async handleLink(
    callbackQueryId: string,
    trackId: string,
    eventId: string,
    chatId: number,
    messageId: number,
  ): Promise<void> {
    const track = await this.trackRepo.findOneBy({ id: trackId });
    const userId = track?.userId;

    const user = userId ? await this.userRepo
      .createQueryBuilder('u')
      .addSelect('u.googleAccessToken')
      .where('u.id = :id', { id: userId })
      .getOne() : null;

    let eventTitle = eventId;
    if (user?.googleAccessToken) {
      try {
        const events = await this.calendar.getUpcomingEvents(user.googleAccessToken, MAX_EVENTS);
        const found = events.find((e) => e.id === eventId);
        if (found) eventTitle = found.title;
      } catch {
        // best-effort; we still save the eventId
      }
    }

    await this.trackRepo.update(trackId, {
      calendarEventId: eventId,
      calendarEventTitle: eventTitle,
    });

    this.logger.log(`Track ${trackId} linked to calendar event ${eventId} ("${eventTitle}")`);

    await this.telegram.answerCallbackQuery(callbackQueryId, `✅ Linked to: ${eventTitle}`);
    await this.telegram.editMessageReplyMarkup(chatId, messageId, null);
    await this.telegram.sendMessage(chatId, `📅 Recording linked to event: <b>${eventTitle}</b>`, 'HTML');
  }

  private async handleDbLink(
    callbackQueryId: string,
    trackIdShort: string,
    refTrackIdShort: string,
    chatId: number,
    messageId: number,
  ): Promise<void> {
    // IDs were truncated to 8 chars — find by prefix
    const track = await this.trackRepo.createQueryBuilder('t').where('t.id LIKE :p', { p: `${trackIdShort}%` }).getOne();
    const ref = await this.trackRepo.createQueryBuilder('t').where('t.id LIKE :p', { p: `${refTrackIdShort}%` }).getOne();
    if (!track || !ref) {
      await this.telegram.answerCallbackQuery(callbackQueryId, '❓ Track not found');
      return;
    }
    const trackId = track.id;
    const refTrackId = ref.id;
    if (!ref) {
      await this.telegram.answerCallbackQuery(callbackQueryId, '❓ Track not found');
      return;
    }

    const summaries = typeof ref.summaries === 'string'
      ? (() => { try { return JSON.parse(ref.summaries as unknown as string); } catch { return null; } })()
      : ref.summaries;
    const label = summaries?.executive
      ? (summaries.executive as string).slice(0, 60)
      : ref.createdAt.toLocaleDateString('en-GB');

    await this.trackRepo.update(trackId, {
      calendarEventId: refTrackId,
      calendarEventTitle: label,
    });

    this.logger.log(`Track ${trackId} linked to DB track ${refTrackId} ("${label}")`);
    await this.telegram.answerCallbackQuery(callbackQueryId, `✅ Linked`);
    await this.telegram.editMessageReplyMarkup(chatId, messageId, null);
    await this.telegram.sendMessage(chatId, `📂 Recording linked to: ${label}`);
  }
}

function formatGoogleEventLabel(e: CalendarEvent): string {
  const now = new Date();
  const start = e.start;
  const isToday = start.toDateString() === now.toDateString();
  const isTomorrow = start.toDateString() === new Date(now.getTime() + 86400000).toDateString();

  const dayLabel = isToday ? 'Today' : isTomorrow ? 'Tomorrow' : start.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' });
  const timeLabel = start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const icon = e.meetLink ? '📹' : '📅';
  const title = e.title.length > 30 ? e.title.slice(0, 28) + '…' : e.title;
  return `${icon} ${dayLabel} ${timeLabel} — ${title}`;
}

function formatDbTrackLabel(track: AudioTrackEntity, now: Date): string {
  // Use eventDate if extracted, otherwise fall back to when the recording was made
  const refDate = track.eventDate ?? track.createdAt;
  const isFuture = track.eventDate != null && track.eventDate > now;

  const date = refDate.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' });
  const time = refDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  // Prefer a calendar-type tag as the title, fall back to start of executive summary
  const tag = track.tags.find((t) => CALENDAR_TAG_PATTERNS.some((re) => re.test(t)));
  const title = tag ?? track.summaries?.executive?.slice(0, 30) ?? '(untitled)';
  const trimmed = title.length > 30 ? title.slice(0, 28) + '…' : title;

  // Future events are highlighted, past get a checkmark
  const icon = isFuture ? '📅' : '🕐';
  return `${icon} ${date} ${time} — ${trimmed}`;
}
