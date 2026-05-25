import { ScheduleSlot } from '../../schedule/entities/schedule-slot.entity';
import { User } from '../../users/entities/user.entity';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';

export type SuggestionJobSubjects = {
  targetDate: string;
  targetTime: string;
  slot: ScheduleSlot;
  user: User;
};

export type OnDemandSuggestionJobSubjects = {
  targetDate: string;
  targetTime: string;
  suggestion: SuggestionInstance;
  user: User;
};
