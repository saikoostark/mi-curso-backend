import type { AuthTokenService } from '../token/auth-token.service.js';
import type { AuthMailerService } from './auth-mailer.service.js';
import { PasswordResetService } from './password-reset.service.js';

describe('PasswordResetService', () => {
  it('issues a reset token and mails the link to the account address', async () => {
    const issue = vi.fn().mockResolvedValue('reset-token');
    const sendResetEmail = vi.fn().mockResolvedValue(undefined);
    const service = new PasswordResetService(
      { issue } as unknown as AuthTokenService,
      { sendResetEmail } as unknown as AuthMailerService,
    );

    await service.sendResetLink('user-1', 'jane@example.com');

    expect(issue).toHaveBeenCalledWith(
      'user-1',
      'password_reset',
      expect.any(Number),
    );
    expect(sendResetEmail).toHaveBeenCalledWith(
      'jane@example.com',
      'reset-token',
    );
  });
});
