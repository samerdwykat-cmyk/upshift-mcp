# syntax=docker/dockerfile:1

# The container form of the same server the Worker deploys.
#
# Glama builds this to cut a release, which is what turns "this server cannot
# be installed" into a deployable entry. It runs the stdio transport, because
# that is what a client spawning a container expects; `--http` is still
# available by appending it, since ENTRYPOINT leaves argv open.
#
# Nothing but protocol frames may reach stdout in stdio mode. The CLI's banner
# goes to stderr, which is why it is safe to keep here.

# --- build: needs devDependencies (typescript) to emit dist/ ---------------
FROM node:22-slim AS build
WORKDIR /app

# Copied before src so a source-only edit reuses the cached install layer.
COPY package.json package-lock.json tsconfig.json tsconfig.build.json ./
RUN npm ci

COPY src ./src
RUN npm run build

# --- runtime: production deps and compiled output only ---------------------
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# The base image ships an unprivileged `node` user; the server needs no root
# and holds no local authority, so it does not run as one.
USER node

ENTRYPOINT ["node", "dist/cli.js"]
