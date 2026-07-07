# Production image -- see Dockerfile.dev for the hot-reload dev image docker-compose.yml uses.
# Multi-stage: compile TypeScript in a build stage, ship only the compiled output + production
# dependencies in the final image (no devDependencies, no source .ts files, no ts-node).

FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/main.js"]
