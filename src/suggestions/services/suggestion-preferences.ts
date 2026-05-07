import { Repository } from 'typeorm';
import { UserNotificationPreference } from '../../notifications/entities/user-notification-preference.entity';
import { SUGGESTION_LEAD_TIME_DEFAULT_MINUTES } from '../suggestions.constants';
import { clampLeadTimeMinutes } from './suggestion-helpers';

export async function resolveSuggestionLeadTimeMinutes(
  preferenceRepo: Repository<UserNotificationPreference>,
  userId: string,
): Promise<number> {
  const prefs = await preferenceRepo.findOne({
    where: { user_id: userId },
  });
  return clampLeadTimeMinutes(
    prefs?.suggestion_lead_time_minutes,
    SUGGESTION_LEAD_TIME_DEFAULT_MINUTES,
  );
}
