FROM node:22-alpine AS build
# pnpm 11's default minimumReleaseAge policy rejects recently-published lockfile entries,
# breaking --frozen-lockfile. Pin to the version that generated pnpm-lock.yaml.
RUN corepack enable && corepack prepare pnpm@10.34.4 --activate
WORKDIR /repo

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/emails/package.json packages/emails/package.json
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile

COPY packages/shared packages/shared
COPY packages/emails packages/emails
COPY apps/api apps/api
RUN pnpm --filter @workouty/shared build && pnpm --filter @workouty/emails build && pnpm --filter @workouty/api build
RUN pnpm --filter @workouty/api db:build-migrate

# node-linker=hoisted is load-bearing: the default isolated layout materialises every package
# of drizzle-orm's peer-suffixed lockfile entry into node_modules/.pnpm — including the mobile
# app's React Native and op-sqlite — even though nothing links to them. 660 MB -> 106 MB.
RUN pnpm --filter @workouty/api deploy --prod --legacy --config.node-linker=hoisted /out


FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache postgresql-client
COPY --from=build /out ./
COPY apps/api/sql ./sql
COPY --chmod=0755 apps/api/docker-entrypoint.sh ./docker-entrypoint.sh
ARG APP_VERSION
ARG APP_RELEASE_DATE
ENV APP_VERSION=$APP_VERSION
ENV APP_RELEASE_DATE=$APP_RELEASE_DATE
EXPOSE 3000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
