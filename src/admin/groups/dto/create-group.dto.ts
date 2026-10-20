import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/** Trims group names/descriptions; case is preserved for display. */
const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Payload for `POST /groups`. */
export class CreateGroupDto {
  @Transform(trim)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9 _.-]{1,49}$/, {
    message:
      'Name must be 2-50 characters long, start with a letter or digit and use only letters, digits, spaces, "_", "-" or "."',
  })
  name: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  description?: string;
}
