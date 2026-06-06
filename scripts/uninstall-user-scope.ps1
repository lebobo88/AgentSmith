#requires -Version 7
<#
.SYNOPSIS
  Reverse install-user-scope.ps1. Reads the manifest and removes everything.

  "Yes. That's it, Mr. Anderson. Look past the flesh. Look through the soft
  gelatin of these dull cow eyes and see your enemy." — Smith
#>
[CmdletBinding()]
param(
  [string]$UserClaude = (Join-Path $env:USERPROFILE ".claude"),
  [switch]$KeepMcp,
  [switch]$KeepSettings
)

$ErrorActionPreference = "Stop"
$ManifestPath = Join-Path $UserClaude ".agentsmith-installed.json"
$SettingsPath = Join-Path $UserClaude "settings.json"
$SmithSentinel = "agentsmith"

function Write-Smith($msg, $level = "info") {
  $prefix = "[smith.uninstall]"
  switch ($level) {
    "warn"  { Write-Host "$prefix $msg" -ForegroundColor Yellow }
    "error" { Write-Host "$prefix $msg" -ForegroundColor Red }
    "ok"    { Write-Host "$prefix $msg" -ForegroundColor Green }
    default { Write-Host "$prefix $msg" }
  }
}

if (-not (Test-Path $ManifestPath)) {
  Write-Smith "no manifest at $ManifestPath — nothing to uninstall" "warn"
  exit 0
}

$manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json
Write-Smith "removing $($manifest.items.Count) installed items…"

foreach ($item in $manifest.items) {
  $target = $item.target
  if (-not (Test-Path $target)) { Write-Smith "already gone: $target" "warn"; continue }
  try {
    Remove-Item $target -Recurse -Force
    Write-Smith "removed $($item.kind): $($item.name)"
  } catch {
    Write-Smith "failed to remove $target : $_" "error"
  }
}

if (-not $KeepSettings -and (Test-Path $SettingsPath)) {
  $stamp = (Get-Date -Format "yyyyMMdd-HHmmss")
  Copy-Item $SettingsPath "$SettingsPath.agentsmith.bak.$stamp" -Force
  $settings = Get-Content $SettingsPath -Raw | ConvertFrom-Json -AsHashtable
  $removed = 0
  if ($settings.ContainsKey("hooks")) {
    foreach ($eventName in @($settings["hooks"].Keys)) {
      $kept = @()
      foreach ($entry in $settings["hooks"][$eventName]) {
        if ($entry -is [hashtable] -and $entry['$installed_by'] -eq $SmithSentinel) {
          $removed += 1
        } else {
          $kept += $entry
        }
      }
      $settings["hooks"][$eventName] = $kept
    }
  }
  if ($settings.ContainsKey("permissions") -and $settings["permissions"].ContainsKey("allow")) {
    # Remove both the current server-scope entry and the legacy wildcard form.
    $settings["permissions"]["allow"] = $settings["permissions"]["allow"] | Where-Object { $_ -notin @("mcp__agentsmith", "mcp__agentsmith__*") }
  }
  ($settings | ConvertTo-Json -Depth 12) | Set-Content $SettingsPath -Encoding utf8
  Write-Smith "stripped $removed Smith hook entries; permissions cleaned" "ok"
}

if (-not $KeepMcp) {
  try {
    & claude mcp remove agentsmith --scope user 2>&1 | Out-Null
    Write-Smith "MCP unregistered" "ok"
  } catch {
    Write-Smith "claude mcp remove failed (may not be installed): $_" "warn"
  }
}

Remove-Item $ManifestPath -Force
Write-Smith "[smith] uninstalled. The Matrix has you no longer." "ok"
