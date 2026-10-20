import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiStandardErrors } from '../../common/http/api-standard-errors.decorator.js';
import { AttributesService } from '../../identity/attributes/attributes.service.js';
import type { AttributeView } from '../../identity/attributes/attributes.service.js';
import { JwtAuthGuard } from '../../identity/guards/jwt-auth.guard.js';
import { AttributeListResponseDto } from './dto/attribute-response.dto.js';

/**
 * The attribute catalog (`/attributes`).
 *
 * Any authenticated user may read the list of known keys (it is not secret);
 * grants themselves are managed through `/users/:id/attributes/:key` and
 * `/groups/:id/attributes/:key`. The catalog lives on the management surface
 * because that is where attributes are administered; the engine stays in
 * identity.
 */
@ApiTags('Attributes')
@ApiBearerAuth('access-token')
@ApiStandardErrors()
@Controller('attributes')
@UseGuards(JwtAuthGuard)
export class AttributesController {
  constructor(private readonly attributes: AttributesService) {}

  /**
   * `GET /attributes` — the non-deprecated catalog, key order.
   */
  @Get()
  @ApiOperation({ summary: 'List the attribute catalog' })
  @ApiOkResponse({ type: AttributeListResponseDto })
  async list(): Promise<{ attributes: AttributeView[] }> {
    return { attributes: await this.attributes.listCatalog() };
  }
}
