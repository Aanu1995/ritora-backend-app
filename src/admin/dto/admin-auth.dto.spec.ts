import { validate } from 'class-validator';
import { AdminForgotPasswordDto } from './admin-forgot-password.dto';
import { AdminLoginDto } from './admin-login.dto';
import { AdminMfaChallengeDto, AdminMfaEnableDto } from './admin-mfa.dto';
import { AdminResetPasswordDto } from './admin-reset-password.dto';
import { AdminUserRestrictionDto } from './admin-user-restriction.dto';
import { CreateAdminDto } from './create-admin.dto';

describe('admin auth DTOs', () => {
  it('rejects admin passwords longer than the bcrypt-safe limit', async () => {
    const dto = new AdminResetPasswordDto();
    dto.token = 'a'.repeat(64);
    dto.newPassword = `A1${'a'.repeat(71)}`;

    const errors = await validate(dto);

    expect(JSON.stringify(errors)).toContain('validation.password.maxLength');
  });

  it('requires an audit reason when root creates another admin', async () => {
    const dto = new CreateAdminDto();
    dto.email = 'ops@ritora.app';
    dto.name = 'Ops Lead';

    const errors = await validate(dto);

    expect(JSON.stringify(errors)).toContain('validation.reason.required');
  });

  it('rejects long admin login passwords before bcrypt work starts', async () => {
    const dto = new AdminLoginDto();
    dto.email = 'owner@ritora.app';
    dto.password = 'a'.repeat(73);

    const errors = await validate(dto);

    expect(JSON.stringify(errors)).toContain('validation.password.maxLength');
  });

  it('allows MFA login codes and rejects malformed MFA setup codes', async () => {
    const loginDto = new AdminLoginDto();
    loginDto.email = 'owner@ritora.app';
    loginDto.password = 'RootAdmin123!';
    loginDto.mfaCode = 'ABCD-EFGH-IJKL-MNOP';

    await expect(validate(loginDto)).resolves.toEqual([]);

    const enableDto = new AdminMfaEnableDto();
    enableDto.code = 'ABCDEF';

    await expect(validate(enableDto)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'code' })]),
    );

    const challengeDto = new AdminMfaChallengeDto();
    challengeDto.currentPassword = 'RootAdmin123!';
    challengeDto.code = '123456';

    await expect(validate(challengeDto)).resolves.toEqual([]);
  });

  it('rejects oversized admin emails consistently', async () => {
    const forgotPasswordDto = new AdminForgotPasswordDto();
    forgotPasswordDto.email = `${'a'.repeat(250)}@ritora.app`;

    const createAdminDto = new CreateAdminDto();
    createAdminDto.email = forgotPasswordDto.email;
    createAdminDto.name = 'Ops Lead';
    createAdminDto.reason = 'Launch coverage support';

    await expect(validate(forgotPasswordDto)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'email' })]),
    );
    await expect(validate(createAdminDto)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'email' })]),
    );
  });

  it('rejects non-string account restriction reasons', async () => {
    const dto = new AdminUserRestrictionDto();
    dto.reason = 42 as never;

    const errors = await validate(dto);

    expect(JSON.stringify(errors)).toContain('reason must be a string');
  });
});
