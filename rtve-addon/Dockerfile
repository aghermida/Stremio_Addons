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
