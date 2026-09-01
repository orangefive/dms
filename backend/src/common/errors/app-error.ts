import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../enums/error-codes';

/**
 * 业务异常：携带统一错误码，由全局异常过滤器转换为统一响应格式。
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, status = HttpStatus.BAD_REQUEST, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  static badRequest(code: ErrorCode, message: string, details?: unknown): AppError {
    return new AppError(code, message, HttpStatus.BAD_REQUEST, details);
  }

  static unauthorized(code: ErrorCode, message: string): AppError {
    return new AppError(code, message, HttpStatus.UNAUTHORIZED);
  }

  static forbidden(code: ErrorCode, message: string): AppError {
    return new AppError(code, message, HttpStatus.FORBIDDEN);
  }

  static notFound(code: ErrorCode, message: string): AppError {
    return new AppError(code, message, HttpStatus.NOT_FOUND);
  }
}
