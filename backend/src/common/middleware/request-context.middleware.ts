import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { requestContextStorage } from '../request-context';

/** 采集 IP / User-Agent / requestId 到 AsyncLocalStorage */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const ip = req.ip ?? req.socket?.remoteAddress;
    const userAgent = req.headers['user-agent'];
    const data = {
      ip: typeof ip === 'string' ? ip.slice(0, 64) : undefined,
      userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 512) : undefined,
      requestId: randomUUID(),
    };
    res.setHeader('X-Request-Id', data.requestId);
    requestContextStorage.run(data, () => next());
  }
}
