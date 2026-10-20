import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { RegisterDto } from '../../identity/auth/registration/dto/register.dto.js';
import { validatePasswordPolicy } from '../../identity/password/password-policy.js';
import { PasswordService } from '../../identity/password/password.service.js';
import { UserProfile } from '../../identity/users/user-profile.entity.js';
import { UserProfilesService } from '../../identity/users/user-profiles.service.js';
import { UserProvisioningService } from '../../identity/users/user-provisioning.service.js';
import { User } from '../../identity/users/user.entity.js';
import { UsersService } from '../../identity/users/users.service.js';
import { DatabaseModule } from '../database.module.js';
import { promptHidden, promptVisible } from './prompt.js';

/**
 * Minimal application context for the CLI: config + database + the users part,
 * without the HTTP stack, cache, email or the rest of the identity module (a
 * superuser can be bootstrapped before any of that is configured).
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    TypeOrmModule.forFeature([User, UserProfile]),
  ],
  providers: [
    PasswordService,
    UserProfilesService,
    UserProvisioningService,
    UsersService,
  ],
})
class CreateSuperuserModule {}

/**
 * Interactive superuser bootstrap, Django-style:
 * `npm run create-superuser` asks for username, email and password (with
 * confirmation), validates everything against the same rules as registration,
 * and creates a verified account with the superuser flag.
 *
 * Nothing here reads secrets from env — the operator types the credentials.
 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(
    CreateSuperuserModule,
    { logger: ['error', 'warn'] },
  );

  try {
    const users = app.get(UsersService);
    const passwords = app.get(PasswordService);
    const provisioning = app.get(UserProvisioningService);

    const username = await promptVisible('Username: ');
    const email = await promptVisible('Email: ');
    const password = await promptHidden('Password: ');
    const passwordConfirm = await promptHidden('Password (again): ');

    const dto = plainToInstance(RegisterDto, {
      username,
      email,
      password,
      passwordConfirm,
    });

    const validationErrors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    const problems = formatValidationErrors(validationErrors);

    if (dto.password !== dto.passwordConfirm) {
      problems.push('Passwords do not match.');
    }

    problems.push(
      ...validatePasswordPolicy(dto.password, {
        email: dto.email,
        username: dto.username,
      }),
    );

    if (await users.existsByEmail(dto.email)) {
      problems.push('That email is already registered.');
    }

    if (await users.existsByUsername(dto.username)) {
      problems.push('That username is already taken.');
    }

    if (problems.length > 0) {
      for (const problem of problems) {
        console.error(`Error: ${problem}`);
      }
      process.exitCode = 1;
      return;
    }

    const passwordHash = await passwords.hash(dto.password);
    await provisioning.createSuperuser({
      email: dto.email,
      username: dto.username,
      passwordHash,
    });

    console.log(`Superuser "${dto.username}" created.`);
  } finally {
    await app.close();
  }
}

/**
 * Flattens class-validator errors into human-readable messages.
 *
 * @param errors - Errors returned by `validate()`.
 * @returns One message per failed constraint.
 */
function formatValidationErrors(errors: ValidationError[]): string[] {
  return errors.flatMap((error) => Object.values(error.constraints ?? {}));
}

await main();
