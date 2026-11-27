# --- build the React client ---
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# --- runtime: Express API + static client, SQLite on a mounted volume ---
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3001 \
    DB_FILE=/data/app.db
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY server ./server
RUN mkdir -p /data
EXPOSE 3001
CMD ["npm", "start"]
