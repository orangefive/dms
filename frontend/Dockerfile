# ===== 前端镜像（构建产物复制到共享卷，由 nginx 服务） =====
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/dist ./dist
# 将构建产物复制到共享卷 /shared（docker-compose 挂载）
CMD ["sh", "-c", "cp -r /app/dist/. /shared/ && echo 'frontend dist copied to /shared' && sleep infinity"]
