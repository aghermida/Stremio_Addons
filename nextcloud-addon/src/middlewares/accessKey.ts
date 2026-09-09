import { timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';

/**
 * Gates every route behind a shared secret path segment, since manifest/catalog/meta/stream
 * otherwise accept an attacker-supplied WebDAV url+credentials with no restriction — an open
 * relay (and SSRF vector into the host's local network) for anyone who finds the subdomain.
 */
export function requireAccessKey(
  req: Request<{ accessKey?: string }>,
  res: Response,
  next: NextFunction
): void {
  const provided = Buffer.from(req.params.accessKey ?? '');
  const expected = Buffer.from(config.accessKey);
  const valid =
    provided.length === expected.length && timingSafeEqual(provided, expected);
  if (!valid) {
    res.status(404).end();
    return;
  }
  next();
}
