import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ulid } from 'ulid';
import { User } from '../../users/entities/user.entity';
import type { Angle } from '../skin-journal.constants';
import { SkinJournalEntry } from './skin-journal-entry.entity';

@Entity('skin_journal_entry_photos')
@Index('UQ_skin_journal_entry_photos_entry_angle', ['entry_id', 'angle'], {
  unique: true,
})
@Index('IDX_skin_journal_entry_photos_user_entry', ['user_id', 'entry_id'])
@Index('IDX_skin_journal_entry_photos_user_angle', ['user_id', 'angle'])
export class SkinJournalEntryPhoto {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  user_id: string;

  @Column({ type: 'varchar', length: 26 })
  entry_id: string;

  @Column({ type: 'varchar', length: 20 })
  angle: Angle;

  @Column({ type: 'text' })
  photo_object_key: string;

  @Column({ type: 'integer', nullable: true })
  photo_width: number | null;

  @Column({ type: 'integer', nullable: true })
  photo_height: number | null;

  @Column({ type: 'integer', nullable: true })
  photo_size: number | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  photo_content_type: string | null;

  @Column({ type: 'boolean', default: false })
  exif_stripped: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => SkinJournalEntry, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'entry_id' })
  entry: SkinJournalEntry;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = ulid();
    }
  }
}
