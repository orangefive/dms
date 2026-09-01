# 一键启动本地开发环境（Windows PowerShell）
# 用法：在项目根目录执行  .\start-dev.ps1
# 前置：MySQL 已启动且 backend\.env 中 DATABASE_URL 正确；首次需先执行初始化（见 README 第 6 节）

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

Write-Host '=== 启动后端 (http://localhost:3000) ===' -ForegroundColor Cyan
Push-Location "$root\backend"
$backend = Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','start:dev' -WorkingDirectory "$root\backend" -PassThru -WindowStyle Hidden
Pop-Location

Write-Host '=== 启动前端 (http://localhost:5173) ===' -ForegroundColor Cyan
Push-Location "$root\frontend"
$frontend = Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','dev' -WorkingDirectory "$root\frontend" -PassThru -WindowStyle Hidden
Pop-Location

Write-Host ''
Write-Host '前后端已启动：' -ForegroundColor Green
Write-Host '  前端: http://localhost:5173'
Write-Host '  后端: http://localhost:3000/api/v1'
Write-Host '  Swagger: http://localhost:3000/api/docs'
Write-Host ''
Write-Host '按 Ctrl+C 或关闭本窗口不会停止服务；如需停止：' -ForegroundColor Yellow
Write-Host "  Stop-Process -Id $($backend.Id) -Force"
Write-Host "  Stop-Process -Id $($frontend.Id) -Force"
