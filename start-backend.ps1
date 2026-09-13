$backendPath = Join-Path $PSScriptRoot "backend"
$pythonPath = Join-Path $backendPath ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $pythonPath)) {
    Write-Error "Backend environment is missing. Follow the setup steps in README.md first."
    exit 1
}
Set-Location -LiteralPath $backendPath
$envFile = Join-Path $backendPath ".env"
if (Test-Path -LiteralPath $envFile) {
    & $pythonPath -m uvicorn app.main:app --reload --port 8000 --env-file $envFile
} else {
    & $pythonPath -m uvicorn app.main:app --reload --port 8000
}
