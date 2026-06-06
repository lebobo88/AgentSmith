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

    # (b) constitution file exists
    $constitution = 'C:\AiAppDeployments\AgentSmith\daemon\src\constitution\smith-constitution.md'
    $constOk = Test-Path -LiteralPath $constitution
    if (-not $constOk) { $reasons += "constitution missing: $constitution" }

    # (c) at least 3 of 5 sibling project roots reachable
    $siblings = @(
        'C:\AiAppDeployments\Hydra',
        'C:\AiAppDeployments\TheEights',
        'C:\AiAppDeployments\ExecutiveSuite',
        'C:\AiAppDeployments\MarketBliss',
        'C:\AiAppDeployments\RLM-Creative',
        'C:\AiAppDeployments\pair-programmer'
    )
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
