# Bonsai web app — Next.js 15. Built from the monorepo root as the Docker context.
FROM node:22-slim

WORKDIR /app

# Workspace manifests first, for cached dependency installs.
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json

RUN npm ci --workspace bonsai-web --include-workspace-root=false

# The species catalog JSON is read at build time and runtime via <repo-root>/services/vision/catalog.
COPY services/vision/catalog/*.json ./services/vision/catalog/

# Application source, then the production build.
COPY apps/web ./apps/web
WORKDIR /app/apps/web
RUN npm run build

# In supabase mode nothing durable lives here — photo bytes are in Supabase
# Storage, which is what makes the container disposable. The directory exists only
# so a container started in local mode (BONSAI_DATA_BACKEND=local) has somewhere
# to write; that data does NOT survive a redeploy and is not meant to.
RUN mkdir -p /app/data

# NODE_ENV is set after `npm ci` on purpose: setting it earlier would make npm
# skip the devDependencies the build needs.
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["npm", "run", "start"]
