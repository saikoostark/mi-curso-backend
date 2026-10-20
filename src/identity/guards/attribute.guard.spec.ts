import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { ATTRIBUTE_ERRORS } from '../attributes/attributes.error-codes.js';
import type { AttributesService } from '../attributes/attributes.service.js';
import { TOKEN_ERRORS } from '../token/token.error-codes.js';
import { AttributeGuard } from './attribute.guard.js';

/**
 * Stub capability guard: the same shape as every named guard (one concrete
 * key, explicit constructor forwarding to `super(attributes)`). Keeping the
 * stub local makes the base's spec independent of any admin module.
 */
class CanReadThings extends AttributeGuard {
  protected readonly attributeKeys = ['things:read'];

  constructor(attributes: AttributesService) {
    super(attributes);
  }
}

/** Request shape used by the guard. */
interface GuardRequest {
  user?: { id: string; isSuperuser: boolean };
}

/** Minimal ExecutionContext wrapping a fake request. */
function contextFor(request: GuardRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

/** Runs the guard and returns the HTTP error, failing when it resolves. */
async function httpError(run: () => Promise<unknown>): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  try {
    await run();
  } catch (error) {
    const status =
      error instanceof ForbiddenException
        ? 403
        : error instanceof UnauthorizedException
          ? 401
          : -1;
    return {
      status,
      body: (error as { getResponse(): Record<string, unknown> }).getResponse(),
    };
  }

  throw new Error('Expected an HttpException');
}

describe('AttributeGuard', () => {
  let hasAll: ReturnType<typeof vi.fn>;
  let guard: CanReadThings;

  beforeEach(() => {
    hasAll = vi.fn();

    guard = new CanReadThings({ hasAll } as unknown as AttributesService);
  });

  it('fails closed when no actor is attached', async () => {
    const error = await httpError(() => guard.canActivate(contextFor({})));

    expect(error.status).toBe(401);
    expect(error.body.code).toBe(TOKEN_ERRORS.missingToken);
    expect(hasAll).not.toHaveBeenCalled();
  });

  it('lets superusers pass without an attribute lookup', async () => {
    await expect(
      guard.canActivate(
        contextFor({ user: { id: 'root', isSuperuser: true } }),
      ),
    ).resolves.toBe(true);
    expect(hasAll).not.toHaveBeenCalled();
  });

  it('passes when the actor holds the required key', async () => {
    hasAll.mockResolvedValue(true);

    await expect(
      guard.canActivate(contextFor({ user: { id: 'u', isSuperuser: false } })),
    ).resolves.toBe(true);
    expect(hasAll).toHaveBeenCalledWith('u', ['things:read']);
  });

  it('reports 403 with the required key when it is missing', async () => {
    hasAll.mockResolvedValue(false);

    const error = await httpError(() =>
      guard.canActivate(contextFor({ user: { id: 'u', isSuperuser: false } })),
    );

    expect(error.status).toBe(403);
    expect(error.body.code).toBe(ATTRIBUTE_ERRORS.insufficientAttributes);
    expect(error.body.required).toEqual(['things:read']);
  });
});
