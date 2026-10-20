import { ApiProperty } from '@nestjs/swagger';
import { AuditLogView } from '../../../audit/audit-log.view.js';
import { PaginationMeta } from '../../../common/http/pagination.js';

/** Payload of `GET /audit-logs`. */
export class AuditLogListDataDto {
  @ApiProperty({ type: [AuditLogView] })
  page: AuditLogView[];

  @ApiProperty({ type: PaginationMeta })
  pagination: PaginationMeta;
}

/** Success envelope for an audit page. */
export class AuditLogListResponseDto {
  @ApiProperty({ example: true })
  success: true;

  @ApiProperty({ type: AuditLogListDataDto })
  data: AuditLogListDataDto;
}
