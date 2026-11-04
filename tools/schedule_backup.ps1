# Registers (or replaces) the daily Life Record backup in Windows Task Scheduler (roadmap S-07).
#
#   powershell -ExecutionPolicy Bypass -File tools\schedule_backup.ps1                      # every day at 03:00, to %USERPROFILE%\LifeRecordBackups
#   powershell -ExecutionPolicy Bypass -File tools\schedule_backup.ps1 -Time 22:30 -Dest D:\Backups\LifeRecord
#   powershell -ExecutionPolicy Bypass -File tools\schedule_backup.ps1 -Remove              # take the task away again
#
# The task runs as YOU, only while you are signed in (Windows DPAPI, which encrypts the backups, is tied to your account).
# If the PC was off at that time it runs as soon as it can. The database must be running (start-all.ps1) or the run is logged as FAIL
# in <Dest>\backup.log. It keeps the last 14 days and 8 weeks, and refuses to write inside the project folder.
param(
  [string]$Dest = (Join-Path $env:USERPROFILE "LifeRecordBackups"),
  [string]$Time = "03:00",
  [switch]$Remove
)
$ErrorActionPreference = "Stop"
$taskName = "LifeRecord daily backup"
if ($Remove) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Removed the scheduled task '$taskName'."
  return
}
$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root "backend\.venv\Scripts\python.exe"
if (-not (Test-Path $python)) { throw "Cannot find $python. Create the backend virtual environment first." }
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
$action = New-ScheduledTaskAction -Execute $python -Argument "tools\backup.py --dest `"$Dest`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Host "Scheduled '$taskName' every day at $Time. Backups go to $Dest (log: $Dest\backup.log)."
