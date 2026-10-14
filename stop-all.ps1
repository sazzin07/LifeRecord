# Stop all Life Record services
Get-Process -Name mysqld -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process -Name python -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "*LifeRecord*backend*" } | Stop-Process -Force
Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "*LifeRecord*frontend*" } | Stop-Process -Force
Get-Process -Name php -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "*LifeRecord*phpmyadmin*" } | Stop-Process -Force
Write-Host "All Life Record services stopped."
