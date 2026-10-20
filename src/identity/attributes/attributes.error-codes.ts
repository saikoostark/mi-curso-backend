/**
 * Error codes owned by the authorization domain.
 *
 * Raised by the attribute engine and the capability guards.
 */
export const ATTRIBUTE_ERRORS = {
  insufficientAttributes: 'insufficient_attributes',
  unknownAttribute: 'unknown_attribute',
} as const;

/** Union of the authorization-domain error codes. */
export type AttributeErrorCode =
  (typeof ATTRIBUTE_ERRORS)[keyof typeof ATTRIBUTE_ERRORS];
