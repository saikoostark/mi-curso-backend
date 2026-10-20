import { ApiProperty } from '@nestjs/swagger';
import { UserView } from '../../../users/user.view.js';

/** Body of the login/refresh responses. */
export class SessionDataDto {
  @ApiProperty({
    description: 'Short-lived JWT for the `Authorization: Bearer` header.',
  })
  accessToken: string;

  @ApiProperty({ type: UserView })
  user: UserView;
}

/** Success envelope for the login/refresh responses. */
export class SessionResponseDto {
  @ApiProperty({ example: true })
  success: true;

  @ApiProperty({ type: SessionDataDto })
  data: SessionDataDto;
}
