# syntax=docker/dockerfile:1
# Build context la ROOT cua monorepo (xem docker-compose.yml)

# ---------- base ----------
FROM node:22-alpine AS base
RUN corepack enable && apk add --no-cache wget
WORKDIR /workspace

# ---------- deps ----------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/orchestrator/package.json apps/orchestrator/
COPY packages/contracts/package.json packages/contracts/
COPY packages/eslint-config/package.json packages/eslint-config/
RUN pnpm install --frozen-lockfile

# ---------- development ----------
FROM deps AS development
COPY . .
WORKDIR /workspace/apps/orchestrator
EXPOSE 3001
CMD ["pnpm", "dev"]

# ---------- build ----------
FROM deps AS build
COPY . .
RUN pnpm --filter @cam/orchestrator build

# ---------- production ----------
FROM base AS production
ENV NODE_ENV=production
COPY --from=build /workspace/apps/orchestrator/dist ./dist
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/apps/orchestrator/node_modules ./apps/orchestrator/node_modules
EXPOSE 3001
USER node
CMD ["node", "dist/main.js"]
