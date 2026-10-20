import { Injectable } from '@nestjs/common';
import { AUDIT_ATTRIBUTES } from '../../audit/audit.attributes.js';
import { AttributesService } from '../../identity/attributes/attributes.service.js';
import { AttributeGuard } from '../../identity/guards/attribute.guard.js';

/** `audit:read` — read the security audit trail. */
@Injectable()
export class CanReadAuditLogs extends AttributeGuard {
  protected readonly attributeKeys = [AUDIT_ATTRIBUTES.read.key];

  constructor(attributes: AttributesService) {
    super(attributes);
  }
}
