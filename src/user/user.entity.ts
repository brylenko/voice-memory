import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { AudioTrackEntity } from '../audio-track/audio-track.entity';

@Entity({ name: 'users' })
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Telegram user ID — null if user registered via another channel. */
  @Column({ type: 'varchar', nullable: true, unique: true })
  telegramId: string | null;

  /** IoT device serial number — null if user registered via another channel. */
  @Column({ type: 'varchar', nullable: true, unique: true })
  deviceId: string | null;

  /** Display name from whichever platform registered the user first. */
  @Column({ type: 'varchar', nullable: true })
  displayName: string | null;

  /** Tracks consumed from the free quota. Incremented after each completed processing job. */
  @Column({ type: 'int', default: 0 })
  freeTracksUsed: number;

  @Column({ type: 'text', nullable: true, select: false })
  googleAccessToken: string | null;

  @Column({ type: 'text', nullable: true, select: false })
  googleRefreshToken: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  googleTokenExpiry: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @OneToMany(() => AudioTrackEntity, (track) => track.user)
  tracks: AudioTrackEntity[];
}
