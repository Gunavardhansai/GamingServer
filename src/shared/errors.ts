export interface ErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: unknown;

  public constructor(
    code: string,
    message: string,
    statusCode = 400,
    details?: unknown
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function toErrorPayload(error: unknown): ErrorPayload {
  if (isAppError(error)) {
    return {
      code: error.code,
      message: error.message,
      details: error.details
    };
  }

  if (error instanceof Error) {
    return {
      code: "INTERNAL_SERVER_ERROR",
      message: error.message
    };
  }

  return {
    code: "INTERNAL_SERVER_ERROR",
    message: "Unexpected server error"
  };
}
