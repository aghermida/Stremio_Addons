# Standalone image for the Nextcloud Stremio addon. Built and published
# independently of the main AIOStreams image/workflow — see
# .github/workflows/nextcloud-addon-docker.yml. This package has zero
# dependency on @aiostreams/core or the rest of the monorepo, so its build
# context is just this directory.

FROM node:24-slim AS builder
WORKDIR /build

COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm install --omit=dev

COPY --from=builder /build/dist ./dist

EXPOSE 8000
CMD ["node", "dist/server.js"]
