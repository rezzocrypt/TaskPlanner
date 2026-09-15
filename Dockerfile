# ---- Стадия сборки: зависимости + фронтенд ----
FROM node:24-bookworm-slim AS build

WORKDIR /app

# инструменты компиляции на случай отсутствия готового бинаря better-sqlite3
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build && npm prune --omit=dev

# ---- Стадия запуска: только прод-зависимости, dist и сервер ----
FROM node:24-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY server ./server

# каталог для SQLite-базы
RUN mkdir -p /app/data
ENV WEEKPLAN_DB=/app/data/weekplan.db
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server/index.js"]