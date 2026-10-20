import { ApiProperty } from '@nestjs/swagger';

/** Payload of endpoints that only report a success message. */
export class MessageDataDto {
  @ApiProperty({ example: 'User deleted.' })
  message: string;
}

/** Success envelope for message-only endpoints. */
export class MessageResponseDto {
  @ApiProperty({ example: true })
  success: true;

  @ApiProperty({ type: MessageDataDto })
  data: MessageDataDto;
}
