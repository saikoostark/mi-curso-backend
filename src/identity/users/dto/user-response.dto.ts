import { ApiProperty } from '@nestjs/swagger';
import { PaginationMeta } from '../../../common/http/pagination.js';
import { UserView } from '../user.view.js';

/** Paged list payload for `GET /users`. */
export class UserListDataDto {
  @ApiProperty({
    type: [UserView],
    description: 'Users on the current page.',
  })
  page: UserView[];

  @ApiProperty({
    type: () => PaginationMeta,
    description: 'Pagination metadata for the page.',
  })
  pagination: PaginationMeta;
}

/** Success envelope for a paged user list. */
export class UserListResponseDto {
  @ApiProperty({ example: true })
  success: true;

  @ApiProperty({ type: UserListDataDto })
  data: UserListDataDto;
}

/** Success envelope for a single user. */
export class UserResponseDto {
  @ApiProperty({ example: true })
  success: true;

  @ApiProperty({ type: UserView })
  data: UserView;
}
