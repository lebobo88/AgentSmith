#requires -Version 7
# agentsmith-doctor.ps1 — SessionStart hook
# Verifies MCP registration, constitution presence, and sibling project reachability.
# Always exits 0 (warn-only).

$ErrorActionPreference = 'Continue'
$reasons = @()

try {
    # (a) claude mcp list includes "agentsmith"
    $mcpOk = $false
    try {
        $job = Start-Job -ScriptBlock { claude mcp list 2>&1 }
        if (Wait-Job $job -Timeout 1) {
            $out = Receive-Job $job 2>$null
            if ($out -match 'agentsmith') { $mcpOk = $true }
        }
        Remove-Job $job -Force -ErrorAction SilentlyContinue
    } catch { }
    if (-not $mcpOk) { $reasons += 'mcp:agentsmith not registered' }

    # Self-locate the repo root from this hook's own location:
    # <repo>/.claude/hooks/agentsmith-doctor.ps1  ->  $PSScriptRoot/..\.. = <repo>
    $repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
    # Siblings live adjacent to the clone (same parent), overridable via env.
    $siblingsBase = $env:AGENTSMITH_CONSUMER_BASE
    if (-not $siblingsBase) { $siblingsBase = Split-Path -Parent $repoRoot }

    # (b) constitution file exists
    $constitution = Join-Path $repoRoot 'daemon\src\constitution\smith-constitution.md'
    $constOk = Test-Path -LiteralPath $constitution
    if (-not $constOk) { $reasons += "constitution missing: $constitution" }

    # (c) at least 3 of 6 sibling project roots reachable
    $siblings = @('Hydra','TheEights','ExecutiveSuite','MarketBliss','RLM-Creative','pair-programmer') |
        ForEach-Object { Join-Path $siblingsBase $_ }
    $reachable = ($siblings | Where-Object { Test-Path -LiteralPath $_ }).Count
    if ($reachable -lt 3) { $reasons += "only $reachable/6 sibling roots reachable" }

    if ($reasons.Count -eq 0) {
        Write-Output '[smith] online. Constitution sealed. Invariants enforced.'
    } else {
        Write-Output "[smith] degraded: $($reasons -join '; ')"
    }
} catch {
    [Console]::Error.WriteLine("[smith] doctor error: $_")
}

exit 0
