import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';

@Catch(HttpException)
export class KnownFacesFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const status = exception.getStatus();
    const body = exception.getResponse();
    if (typeof body === 'object' && 'error' in body && typeof body.error === 'object') {
      host.switchToHttp().getResponse<Response>().status(status).json(body);
      return;
    }
    const code = status === 413 ? 'IMAGE_TOO_LARGE' : 'INVALID_IMAGE';
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(status)
      .json({
        error: {
          code,
          message:
            status === 413 ? 'Ảnh vượt giới hạn dung lượng.' : 'Dữ liệu đăng ký không hợp lệ.',
          traceId: randomUUID(),
        },
      });
  }
}
