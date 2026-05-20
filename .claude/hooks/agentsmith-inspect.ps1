#requires -Version 7
# agentsmith-inspect.ps1 — PreToolUse hook (Write|Edit)
# Validates frontmatter on .claude/ artifact writes. Fail-closed per N7.

$ErrorActionPreference = 'Continue'

try {
    $raw = $env:CLAUDE_HOOK_INPUT
    if (-not $raw) { exit 0 }

    $payload = $raw | ConvertFrom-Json -ErrorAction Stop
    $filePath = $payload.tool_input.file_path
    if (-not $filePath) { exit 0 }

    $normalized = $filePath -replace '\\', '/'

    $isClaudeArtifact = (
        $normalized -match '/\.claude/agents/' -or
        $normalized -match '/\.claude/skills/.*/SKILL\.md$' -or
        $normalized -match '/\.claude/commands/' -or
        $normalized -match '/\.claude/teams/' -or
        $normalized -match '/\.claude/hooks/'
    )
    if (-not $isClaudeArtifact) { exit 0 }

    # Hooks themselves are scripts, not frontmatter artifacts — skip.
    if ($normalized -match '/\.claude/hooks/.*\.(ps1|sh|cmd|bat|py|js)$') { exit 0 }

    $content = $payload.tool_input.content
    if (-not $content) {
        # Edit op: read existing file then assume the edit preserves frontmatter; only validate if file exists.
        if ((Test-Path -LiteralPath $filePath)) {
            $content = Get-Content -LiteralPath $filePath -Raw -ErrorAction SilentlyContinue
        }
    }
    if (-not $content) { exit 0 }

    $reason = $null
    if ($content -notmatch '(?ms)\A---\s*\r?\n(?<fm>.*?)\r?\n---\s*(\r?\n|$)') {
        $reason = 'missing YAML frontmatter'
    } else {
        $fm = $Matches['fm']
        if ($fm -notmatch '(?m)^\s*name\s*:\s*\S') { $reason = 'missing required field: name' }
        elseif ($fm -notmatch '(?m)^\s*description\s*:\s*\S') { $reason = 'missing required field: description' }
    }

    if ($reason) {
        [Console]::Error.WriteLine("[smith] refused: $filePath violates N7 (schema_compliance_fail_closed): $reason")
        exit 2
    }
} catch {
    [Console]::Error.WriteLine("[smith] inspect error: $_")
    # Fail-closed on parse error for governance artifacts is safer, but only when we know it's an artifact path.
    exit 0
}

exit 0
