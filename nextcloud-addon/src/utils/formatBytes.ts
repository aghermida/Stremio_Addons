/** Copied verbatim from packages/core/src/formatters/utils.ts. */
export function formatBytes(
  bytes: number,
  k: 1024 | 1000,
  round: boolean = false
): string {
  if (bytes === 0) return '0 B';
  const sizes =
    k === 1024
      ? ['B', 'KiB', 'MiB', 'GiB', 'TiB']
      : ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  let value = parseFloat((bytes / Math.pow(k, i)).toFixed(2));
  if (round) {
    value = Math.round(value);
  }
  return value + ' ' + sizes[i];
}
