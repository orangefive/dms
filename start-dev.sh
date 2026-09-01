#!/usr/bin/env bash
# 一键启动本地开发环境（Linux / macOS / Git Bash / WSL）
# 用法：在项目根目录执行  ./start-dev.sh
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "=== 启动后端 (http://localhost:3000) ==="
(cd "$ROOT/backend" && npm run start:dev) &
BACKEND_PID=$!

echo "=== 启动前端 (http://localhost:5173) ==="
(cd "$ROOT/frontend" && npm run dev) &
FRONTEND_PID=$!

trap 'echo "停止服务..."; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true' EXIT

echo ""
echo "前后端已启动："
echo "  前端: http://localhost:5173"
echo "  后端: http://localhost:3000/api/v1"
echo "  Swagger: http://localhost:3000/api/docs"
echo ""
wait
