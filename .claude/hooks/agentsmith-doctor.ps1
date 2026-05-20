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
