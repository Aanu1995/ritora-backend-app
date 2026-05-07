import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ulid } from 'ulid';
import { ScheduleSlot } from '../../schedule/entities/schedule-slot.entity';
import { encryptedJsonFieldTransformer } from '../../skin-profile/skin-profile-field-encryption';
import { User } from '../../users/entities/user.entity';
import { SuggestionContextSummary } from '../suggestion-context.types';
import {
  SuggestionDaypart,
  SuggestionExplanationJson,
  SuggestionGapRecommendationJson,
  SuggestionGenerationStatus,
  SuggestionMode,
  SuggestionRequestContextJson,
  SuggestionRequestSource,
  SuggestionSafetyFlagJson,
} from '../suggestions.constants';
import { SuggestionStep } from './suggestion-step.entity';

export type SuggestionGenerationContext = SuggestionContextSummary;

const ON_DEMAND_REQUEST_ID_INDEX_WHERE = `"request_source" = '${SuggestionRequestSource.OnDemand}' AND "request_id" IS NOT NULL`;

const encryptedExplanationTransformer =
  encryptedJsonFieldTransformer<SuggestionExplanationJson | null>(
    'suggestion_instances.ai_explanation',
    null,
  );
const encryptedGenerationContextTransformer =
  encryptedJsonFieldTransformer<SuggestionGenerationContext | null>(
    'suggestion_instances.generation_context',
    null,
  );
const encryptedGapRecommendationsTransformer = encryptedJsonFieldTransformer<
  SuggestionGapRecommendationJson[] | null
>('suggestion_instances.gap_recommendations', null);
const encryptedSafetyFlagsTransformer = encryptedJsonFieldTransformer<
  SuggestionSafetyFlagJson[] | null
>('suggestion_instances.safety_flags', null);
const encryptedRequestContextTransformer =
  encryptedJsonFieldTransformer<SuggestionRequestContextJson | null>(
    'suggestion_instances.request_context',
    null,
  );

@Entity('suggestion_instances')
@Index('IDX_suggestion_instances_user_target_date', ['user_id', 'target_date'])
@Index('IDX_suggestion_instances_user_visible_at', ['user_id', 'visible_at'])
@Index(
  'UQ_suggestion_instances_on_demand_request_id',
  ['user_id', 'request_id'],
  {
    unique: true,
    where: ON_DEMAND_REQUEST_ID_INDEX_WHERE,
  },
)
export class SuggestionInstance {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  user_id: string;

  @Column({ type: 'varchar', length: 26, nullable: true })
  slot_id: string | null;

  @Column({
    type: 'varchar',
    length: 20,
    default: SuggestionRequestSource.Scheduled,
  })
  request_source: SuggestionRequestSource;

  @Column({ type: 'varchar', length: 80, nullable: true })
  request_id: string | null;

  @Column({
    type: 'jsonb',
    nullable: true,
    transformer: encryptedRequestContextTransformer,
  })
  request_context: SuggestionRequestContextJson | null;

  @Column({ type: 'date' })
  target_date: string;

  @Column({ type: 'time' })
  target_time: string;

  @Column({ type: 'varchar', length: 10 })
  daypart: SuggestionDaypart;

  @Column({ type: 'varchar', length: 20 })
  mode: SuggestionMode;

  @Column({
    type: 'varchar',
    length: 20,
    default: SuggestionGenerationStatus.Pending,
  })
  generation_status: SuggestionGenerationStatus;

  @Column({ type: 'timestamptz' })
  visible_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  generated_at: Date | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  ai_model: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  ai_prompt_version: string | null;

  @Column({ type: 'integer', nullable: true })
  ai_input_tokens: number | null;

  @Column({ type: 'integer', nullable: true })
  ai_output_tokens: number | null;

  @Column({ type: 'integer', nullable: true })
  ai_total_tokens: number | null;

  @Column({ type: 'double precision', nullable: true })
  ai_estimated_cost_usd: number | null;

  @Column({ type: 'integer', nullable: true })
  ai_duration_ms: number | null;

  @Column({
    type: 'jsonb',
    nullable: true,
    transformer: encryptedExplanationTransformer,
  })
  ai_explanation: SuggestionExplanationJson | null;

  @Column({
    type: 'jsonb',
    nullable: true,
    transformer: encryptedGenerationContextTransformer,
  })
  generation_context: SuggestionGenerationContext | null;

  @Column({
    type: 'jsonb',
    nullable: true,
    transformer: encryptedGapRecommendationsTransformer,
  })
  gap_recommendations: SuggestionGapRecommendationJson[] | null;

  @Column({
    type: 'jsonb',
    nullable: true,
    transformer: encryptedSafetyFlagsTransformer,
  })
  safety_flags: SuggestionSafetyFlagJson[] | null;

  @Column({ type: 'boolean', default: false })
  has_reaction_signal: boolean;

  @Column({ type: 'boolean', default: false })
  simplified_for_reaction: boolean;

  @Column({ type: 'varchar', length: 26, nullable: true })
  supersedes_id: string | null;

  @Column({ type: 'text', nullable: true })
  ai_error: string | null;

  @Column({ type: 'integer', default: 0 })
  ai_retry_count: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => ScheduleSlot, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'slot_id' })
  slot: ScheduleSlot | null;

  @OneToMany(() => SuggestionStep, (step) => step.suggestion_instance)
  steps: SuggestionStep[];

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = ulid();
    }
  }
}
