FROM node:22-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY migrations ./migrations
ENV NODE_ENV=production PORT=4230
EXPOSE 4230
USER node
CMD ["npx", "tsx", "src/server/main.ts"]
