import type { NextcloudConfig } from '../nextcloudAddon.js';

export function decodeConfig(encoded: string): NextcloudConfig {
  return JSON.parse(Buffer.from(encoded, 'base64url').toString());
}
