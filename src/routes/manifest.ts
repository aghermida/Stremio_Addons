import { Router, Request, Response, NextFunction } from 'express';
import { NextcloudAddon } from '../nextcloudAddon.js';
import { decodeConfig } from '../utils/decodeConfig.js';

const router: Router = Router();

router.get(
  '{/:encodedConfig}/manifest.json',
  (req: Request<{ encodedConfig?: string }>, res: Response, next: NextFunction) => {
    try {
      const encodedConfig = req.params.encodedConfig;
      const manifest = encodedConfig
        ? new NextcloudAddon(decodeConfig(encodedConfig)).getManifest()
        : NextcloudAddon.getManifest();
      res.json(manifest);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
