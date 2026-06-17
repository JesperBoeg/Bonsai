# Bonsai web app — Next.js 15. Built from the monorepo root as the Docker context.
FROM node:22-slim

WORKDIR /app

# Workspace manifests first, for cached dependency installs.
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json

RUN npm install --workspace bonsai-web --include-workspace-root=false

# The species catalog JSON is read at build time and runtime via <repo-root>/services/vision/catalog.
COPY services/vision/catalog/*.json ./services/vision/catalog/

# Application source, then the production build.
COPY apps/web ./apps/web
WORKDIR /app/apps/web
RUN npm run build

# The local data store lives at <repo-root>/data — mount a persistent disk here.
RUN mkdir -p /app/data

ENV PORT=3000
EXPOSE 3000

CMD ["npm", "run", "start"]
