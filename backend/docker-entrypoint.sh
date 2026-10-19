#!/bin/sh
# 容器入口：先应用数据库迁移，再把 PID 1 交给 node。
# 用 exec 而不是 & 或子 shell，保证 docker stop 的 SIGTERM 能直接送达到
# Node 进程，从而触发 Nest 的 enableShutdownHooks（优雅关闭连接池）。
set -e

echo "[entrypoint] 应用数据库迁移..."
npx prisma migrate deploy

echo "[entrypoint] 启动服务..."
exec node dist/src/main.js
