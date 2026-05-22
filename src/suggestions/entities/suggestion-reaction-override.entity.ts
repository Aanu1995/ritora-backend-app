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
import { SkinJournalEntry } from '../../skin-journal/entities/skin-journal-entry.entity';
import { User } from '../../users/entities/user.entity';
import { SuggestionReactionOverrideReason } from '../suggestions.constants';

@Entity('suggestion_reaction_overrides')
@Index(
  'UQ_suggestion_reaction_overrides_user_date',
  ['user_id', 'target_date'],
  {
    unique: true,
  },
)
@Index('IDX_suggestion_reaction_overrides_expires_at', ['expires_at'])
export class SuggestionReactionOverride {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  user_id: string;

  @Column({ type: 'date' })
  target_date: string;

  @Column({ type: 'varchar', length: 26, nullable: true })
  reaction_entry_id: string | null;

  @Column({ type: 'varchar', length: 40 })
  reason: SuggestionReactionOverrideReason;

  @Column({ type: 'timestamptz' })
  expires_at: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => SkinJournalEntry, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'reaction_entry_id' })
  reaction_entry: SkinJournalEntry | null;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = ulid();
    }
  }
}
