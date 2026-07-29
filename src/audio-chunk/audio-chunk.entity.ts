import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type DayOfWeek =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

/**
 * NOTE on `embedding`: pgvector's `vector` type has no native TypeORM ColumnType,
 * so it is intentionally NOT declared with @Column here. The column exists in the
 * database (see InitSchema migration) and is written/read exclusively through raw
 * SQL in AudioChunkRepository, keeping the ORM entity honest about what it can
 * actually hydrate while still allowing full-precision vector search.
 */
@Entity({ name: 'audio_chunks' })
@Index(['userId', 'createdAt'])
export class AudioChunkEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  trackId: string;

  /** UUID FK to users.id — the canonical user identifier. */
  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'text' })
  text: string;

  @Column({ type: 'varchar' })
  dayOfWeek: DayOfWeek;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  // Populated only when hydrated from a raw query that explicitly selects it.
  embedding?: number[];
}
