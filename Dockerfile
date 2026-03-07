FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
RUN npm ci

COPY . .
RUN npm run prisma:generate --workspace backend
RUN npm run build
RUN npm prune --omit=dev

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/backend/package.json ./backend/package.json
COPY --from=builder /app/frontend/package.json ./frontend/package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/backend/prisma ./backend/prisma
COPY --from=builder /app/frontend/dist ./frontend/dist

EXPOSE 3000
USER node
CMD ["node", "backend/dist/index.js"]
