# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/client/package.json apps/client/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/game-core/package.json packages/game-core/package.json
RUN --mount=type=cache,target=/root/.npm npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ARG APP_VERSION=development
ENV NODE_ENV=production
ENV DATA_DIR=/app/data
ENV APP_VERSION=${APP_VERSION}
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY packages/game-core/package.json packages/game-core/package.json
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --workspace @breakroom/server --workspace @breakroom/game-core \
  && mkdir -p /app/data \
  && chown node:node /app/data
COPY --chown=node:node --from=build /app/apps/server/dist apps/server/dist
COPY --chown=node:node --from=build /app/apps/client/dist apps/client/dist
VOLUME ["/app/data"]
EXPOSE 3001
USER node
HEALTHCHECK --interval=20s --timeout=4s --start-period=20s --retries=3 \
  CMD ["node", "--eval", "fetch('http://127.0.0.1:3001/health').then((response)=>{if(!response.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "apps/server/dist/index.js"]
