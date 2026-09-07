import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import manifestRouter from './routes/manifest.js';
import metaRouter from './routes/meta.js';
import catalogRouter from './routes/catalog.js';
import streamRouter from './routes/stream.js';
import mediaRouter from './routes/media.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Public by design: Stremio Web fetches manifest/meta/catalog/stream directly
 * from the browser, cross-origin from wherever Stremio Web is served — unlike
 * the desktop/mobile apps, which aren't subject to CORS. So this is always on,
 * not gated behind NODE_ENV like AIOStreams' own dev-only CORS middleware.
 */
function corsMiddleware(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');
  next();
}

export function createApp(): Express {
  const app = express();

  app.use(corsMiddleware);
  app.use(express.static(path.join(__dirname, 'public')));

  app.use('/', manifestRouter);
  app.use('/', metaRouter);
  app.use('/', catalogRouter);
  app.use('/', streamRouter);
  app.use('/media', mediaRouter);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  });

  return app;
}
