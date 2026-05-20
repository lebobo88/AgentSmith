#requires -Version 7
# agentsmith-archivist.ps1 — PostToolUse hook
# Appends a decision-log entry for material lifecycle events.

$ErrorActionPreference = 'Continue'

try {
    $cacheDir = Join-Path $env:USERPROFILE '.agentsmith'
    if (-not (Test-Path -LiteralPath $cacheDir)) {
        New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null
    }
    $logFile = Join-Path $cacheDir 'decisions.jsonl'

    $raw = $env:CLAUDE_HOOK_INPUT
    $toolName = $null
    $hookEvent = $null
    $summary = $null
    if ($raw) {
        try {
            $payload = $raw | ConvertFrom-Json -ErrorAction Stop
            $toolName = $payload.tool_name
            $hookEvent = $payload.hook_event_name
            if ($payload.tool_response) {
                $summary = ($payload.tool_response | ConvertTo-Json -Compress -Depth 3)
                if ($summary.Length -gt 500) { $summary = $summary.Substring(0, 500) + '...' }
            }
        } catch { }
    }

    $entry = [ordered]@{
        timestamp  = (Get-Date).ToUniversalTime().ToString('o')
        hook_event = $hookEvent
        tool_name  = $toolName
        summary    = $summary
    }
    $line = $entry | ConvertTo-Json -Compress -Depth 4
    Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8
} catch {
    [Console]::Error.WriteLine("[smith] archivist warn: $_")
}

exit 0
