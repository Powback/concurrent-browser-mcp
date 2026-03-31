# Concurrent Browser MCP Server
# Multi-instance Playwright browser automation via MCP

FROM node:20-bookworm-slim

# Install system deps for Playwright browsers
RUN apt-get update -y && \
    apt-get install -y --no-install-recommends \
    ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 \
    libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgbm1 \
    libgcc1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 \
    libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 \
    libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 \
    libxrandr2 libxrender1 libxtst6 lsb-release wget xdg-utils curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install deps
COPY package.json package-lock.json* ./
RUN npm install --ignore-scripts

# Install Playwright browsers (chromium by default)
RUN npx playwright install chromium
RUN npx playwright install-deps chromium

# Copy source and build
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

# Prune devDependencies
RUN npm prune --omit=dev

# Environment
ENV NODE_ENV=production

# Health check — the MCP server uses stdio, so just check the process is alive
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD pgrep -f "node dist/index.js" || exit 1

# Run with configurable args (override via docker-compose command)
CMD ["node", "dist/index.js", "--max-instances", "25", "--headless", "true"]
