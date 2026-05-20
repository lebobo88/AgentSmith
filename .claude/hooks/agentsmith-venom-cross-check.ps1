#requires -Version 7
# agentsmith-venom-cross-check.ps1 — PreToolUse hook (mcp__hydra__*)
# Informational cross-check; placeholder for cerberus-bridge.

$ErrorActionPreference = 'Continue'

try {
    $raw = $env:CLAUDE_HOOK_INPUT
    if (-not $raw) { exit 0 }
    $payload = $raw | ConvertFrom-Json -ErrorAction Stop
    $toolName = $payload.tool_name
    if (-not $toolName) { exit 0 }

    $keywords = @('deploy', 'push', 'migrate', 'mutate', 'propose_amendment', 'override', 'force')
    foreach ($kw in $keywords) {
        if ($toolName -match [regex]::Escape($kw)) {
            [Console]::Error.WriteLine("[smith] cross-check: $toolName")
            break
        }
    }
} catch {
    [Console]::Error.WriteLine("[smith] venom warn: $_")
}

exit 0
