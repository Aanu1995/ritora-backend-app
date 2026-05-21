import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ulid } from 'ulid';
import { encryptedNullableStringFieldTransformer } from '../../skin-profile/skin-profile-field-encryption';

export enum AdminOperationalIncidentStatus {
  Open = 'open',
  Resolved = 'resolved',
}

export enum AdminOperationalIncidentSeverity {
  Warning = 'warning',
  Critical = 'critical',
}

const encryptedIncidentDescriptionTransformer =
  encryptedNullableStringFieldTransformer(
    'admin_operational_incidents.description',
  );

const encryptedIncidentResolutionTransformer =
  encryptedNullableStringFieldTransformer(
    'admin_operational_incidents.resolution_summary',
  );

@Entity('admin_operational_incidents')
@Index('idx_admin_operational_incidents_status_created', [
  'status',
  'created_at',
  'id',
])
@Index('idx_admin_operational_incidents_source', ['source_type', 'source_id'])
@Index('idx_admin_operational_incidents_target_user', ['target_user_id'])
export class AdminOperationalIncident {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 160 })
  title: string;

  @Column({
    type: 'text',
    transformer: encryptedIncidentDescriptionTransformer,
  })
  description: string;

  @Column({
    type: 'enum',
    enum: AdminOperationalIncidentStatus,
    enumName: 'admin_operational_incident_status',
    default: AdminOperationalIncidentStatus.Open,
  })
  status: AdminOperationalIncidentStatus;

  @Column({
    type: 'enum',
    enum: AdminOperationalIncidentSeverity,
    enumName: 'admin_operational_incident_severity',
  })
  severity: AdminOperationalIncidentSeverity;

  @Column({ type: 'varchar', length: 80 })
  source_type: string;

  @Column({ type: 'varchar', length: 120 })
  source_id: string;

  @Column({ type: 'varchar', length: 26, nullable: true })
  target_user_id: string | null;

  @Column({ type: 'varchar', length: 26 })
  created_by_admin_id: string;

  @Column({ type: 'varchar', length: 26, nullable: true })
  resolved_by_admin_id: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  resolved_at: Date | null;

  @Column({
    type: 'text',
    nullable: true,
    transformer: encryptedIncidentResolutionTransformer,
  })
  resolution_summary: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = ulid();
    }
  }
}
