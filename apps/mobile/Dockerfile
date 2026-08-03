# The API/PowerSync URLs are BAKED IN AT BUILD TIME — Expo inlines EXPO_PUBLIC_* into the JS
# bundle, so a container started with different env vars still talks to whatever was compiled
# in. Deploying to a new origin means rebuilding with new build args.
FROM node:22-slim AS build
# See apps/api/Dockerfile for why pnpm is pinned.
RUN corepack enable && corepack prepare pnpm@10.34.4 --activate
WORKDIR /repo

# apps/api's manifest is needed even though the API isn't built here: @workouty/mobile
# devDepends on `@workouty/api: workspace:*`, and apps/api in turn links packages/emails.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/emails/package.json packages/emails/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/mobile/package.json apps/mobile/package.json
RUN pnpm install --frozen-lockfile

COPY packages/shared packages/shared
COPY apps/mobile apps/mobile
RUN pnpm --filter @workouty/shared build

# Re-run rather than trust the postinstall above, which ran before the sources existed:
# `COPY apps/mobile` merges, so public/ would otherwise depend on the host's gitignored copy.
RUN pnpm --filter @workouty/mobile exec powersync-web copy-assets --output public

ARG EXPO_PUBLIC_API_URL=http://localhost:3000
ARG EXPO_PUBLIC_POWERSYNC_URL=http://localhost:8080
ENV EXPO_PUBLIC_API_URL=${EXPO_PUBLIC_API_URL}
ENV EXPO_PUBLIC_POWERSYNC_URL=${EXPO_PUBLIC_POWERSYNC_URL}
RUN pnpm --filter @workouty/mobile exec expo export --platform web --output-dir dist


FROM caddy:2.10-alpine AS runtime
COPY apps/mobile/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/mobile/dist /srv
EXPOSE 80
