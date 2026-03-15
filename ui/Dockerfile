# =============================================================================
# Canton Rebalancer — Frontend Dockerfile
# =============================================================================
# Multi-stage build: compile React + Vite, then serve with Nginx.
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 1: Build
# ---------------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency manifests first (better layer caching)
COPY package.json package-lock.json ./

# Install all dependencies (including devDependencies for vite/tsc)
RUN npm ci

# Copy source and config files
COPY tsconfig.json vite.config.ts postcss.config.js tailwind.config.js ./
COPY index.html ./
COPY src/ ./src/

# Build the production bundle
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2: Serve with Nginx
# ---------------------------------------------------------------------------
FROM nginx:alpine AS runner

# Remove default Nginx content
RUN rm -rf /usr/share/nginx/html/*

# Copy custom Nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets from builder
COPY --from=builder /app/dist /usr/share/nginx/html

# Expose port 80
EXPOSE 80

# Health check
HEALTHCHECK --interval=10s --timeout=5s --retries=3 --start-period=5s \
  CMD wget --no-verbose --tries=1 --spider http://localhost:80/ || exit 1

# Nginx runs as PID 1 by default
CMD ["nginx", "-g", "daemon off;"]
