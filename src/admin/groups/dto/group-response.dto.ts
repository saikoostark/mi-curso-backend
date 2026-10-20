import { ApiProperty } from '@nestjs/swagger';

/** Public representation of a group. */
export class GroupViewDto {
  @ApiProperty({
    format: 'uuid',
    example: '6f1a1e2a-2a5b-4f0e-9f1a-2a5b4f0e9f1a',
  })
  id: string;

  @ApiProperty({ example: 'Moderators' })
  name: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'The moderation team.',
  })
  description: string | null;

  @ApiProperty({
    type: [String],
    example: ['users:read', 'groups:read'],
    description: 'Attribute keys attached to the group.',
  })
  attributes: string[];
}

/** Public representation of a group including its member ids. */
export class GroupDetailDto extends GroupViewDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    description: 'Ids of the users that belong to the group.',
  })
  members: string[];
}

/** Payload of `GET /groups`. */
export class GroupListDataDto {
  @ApiProperty({ type: [GroupViewDto] })
  groups: GroupViewDto[];
}

/** Success envelope for a group list. */
export class GroupListResponseDto {
  @ApiProperty({ example: true })
  success: true;

  @ApiProperty({ type: GroupListDataDto })
  data: GroupListDataDto;
}

/** Success envelope for a single group. */
export class GroupResponseDto {
  @ApiProperty({ example: true })
  success: true;

  @ApiProperty({ type: GroupViewDto })
  data: GroupViewDto;
}

/** Success envelope for a group with members. */
export class GroupDetailResponseDto {
  @ApiProperty({ example: true })
  success: true;

  @ApiProperty({ type: GroupDetailDto })
  data: GroupDetailDto;
}

/** Payload of attach/detach responses. */
export class GroupAttributesDataDto {
  @ApiProperty({ type: [String], example: ['users:read'] })
  attributes: string[];
}

/** Success envelope for attach/detach responses. */
export class GroupAttributesResponseDto {
  @ApiProperty({ example: true })
  success: true;

  @ApiProperty({ type: GroupAttributesDataDto })
  data: GroupAttributesDataDto;
}
