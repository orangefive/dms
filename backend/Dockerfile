# ===== 后端镜像（多阶段构建） =====
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY prisma ./prisma
# 生成 Prisma Client（含原生查询引擎）
RUN npx prisma generate

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package*.json ./
EXPOSE 3000
# 容器入口由 docker-compose 覆盖：迁移 + 启动
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main.js"]
