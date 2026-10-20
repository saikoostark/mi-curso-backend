import { ApiProperty } from '@nestjs/swagger';

/** Public catalog entry exposed by `GET /attributes`. */
export class AttributeViewDto {
  @ApiProperty({ example: 'users:read' })
  key: string;

  @ApiProperty({ example: 'View user accounts and their profiles.' })
  description: string;
}

/** Payload of `GET /attributes`. */
export class AttributeListDataDto {
  @ApiProperty({ type: [AttributeViewDto] })
  attributes: AttributeViewDto[];
}

/** Success envelope for the attribute catalog. */
export class AttributeListResponseDto {
  @ApiProperty({ example: true })
  success: true;

  @ApiProperty({ type: AttributeListDataDto })
  data: AttributeListDataDto;
}
