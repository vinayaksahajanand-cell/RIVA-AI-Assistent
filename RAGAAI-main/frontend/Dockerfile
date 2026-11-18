# syntax=docker/dockerfile:1
# RIVA AI frontend — multi-stage build producing a Next.js standalone server on port 3000.
#
#   docker build --build-arg NEXT_PUBLIC_API_URL=http://localhost:8100 -t riva-frontend .
#   docker run -p 3000:3000 riva-frontend
#
# NEXT_PUBLIC_API_URL is inlined into the browser bundle at BUILD time, so it must be the
# backend URL as reachable from the user's browser (not a Docker-internal hostname).

ARG NODE_IMAGE=node:24-alpine

# ---- deps: install exact dependencies from the lockfile -------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---- builder: compile the standalone production build ---------------------------------
FROM ${NODE_IMAGE} AS builder
WORKDIR /app
ARG NEXT_PUBLIC_API_URL=http://localhost:8100
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- runner: minimal runtime image ------------------------------------------------------
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 --ingroup nodejs nextjs
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/login >/dev/null 2>&1 || exit 1
CMD ["node", "server.js"]
