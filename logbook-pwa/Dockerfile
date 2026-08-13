# Static PWA bundle.
#
# Stages:
#   deps  — npm install only (local Vite HMR via compose profile `dev`)
#   build — production bundle with identity inlined (Vite import.meta.env)
#   final — nginx serving that bundle (compose profile `prod`)
#
# Canonical releases go out through nsyte (see deploy/README.md).

FROM node:22.22.0-bookworm-slim AS deps

# Puppeteer only backs host/CI QA harnesses; skip the browser download here.
ENV PUPPETEER_SKIP_DOWNLOAD=true

WORKDIR /app
COPY logbook-pwa/package.json logbook-pwa/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY logbook-pwa/ ./

FROM deps AS build

ARG COMPASS_PUBKEY
ARG ADMIN_PUBKEYS
ARG RELAYS
ARG DISCOVERY_RELAYS
ARG BLOSSOM_SERVERS
ENV COMPASS_PUBKEY=$COMPASS_PUBKEY \
    ADMIN_PUBKEYS=$ADMIN_PUBKEYS \
    RELAYS=$RELAYS \
    DISCOVERY_RELAYS=$DISCOVERY_RELAYS \
    BLOSSOM_SERVERS=$BLOSSOM_SERVERS

# The published bundle is the tested bundle: typecheck, build, and the
# performance budget all run here rather than being trusted from a host machine.
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.29-alpine
COPY logbook-pwa/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
