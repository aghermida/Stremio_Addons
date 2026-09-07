function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT) || 8000,
  secret: required('NEXTCLOUD_ADDON_SECRET'),
  baseUrl: required('NEXTCLOUD_ADDON_BASE_URL').replace(/\/$/, ''),
};
