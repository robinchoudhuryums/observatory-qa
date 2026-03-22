# ============================================================
# Observatory QA — Multi-stage Dockerfile
# ============================================================
# Stage 1: Build (includes devDependencies for TypeScript/Vite)
# Stage 2: Production (minimal runtime image with tini init)
# ============================================================

# --- Build Stage ---
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files first for layer caching
COPY package.json package-lock.json ./

# Install all dependencies (including dev for build tools)
RUN npm ci

# Copy source code
COPY . .

# Build frontend (Vite) + backend (esbuild)
RUN npm run build

# Prune dev dependencies
RUN npm prune --production

# --- Production Stage ---
FROM node:20-slim AS production

# Install tini for proper PID 1 signal forwarding (graceful shutdown)
RUN apt-get update && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*

# Security: run as non-root user
RUN groupadd --system appuser && useradd --system --gid appuser appuser

WORKDIR /app

# Copy only what's needed for production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/data ./data

# Create uploads directory (for temporary file processing)
RUN mkdir -p /app/uploads && chown -R appuser:appuser /app

# OCI image labels
LABEL org.opencontainers.image.title="Observatory QA"
LABEL org.opencontainers.image.description="AI-Powered Call Quality Analysis Platform"
LABEL org.opencontainers.image.vendor="Observatory QA"
LABEL org.opencontainers.image.source="https://github.com/robinchoudhuryums/observatory-qa"

# Environment defaults
ENV NODE_ENV=production
ENV PORT=5000

# Health check — verifies the app responds on the readiness endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "const http = require('http'); const req = http.get('http://localhost:${PORT}/api/health/ready', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }); req.on('error', () => process.exit(1)); req.end();"

# Switch to non-root user
USER appuser

EXPOSE 5000

# Use tini as PID 1 — ensures SIGTERM is properly forwarded to Node.js
ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/index.js"]
