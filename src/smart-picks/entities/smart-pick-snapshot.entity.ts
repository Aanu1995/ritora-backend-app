import {
  BeforeInsert,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { ulid } from 'ulid';
import { encryptedJsonFieldTransformer } from '../../skin-profile/skin-profile-field-encryption';
import { User } from '../../users/entities/user.entity';
import {
  SmartPicksCoverage,
  SmartPicksCoveredItem,
  SmartPicksGapSnapshot,
  SmartPicksMode,
  SmartPicksRecap,
  SmartPicksRedundancyGroup,
} from '../smart-picks.types';

const encryptedCoverageTransformer =
  encryptedJsonFieldTransformer<SmartPicksCoverage>(
    'smart_pick_snapshots.coverage_json',
    { slots: [], filled: 0, total: 0 },
  );
const encryptedGapsTransformer = encryptedJsonFieldTransformer<
  SmartPicksGapSnapshot[]
>('smart_pick_snapshots.gaps_json', []);
const encryptedCoveredTransformer = encryptedJsonFieldTransformer<
  SmartPicksCoveredItem[]
>('smart_pick_snapshots.covered_json', []);
const encryptedRedundancyTransformer = encryptedJsonFieldTransformer<
  SmartPicksRedundancyGroup[]
>('smart_pick_snapshots.redundancy_json', []);
const encryptedRecapTransformer =
  encryptedJsonFieldTransformer<SmartPicksRecap>(
    'smart_pick_snapshots.recap_json',
    {
      primaryGoal: null,
      skinType: null,
      location: { city: null, countryCode: null },
      budgetTier: null,
      ethnicity: null,
    },
  );

@Entity('smart_pick_snapshots')
@Index('UQ_smart_pick_snapshots_user_mode', ['user_id', 'mode'], {
  unique: true,
})
export class SmartPickSnapshot {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  user_id: string;

  @Column({ type: 'varchar', length: 16 })
  mode: SmartPicksMode;

  @Column({ type: 'jsonb', transformer: encryptedCoverageTransformer })
  coverage_json: SmartPicksCoverage;

  @Column({ type: 'jsonb', transformer: encryptedGapsTransformer })
  gaps_json: SmartPicksGapSnapshot[];

  @Column({ type: 'jsonb', transformer: encryptedCoveredTransformer })
  covered_json: SmartPicksCoveredItem[];

  @Column({ type: 'jsonb', transformer: encryptedRedundancyTransformer })
  redundancy_json: SmartPicksRedundancyGroup[];

  @Column({ type: 'jsonb', transformer: encryptedRecapTransformer })
  recap_json: SmartPicksRecap;

  @Column({ type: 'varchar', length: 64 })
  inputs_hash: string;

  @Column({ type: 'timestamptz' })
  generated_at: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = ulid();
    }
  }
}
