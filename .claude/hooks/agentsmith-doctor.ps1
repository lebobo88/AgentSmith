#requires -Version 7
# agentsmith-doctor.ps1 — SessionStart hook
# Verifies MCP registration, constitution presence, and sibling project reachability.
# Always exits 0 (warn-only).

$ErrorActionPreference = 'Continue'
$reasons = @()

try {
    # (a) agentsmith MCP reachable — either registered directly in the Claude
    # user config, or fronted by hydra_gateway (mesh architecture: gateway is
    # registered with Claude and agentsmith is enrolled in backends.json).
    # Config-file check, not `claude mcp list`: a SessionStart hook cannot
    # afford the multi-second server probe (the old 1s Wait-Job ALWAYS lost
    # the race and reported degraded even when registration was fine).
    $mcpOk = $false
    try {
        $claudeCfg = Join-Path $env:USERPROFILE '.claude.json'
        if (Test-Path -LiteralPath $claudeCfg) {
            $cfg = Get-Content -LiteralPath $claudeCfg -Raw | ConvertFrom-Json
            $servers = @($cfg.mcpServers.PSObject.Properties.Name)
            if ($servers -contains 'agentsmith') {
                $mcpOk = $true
            } elseif ($servers -contains 'hydra_gateway') {
                $backendsFile = Join-Path $env:USERPROFILE '.hydra\backends.json'
                if (Test-Path -LiteralPath $backendsFile) {
                    $backends = Get-Content -LiteralPath $backendsFile -Raw | ConvertFrom-Json
                    if (@($backends.PSObject.Properties.Name) -contains 'agentsmith') {
                        $mcpOk = $true
                    }
                }
            }
        }
    } catch { }
    if (-not $mcpOk) { $reasons += 'mcp:agentsmith not registered (directly or via hydra_gateway backends.json)' }

    # Resolve AgentSmith's OWN repo root. The constitution being checked is
    # always AgentSmith's, and this hook always lives at
    # <AgentSmithRepo>/.claude/hooks/. Resolve from AGENTSMITH_REPO or the hook's
    # own ancestor — deliberately NOT $CLAUDE_PROJECT_DIR, which points at
    # whichever project launched the session (e.g. an rlm-gaming squad pack) and
    # would make the constitution check look in the wrong tree and falsely report
    # "constitution missing". The shared sibling base resolves from
    # AGENTSMITH_CONSUMER_BASE -> AIAPP_BASE -> parent of repo root.
    $repoRoot = $env:AGENTSMITH_REPO
    if ([string]::IsNullOrWhiteSpace($repoRoot)) {
        # hook lives at <repoRoot>/.claude/hooks/agentsmith-doctor.ps1
        $repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
    }
    $base = $env:AGENTSMITH_CONSUMER_BASE
    if ([string]::IsNullOrWhiteSpace($base)) { $base = $env:AIAPP_BASE }
    if ([string]::IsNullOrWhiteSpace($base)) { $base = Split-Path -Parent $repoRoot }

    # (b) constitution file exists
    $constitution = Join-Path $repoRoot 'daemon\src\constitution\smith-constitution.md'
    $constOk = Test-Path -LiteralPath $constitution
    if (-not $constOk) { $reasons += "constitution missing: $constitution" }

    # (c) at least 3 sibling project roots reachable
    $siblings = @(
        (Join-Path $base 'Hydra'),
        (Join-Path $base 'TheEights'),
        (Join-Path $base 'ExecutiveSuite'),
        (Join-Path $base 'MarketBliss'),
        (Join-Path $base 'RLM-Creative'),
        (Join-Path $base 'RLM-Gaming'),
        (Join-Path $base 'pair-programmer')
    )
    $reachable = ($siblings | Where-Object { Test-Path -LiteralPath $_ }).Count
    if ($reachable -lt 3) { $reasons += "only $reachable/7 sibling roots reachable" }

    if ($reasons.Count -eq 0) {
        Write-Output '[smith] online. Constitution sealed. Invariants enforced.'
    } else {
        Write-Output "[smith] degraded: $($reasons -join '; ')"
    }
} catch {
    [Console]::Error.WriteLine("[smith] doctor error: $_")
}

exit 0
