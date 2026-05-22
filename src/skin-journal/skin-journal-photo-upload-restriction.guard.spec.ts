import { ExecutionContext } from '@nestjs/common';
import { PlatformGlobalRestrictionCapability } from '../platform-controls/platform-global-restrictions';
import { PlatformGlobalRestrictionsService } from '../platform-controls/platform-global-restrictions.service';
import { UserRestrictionEnforcementService } from '../users/user-restriction-enforcement.service';
import { UserRestrictionCapability } from '../users/user-restrictions';
import { SkinJournalPhotoUploadRestrictionGuard } from './skin-journal-photo-upload-restriction.guard';

function contextWithRequest(request: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('SkinJournalPhotoUploadRestrictionGuard', () => {
  it('skips restriction lookups for JSON journal updates', async () => {
    const restrictions = {
      assertAllAllowed: jest.fn(),
      assertAllAllowedForUser: jest.fn(),
    } as unknown as UserRestrictionEnforcementService;
    const platformRestrictions = {
      assertAllAllowed: jest.fn(),
    } as unknown as PlatformGlobalRestrictionsService;
    const guard = new SkinJournalPhotoUploadRestrictionGuard(
      restrictions,
      platformRestrictions,
    );

    await expect(
      guard.canActivate(
        contextWithRequest({
          get: (header: string) =>
            header.toLowerCase() === 'content-type'
              ? 'application/json'
              : undefined,
          user: { id: 'user-1' },
        }),
      ),
    ).resolves.toBe(true);

    expect(platformRestrictions.assertAllAllowed).not.toHaveBeenCalled();
    expect(restrictions.assertAllAllowed).not.toHaveBeenCalled();
  });

  it('checks platform and user restrictions before multipart journal uploads', async () => {
    const restrictions = {
      assertAllAllowed: jest.fn(),
      assertAllAllowedForUser: jest.fn(),
    } as unknown as UserRestrictionEnforcementService;
    const platformRestrictions = {
      assertAllAllowed: jest.fn().mockResolvedValue(undefined),
    } as unknown as PlatformGlobalRestrictionsService;
    const guard = new SkinJournalPhotoUploadRestrictionGuard(
      restrictions,
      platformRestrictions,
    );

    await expect(
      guard.canActivate(
        contextWithRequest({
          get: (header: string) =>
            header.toLowerCase() === 'content-type'
              ? 'multipart/form-data; boundary=ritora'
              : undefined,
          user: { id: 'user-1' },
        }),
      ),
    ).resolves.toBe(true);

    expect(platformRestrictions.assertAllAllowed).toHaveBeenCalledWith([
      PlatformGlobalRestrictionCapability.DisableImageUpload,
      PlatformGlobalRestrictionCapability.DisableAiGeneration,
    ]);
    expect(restrictions.assertAllAllowed).toHaveBeenCalledWith('user-1', [
      UserRestrictionCapability.DisableImageUpload,
      UserRestrictionCapability.DisableAiGeneration,
    ]);
  });

  it('uses the authenticated user restriction snapshot when present', async () => {
    const restrictions = {
      assertAllAllowed: jest.fn(),
      assertAllAllowedForUser: jest.fn(),
    } as unknown as UserRestrictionEnforcementService;
    const platformRestrictions = {
      assertAllAllowed: jest.fn().mockResolvedValue(undefined),
    } as unknown as PlatformGlobalRestrictionsService;
    const guard = new SkinJournalPhotoUploadRestrictionGuard(
      restrictions,
      platformRestrictions,
    );
    const user = {
      account_restricted_at: null,
      account_restriction_capabilities: null,
      account_restriction_expires_at: null,
      id: 'user-1',
    };

    await expect(
      guard.canActivate(
        contextWithRequest({
          get: (header: string) =>
            header.toLowerCase() === 'content-type'
              ? 'multipart/form-data; boundary=ritora'
              : undefined,
          user,
        }),
      ),
    ).resolves.toBe(true);

    expect(restrictions.assertAllAllowedForUser).toHaveBeenCalledWith(user, [
      UserRestrictionCapability.DisableImageUpload,
      UserRestrictionCapability.DisableAiGeneration,
    ]);
    expect(restrictions.assertAllAllowed).not.toHaveBeenCalled();
  });
});
