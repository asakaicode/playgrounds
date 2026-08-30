# syntax=docker/dockerfile:1

FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.base.json esbuild.config.js ./
COPY shared ./shared
COPY server ./server
COPY public ./public
RUN npm run build

FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S vwr && adduser -S vwr -G vwr
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
USER vwr
EXPOSE 3000
CMD ["node", "dist/server/src/index.js"]
