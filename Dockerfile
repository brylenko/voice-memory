# ---- build stage: full deps + tsc ----
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime stage: prod deps + compiled JS only ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY public ./public

# Used by the local storage driver; irrelevant (but harmless) when STORAGE_DRIVER=s3.
RUN mkdir -p /app/uploads

EXPOSE 3000

# Run pending TypeORM migrations, then start the server. If migrations fail,
# the container exits non-zero instead of serving against a stale schema.
CMD ["sh", "-c", "node dist/scripts/run-migrations.js && node dist/main.js"]
