import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  JoinColumn,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserEntity } from '../user/user.entity';

export interface ActionTask {
  id: string;
  text: string;
  done: boolean;
}

export enum SummarySection {
  Executive = 'executive',
  ActionItems = 'actionItems',
  KeyDecisions = 'keyDecisions',
  Detailed = 'detailed',
}

export const SUMMARY_SECTIONS = Object.values(SummarySection);

export interface TrackSummaries {
  [SummarySection.Executive]: string;
  [SummarySection.ActionItems]: string;
  [SummarySection.KeyDecisions]: string;
  [SummarySection.Detailed]: string;
  tasks: ActionTask[];
}

export enum AudioTrackStatus {
  INITIALIZED = 'INITIALIZED',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

@Entity({ name: 'audio_tracks' })
@Index(['userId', 'createdAt'])
export class AudioTrackEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** UUID FK to users.id — the canonical user identifier across all channels. */
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => UserEntity, (u) => u.tracks)
  @JoinColumn({ name: 'userId' })
  user: UserEntity;

  /** Physical device serial, when the channel is 'iot-device'; null for other channels. */
  @Column({ type: 'varchar', nullable: true })
  deviceId: string | null;

  /** Which inbound channel produced this recording: 'iot-device' | 'telegram' | ... */
  @Column({ type: 'varchar', default: 'iot-device' })
  channel: string;

  /** For telegram channel: chat id to send the summary back to. */
  @Column({ type: 'varchar', nullable: true })
  telegramChatId: string | null;

  /** Telegram message_id of the original voice/audio message — used to reply with the summary. */
  @Column({ type: 'int', nullable: true })
  telegramMessageId: number | null;

  @Column({ type: 'varchar', default: AudioTrackStatus.INITIALIZED })
  status: AudioTrackStatus;

  /** Duration in seconds, read from the audio file via music-metadata. */
  @Column({ type: 'int', default: 0 })
  duration: number;

  @Column()
  fileUrl: string;

  /** Encrypted JSON of TrackSummaries (stored as text after migration 012). */
  @Column({ type: 'text', nullable: true })
  summaries: TrackSummaries | null;

  /** OpenAI batch job id, kept so the polling worker can resume after a restart. */
  @Column({ type: 'varchar', nullable: true })
  batchJobId: string | null;

  /** Auto-detected tags extracted by LLM from the transcript. */
  @Column({ type: 'text', array: true, default: [] })
  tags: string[];

  /** Set to true after tags/eventDate have been extracted — prevents re-processing by BackfillTasksCron. */
  @Column({ type: 'boolean', default: false })
  tagsProcessed: boolean;

  /** Date/time of the meeting or call mentioned in the transcript (LLM-extracted, may be future). */
  @Column({ type: 'timestamptz', nullable: true })
  eventDate: Date | null;

  /** Google Calendar event ID this recording is linked to. */
  @Column({ type: 'varchar', nullable: true })
  calendarEventId: string | null;

  /** Human-readable title of the linked calendar event (cached to avoid re-fetch). */
  @Column({ type: 'varchar', nullable: true })
  calendarEventTitle: string | null;

  /** Full transcript text — stored for full-text search. */
  @Column({ type: 'text', nullable: true })
  fullText: string | null;

  /** GIN-indexed tsvector for full-text search (populated by trigger-like update in processor). */
  @Column({ type: 'tsvector', nullable: true, select: false })
  searchVector: unknown;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
