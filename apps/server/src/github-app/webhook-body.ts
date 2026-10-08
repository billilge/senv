import type { NextFunction, Request, Response } from 'express';

export const WEBHOOK_PATH = '/api/v1/github/webhook';
/** 커밋이 많은 push는 본문이 수 MB가 된다. 다른 API의 JSON 한도와 따로 둔다 (결정 76) */
const WEBHOOK_BODY_LIMIT = 5 * 1024 * 1024;

/**
 * 웹훅 서명은 받은 바이트 그대로 확인해야 해서, 웹훅 경로만 본문을 Buffer로 읽어 req.body에 둔다.
 * 본문을 다 읽었으므로 뒤의 JSON 파서는 이 요청을 건너뛴다.
 */
export function readWebhookBody(request: Request, response: Response, next: NextFunction): void {
  const chunks: Buffer[] = [];
  let size = 0;
  request.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size <= WEBHOOK_BODY_LIMIT) chunks.push(chunk);
  });
  request.on('end', () => {
    if (size > WEBHOOK_BODY_LIMIT) {
      response
        .status(413)
        .json({ code: 'payload_too_large', message: '웹훅 본문은 5MB까지 받습니다' });
      return;
    }
    request.body = Buffer.concat(chunks);
    next();
  });
  request.on('error', next);
}
