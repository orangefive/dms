import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { Prisma } from '@prisma/client';
import { AppError } from '../errors/app-error';
import { ErrorCode, ErrorCodes } from '../enums/error-codes';

interface ErrorBody {
  success: false;
  error: { code: string; message: string; details?: unknown };
}

/**
 * 全局异常过滤器：所有错误统一为
 * { success: false, error: { code, message } }
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const body = this.toErrorBody(exception);
    let status: number;
    if (exception instanceof HttpException) {
      status = exception.getStatus();
    } else if (exception instanceof AppError) {
      status = exception.status;
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
    }
    response.status(status).json(body);
  }

  private toErrorBody(exception: unknown): ErrorBody {
    // 业务错误
    if (exception instanceof AppError) {
      return {
        success: false,
        error: { code: exception.code, message: exception.message, details: exception.details },
      };
    }

    // Nest / class-validator HTTP 异常
    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      let message = exception.message;
      let details: unknown;
      if (typeof res === 'object' && res !== null) {
        const r = res as { message?: unknown; error?: string };
        if (Array.isArray(r.message)) {
          message = r.message.join('；');
        } else if (typeof r.message === 'string') {
          message = r.message;
        }
        details = r.message;
      }
      let code: ErrorCode = ErrorCodes.INTERNAL_ERROR;
      switch (exception.getStatus()) {
        case HttpStatus.BAD_REQUEST:
          code = ErrorCodes.VALIDATION_ERROR;
          break;
        case HttpStatus.UNAUTHORIZED:
          code = ErrorCodes.UNAUTHORIZED;
          break;
        case HttpStatus.FORBIDDEN:
          code = ErrorCodes.FORBIDDEN;
          break;
        case HttpStatus.NOT_FOUND:
          code = ErrorCodes.NOT_FOUND;
          break;
        case HttpStatus.TOO_MANY_REQUESTS:
          code = ErrorCodes.RATE_LIMITED;
          break;
        default:
          break;
      }
      return { success: false, error: { code, message, details } };
    }

    // Prisma 已知错误
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        return {
          success: false,
          error: {
            code: ErrorCodes.DUPLICATE_UNIQUE_FIELD,
            message: '唯一约束冲突：相同值的记录已存在',
            details: exception.meta,
          },
        };
      }
      if (exception.code === 'P2025') {
        return {
          success: false,
          error: { code: ErrorCodes.NOT_FOUND, message: '目标记录不存在或已被删除' },
        };
      }
      return {
        success: false,
        error: {
          code: ErrorCodes.INTERNAL_ERROR,
          message: `数据库操作失败（${exception.code}）`,
        },
      };
    }

    // 未知错误
    const message = exception instanceof Error ? exception.message : '未知错误';
    this.logger.error(`未捕获异常: ${message}`, exception instanceof Error ? exception.stack : '');
    return {
      success: false,
      error: {
        code: ErrorCodes.INTERNAL_ERROR,
        message: process.env.NODE_ENV === 'production' ? '服务器内部错误' : message,
      },
    };
  }
}
