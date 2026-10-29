// Stable error codes shared by API, UI and logs (v1.0 §11 error model). Never rename a code.
export const ERROR_CODES = ['ILLEGAL_TRANSITION'] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export class DomainError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string = code) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}
