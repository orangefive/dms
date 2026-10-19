# ===== 后端镜像（多阶段构建，非 root 运行） =====
FROM node:20-alpine AS deps
WORKDIR /app
# Prisma 查询引擎在 alpine 上依赖 openssl
RUN apk add --no-cache openssl
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
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
# 运维脚本需要随镜像发布（如 npm run create-admin 依赖 ts-node + scripts/）
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY package*.json ./
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && chown -R node:node /app
# 以非 root 用户运行，降低容器逃逸后的影响面
USER node
EXPOSE 3000
# 健康检查命中 /health（该路由被排除在 /api/v1 前缀之外）
HEALTHCHECK --interval=15s --timeout=3s --start-period=40s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1
ENTRYPOINT ["docker-entrypoint.sh"]
