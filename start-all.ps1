# Start all Life Record services
$ErrorActionPreference = "Stop"

$mysqlData = "C:\Projects\LifeRecord\tools\mysql-data"
$mysqlBin = "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqld.exe"
$backendDir = "C:\Projects\LifeRecord\backend"
$frontendDir = "C:\Projects\LifeRecord\frontend"
$phpMyAdminDir = "C:\Projects\LifeRecord\tools\phpmyadmin"

function Test-Port($port) {
    $c = netstat -ano | findstr ":$port" | findstr LISTENING
    return $null -ne $c
}

# 1. MySQL
if (-not (Test-Port 3306)) {
    if (-not (Test-Path $mysqlData)) {
        New-Item -ItemType Directory -Force -Path $mysqlData | Out-Null
        Start-Process -FilePath $mysqlBin -ArgumentList "--initialize-insecure","--datadir=$mysqlData" -Wait -WindowStyle Hidden
    }
    Start-Process -FilePath $mysqlBin -ArgumentList "--defaults-file=$mysqlData\my.cnf","--console" -WindowStyle Hidden
    Write-Host "MySQL starting on port 3306..."
    Start-Sleep -Seconds 4
} else {
    Write-Host "MySQL already running on port 3306."
}



# Ensure liferecord database exists (check first to avoid MySQL warning)
& "$backendDir\.venv\Scripts\python.exe" "$PSScriptRoot\tools\ensure_db.py"

# 2. Backend
if (-not (Test-Port 8000)) {
    Start-Process -FilePath "$backendDir\.venv\Scripts\python.exe" -ArgumentList "-m","uvicorn","server:app","--host","0.0.0.0","--port","8000","--log-level","info" -WorkingDirectory $backendDir -WindowStyle Hidden
    Write-Host "Backend starting on port 8000..."
    Start-Sleep -Seconds 2
} else {
    Write-Host "Backend already running on port 8000."
}

# 3. Frontend
if (-not (Test-Port 3000)) {
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c yarn start > frontend.log 2>&1" -WorkingDirectory $frontendDir -WindowStyle Hidden
    Write-Host "Frontend starting on port 3000..."
} else {
    Write-Host "Frontend already running on port 3000."
}

# 4. phpMyAdmin
if (-not (Test-Port 8080)) {
    Start-Process -FilePath "php" -ArgumentList "-S","localhost:8080" -WorkingDirectory $phpMyAdminDir -WindowStyle Hidden
    Write-Host "phpMyAdmin starting on port 8080..."
} else {
    Write-Host "phpMyAdmin already running on port 8080."
}

Write-Host ""
Write-Host "Services:"
Write-Host "  Frontend:   http://localhost:3000"
Write-Host "  Backend:    http://localhost:8000"
Write-Host "  phpMyAdmin: http://localhost:8080"
Write-Host "  MySQL:      localhost:3306 (root / no password)"
