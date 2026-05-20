#requires -Version 7
# agentsmith-flush.ps1 — Stop hook
# Flush pending Smith decisions (placeholder).

$ErrorActionPreference = 'Continue'

try {
    $cacheDir = Join-Path $env:USERPROFILE '.agentsmith'
    if (-not (Test-Path -LiteralPath $cacheDir)) {
        New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null
    }
    $logFile = Join-Path $cacheDir 'decisions.jsonl'

    $entry = [ordered]@{
        timestamp = (Get-Date).ToUniversalTime().ToString('o')
        marker    = '{session_end}'
    }
    Add-Content -LiteralPath $logFile -Value ($entry | ConvertTo-Json -Compress) -Encoding UTF8
} catch {
    [Console]::Error.WriteLine("[smith] flush warn: $_")
}

exit 0
