# syntax=docker/dockerfile:1.7-labs
# End-to-end tests in Linux with a virtual display (xvfb), so a run opens no
# window on the desktop. Build and run with `pnpm test:e2e:docker` from the
# repo root (scripts/e2e-docker.mjs). See openspec/docs/testing.md.
FROM node:24-bookworm

# xvfb and the libraries that Electron (Obsidian) needs.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		xvfb xauth fonts-liberation \
		libgtk-3-0 libnss3 libxss1 libasound2 libgbm1 libxshmfence1 libdrm2 \
		libnotify4 libsecret-1-0 libatk-bridge2.0-0 libcups2 libxkbcommon0 \
		libxcomposite1 libxdamage1 libxrandr2 libpango-1.0-0 libcairo2 xdg-utils \
	&& rm -rf /var/lib/apt/lists/*

# The same pnpm version as `packageManager` in package.json.
RUN npm install -g pnpm@12.15.0

WORKDIR /repo
RUN chown node:node /repo
USER node

# Install layer: only the manifests, so a source change does not reinstall.
COPY --chown=node:node --parents package.json pnpm-lock.yaml pnpm-workspace.yaml packages/*/package.json adapters/*/package.json ./
RUN pnpm install --frozen-lockfile

# Source layer.
COPY --chown=node:node . .
# The Obsidian downloads go to a named volume (see scripts/e2e-docker.mjs).
RUN mkdir -p packages/e2e/.obsidian-cache

CMD ["xvfb-run", "-a", "--server-args=-screen 0 1280x1024x24", "pnpm", "test:e2e"]
