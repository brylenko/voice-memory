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

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @OneToMany(() => AudioTrackEntity, (track) => track.user)
  tracks: AudioTrackEntity[];
}
