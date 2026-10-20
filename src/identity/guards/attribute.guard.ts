import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ATTRIBUTE_ERRORS } from '../attributes/attributes.error-codes.js';
import { AttributesService } from '../attributes/attributes.service.js';
import type { AuthenticatedUser } from '../decorators/current-user.decorator.js';
import { TOKEN_ERRORS } from '../token/token.error-codes.js';

/**
 * Base class of the named capability guards (`CanReadUsers`,
 * `CanManageGroupMembers`, ...).
 *
 * A guard may only answer questions that the request itself contains: who the
 * caller is (`JwtAuthGuard` authenticates) and whether the caller is eligible
 * to enter this route — holding every concrete attribute the capability
 * requires, or being a superuser, who is eligible for everything. State that
 * lives in other objects (the target user's flags, balances, timing, ...) can
 * never be checked here; those rules are policies called inside the flow.
 *
 * Concrete subclasses must declare an explicit constructor that forwards to
 * `super(attributes)`: TypeScript only emits DI metadata for a declared
 * constructor, so an inherited one would resolve to zero dependencies.
 */
export abstract class AttributeGuard implements CanActivate {
  /** Concrete `module:action` keys this capability requires. */
  protected abstract readonly attributeKeys: readonly string[];

  constructor(private readonly attributes: AttributesService) {}

  /**
   * @param context - Execution context of the incoming request.
   * @returns `true` when the caller holds every required attribute.
   * @throws UnauthorizedException when no actor is attached (fail closed).
   * @throws ForbiddenException when a required attribute is missing.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();

    const actor = request.user;
    if (!actor) {
      throw new UnauthorizedException({
        code: TOKEN_ERRORS.missingToken,
        message: 'Authentication required.',
      });
    }

    // Superusers are eligible for everything.
    if (actor.isSuperuser) {
      return true;
    }

    const required = [...this.attributeKeys];
    if (!(await this.attributes.hasAll(actor.id, required))) {
      throw new ForbiddenException({
        code: ATTRIBUTE_ERRORS.insufficientAttributes,
        message: 'You do not have the required attributes.',
        required,
      });
    }

    return true;
  }
}
