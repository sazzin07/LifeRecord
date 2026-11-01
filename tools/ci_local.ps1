# The same checks as .github/workflows/ci.yml, run on this machine (roadmap S-10).
#
#   powershell -File tools\ci_local.ps1            # backend, frontend unit tests, strict build, then the browser specs
#   powershell -File tools\ci_local.ps1 -SkipBrowser
#
# Nothing here needs a secret or touches the real database: the backend suite and the browser specs use throw-away
# schemas (backend\tests\isolated_env.py). It stops at the first failing step and says which one.
param([switch]$SkipBrowser)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$py = Join-Path $root "backend\.venv\Scripts\python.exe"

function Step($name, [scriptblock]$body) {
    Write-Host "`n=== $name" -ForegroundColor Cyan
    & $body
    if ($LASTEXITCODE -ne 0) { Write-Host "FAILED: $name" -ForegroundColor Red; exit 1 }
}

Step "Backend suite on a scratch schema" {
    Push-Location (Join-Path $root "backend"); $env:LR_ISOLATED = "1"
    & $py -m pytest tests -q -p no:cacheprovider
    Remove-Item Env:LR_ISOLATED; Pop-Location
}
Step "Frontend unit tests" {
    Push-Location (Join-Path $root "frontend"); $env:CI = "true"
    npx craco test --watchAll=false
    Remove-Item Env:CI; Pop-Location
}
Step "Frontend production build (warnings are errors)" {
    Push-Location (Join-Path $root "frontend"); $env:CI = "true"
    yarn build
    Remove-Item Env:CI; Pop-Location
}
if (-not $SkipBrowser) {
    $state = Join-Path $env:TEMP "liferecord-scratch-stack.json"
    Remove-Item "$state*" -ErrorAction SilentlyContinue
    $stack = Start-Process -FilePath $py -ArgumentList (Join-Path $root "backend\tests\isolated_env.py"), "serve" -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $env:TEMP "lr-ci-stack.log") -RedirectStandardError (Join-Path $env:TEMP "lr-ci-stack.err.log")
    try {
        for ($i = 0; $i -lt 120 -and -not (Test-Path $state); $i++) { Start-Sleep -Seconds 3 }
        if (-not (Test-Path $state)) { Write-Host "The test stack did not start" -ForegroundColor Red; exit 1 }
        Step "Browser specs (no live model)" {
            Push-Location (Join-Path $root "frontend")
            $specs = Get-ChildItem e2e -Filter *.spec.js | Where-Object { $_.Name -ne "saved-chats.spec.js" } | ForEach-Object { "e2e/$($_.Name)" }
            & $py (Join-Path $root "backend\tests\isolated_env.py") run -- npx playwright test --grep-invert "real assistant|real model|live data|real report" @specs
            Pop-Location
        }
    } finally {
        New-Item -ItemType File -Path "$state.stop" -Force | Out-Null   # the stack removes its own schema and exits
        $null = $stack.WaitForExit(30000)
    }
}
Write-Host "`nAll steps passed." -ForegroundColor Green
