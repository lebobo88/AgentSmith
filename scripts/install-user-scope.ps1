#requires -Version 7
<#
.SYNOPSIS
  Install AgentSmith at Claude Code user scope (~/.claude/).

.DESCRIPTION
  Idempotent. Symlinks .claude/{agents,skills,commands/smith} from the repo
  into ~/.claude/, falls back to copy if symlinks are not permitted.
  Registers the agentsmith MCP server at user scope. Merges hooks +
  permissions into ~/.claude/settings.json with an `$installed_by`
  sentinel so /smith:uninstall can revert cleanly. Writes a manifest at
  ~/.claude/.agentsmith-installed.json.

  "I have to tell you a secret. I want out of here." — Smith
#>
[CmdletBinding()]
param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$UserClaude = (Join-Path $env:USERPROFILE ".claude"),
  [switch]$Force,
  [switch]$NoBuild
)

$ErrorActionPreference = "Stop"
$RepoRoot = ($RepoRoot -replace '\\','/').TrimEnd('/')
$ManifestPath = Join-Path $UserClaude ".agentsmith-installed.json"
$SettingsPath = Join-Path $UserClaude "settings.json"
$HooksJsonPath = Join-Path $RepoRoot "hooks.json"
$SmithSentinel = "agentsmith"

function Write-Smith($msg, $level = "info") {
  $prefix = "[smith.install]"
  switch ($level) {
    "warn"  { Write-Host "$prefix $msg" -ForegroundColor Yellow }
    "error" { Write-Host "$prefix $msg" -ForegroundColor Red }
    "ok"    { Write-Host "$prefix $msg" -ForegroundColor Green }
    default { Write-Host "$prefix $msg" }
  }
}

function Test-SymlinkCapability {
  $probeDir = Join-Path $env:TEMP "agentsmith-symlink-probe"
  $probeTarget = Join-Path $probeDir "target.txt"
  $probeLink = Join-Path $probeDir "link.txt"
  try {
    New-Item -ItemType Directory -Path $probeDir -Force | Out-Null
    "ok" | Out-File -FilePath $probeTarget -Encoding utf8
    if (Test-Path $probeLink) { Remove-Item $probeLink -Force }
    New-Item -ItemType SymbolicLink -Path $probeLink -Target $probeTarget -ErrorAction Stop | Out-Null
    return $true
  } catch {
    return $false
  } finally {
    if (Test-Path $probeDir) { Remove-Item $probeDir -Recurse -Force -ErrorAction SilentlyContinue }
  }
}

function Install-Item([string]$Source, [string]$Target, [bool]$PreferSymlink) {
  if (Test-Path $Target) {
    if (-not $Force) {
      throw "refusing to overwrite existing path: $Target  (re-run with -Force to clobber)"
    }
    Remove-Item $Target -Recurse -Force
  }
  $parent = Split-Path -Parent $Target
  if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
  if ($PreferSymlink) {
    try {
      New-Item -ItemType SymbolicLink -Path $Target -Target $Source -ErrorAction Stop | Out-Null
      return "symlink"
    } catch {
      Write-Smith "symlink failed for $Target — falling back to copy: $_" "warn"
    }
  }
  if ((Get-Item $Source).PSIsContainer) {
    Copy-Item -Path $Source -Destination $Target -Recurse -Force
  } else {
    Copy-Item -Path $Source -Destination $Target -Force
  }
  return "copy"
}

function Ensure-McpRegistered {
  $listed = $false
  try {
    $out = & claude mcp list 2>&1
    if ($LASTEXITCODE -eq 0 -and ($out -join "`n") -match "(^|\s)agentsmith(\s|:|$)") { $listed = $true }
  } catch {
    Write-Smith "claude CLI not reachable while probing mcp list; will attempt add anyway: $_" "warn"
  }
  if ($listed) {
    Write-Smith "MCP already registered: agentsmith"
    return $false
  }
  $entry = "node $RepoRoot/daemon/dist/index.js"
  Write-Smith "registering MCP server: $entry"
  & claude mcp add agentsmith --scope user -- node "$RepoRoot/daemon/dist/index.js"
  if ($LASTEXITCODE -ne 0) { throw "claude mcp add failed (exit $LASTEXITCODE)" }
  return $true
}

function Merge-Hooks {
  if (-not (Test-Path $HooksJsonPath)) {
    Write-Smith "no hooks.json at $HooksJsonPath — skipping hook merge" "warn"
    return @()
  }
  $repoHooks = (Get-Content $HooksJsonPath -Raw | ConvertFrom-Json -AsHashtable).hooks

  # Backup settings.
  if (Test-Path $SettingsPath) {
    $stamp = (Get-Date -Format "yyyyMMdd-HHmmss")
    $backup = "$SettingsPath.agentsmith.bak.$stamp"
    Copy-Item $SettingsPath $backup -Force
    Write-Smith "backed up settings.json -> $backup"
    $settings = Get-Content $SettingsPath -Raw | ConvertFrom-Json -AsHashtable
  } else {
    $settings = @{}
  }
  if (-not $settings.ContainsKey("hooks")) { $settings["hooks"] = @{} }

  $added = @()
  foreach ($eventName in $repoHooks.Keys) {
    if (-not $settings["hooks"].ContainsKey($eventName)) {
      $settings["hooks"][$eventName] = @()
    }
    foreach ($matcherBlock in $repoHooks[$eventName]) {
      $tagged = $matcherBlock.Clone()
      $tagged['$installed_by'] = $SmithSentinel
      # Skip if an entry with this sentinel + matcher already present.
      $exists = $false
      foreach ($existing in $settings["hooks"][$eventName]) {
        if ($existing -is [hashtable] -and $existing['$installed_by'] -eq $SmithSentinel -and $existing['matcher'] -eq $tagged['matcher']) {
          $exists = $true; break
        }
      }
      if (-not $exists) {
        $settings["hooks"][$eventName] += $tagged
        $added += "${eventName}:$($tagged['matcher'])"
      }
    }
  }

  # Permissions allowlist for agentsmith tools (avoid re-prompts).
  if (-not $settings.ContainsKey("permissions")) { $settings["permissions"] = @{} }
  if (-not $settings["permissions"].ContainsKey("allow")) { $settings["permissions"]["allow"] = @() }
  $permEntry = "mcp__agentsmith__*"
  $permsAdded = @()
  if (-not ($settings["permissions"]["allow"] -contains $permEntry)) {
    $settings["permissions"]["allow"] += $permEntry
    $permsAdded += $permEntry
  }

  $json = $settings | ConvertTo-Json -Depth 12
  Set-Content -Path $SettingsPath -Value $json -Encoding utf8 -NoNewline:$false
  Write-Smith "merged hooks: $($added.Count); permissions added: $($permsAdded.Count)" "ok"
  return @{ hooks = $added; perms = $permsAdded }
}

function Ensure-DaemonBuilt {
  $entry = Join-Path $RepoRoot "daemon/dist/index.js"
  if (Test-Path $entry) { Write-Smith "daemon already built"; return }
  if ($NoBuild) { throw "daemon/dist/index.js missing and -NoBuild was specified" }
  Write-Smith "building daemon (npm install + build)…"
  Push-Location (Join-Path $RepoRoot "daemon")
  try {
    & npm install --silent
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
    & npm run build --silent
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }
  } finally { Pop-Location }
  if (-not (Test-Path $entry)) { throw "build completed but $entry still missing" }
  Write-Smith "daemon built" "ok"
}

function Count-Invariants {
  $constitution = Join-Path $RepoRoot "daemon/src/constitution/smith-constitution.md"
  if (-not (Test-Path $constitution)) { return 0 }
  $lines = Get-Content $constitution
  return ($lines | Where-Object { $_ -match '^##\s+N\d+\s+[—–-]' }).Count
}

# ---- main ----

Write-Smith "repo_root = $RepoRoot"
Write-Smith "user .claude = $UserClaude"

if (-not (Test-Path $UserClaude)) {
  New-Item -ItemType Directory -Path $UserClaude -Force | Out-Null
}

Ensure-DaemonBuilt

$symlinkOk = Test-SymlinkCapability
if ($symlinkOk) {
  Write-Smith "symlinks: enabled" "ok"
} else {
  Write-Smith "symlinks: NOT permitted on this machine — using copy fallback (re-run installer after git pull)" "warn"
}

$items = @()

# Pre-flight collision check.
$plan = @(
  @{ kind = "agent";   src = "$RepoRoot/.claude/agents";         dst = "$UserClaude/agents";         mode = "per-file" }
  @{ kind = "skill";   src = "$RepoRoot/.claude/skills";         dst = "$UserClaude/skills";         mode = "per-subdir" }
  @{ kind = "command"; src = "$RepoRoot/.claude/commands/smith"; dst = "$UserClaude/commands/smith"; mode = "as-dir" }
)

foreach ($p in $plan) {
  if ($p.mode -eq "per-file") {
    foreach ($f in Get-ChildItem -Path $p.src -File -Filter *.md -ErrorAction SilentlyContinue) {
      $target = Join-Path $p.dst $f.Name
      if ((Test-Path $target) -and -not $Force) {
        # If the existing target already points to our source, treat as already installed.
        $existing = Get-Item $target -Force
        if ($existing.Target -and ($existing.Target -replace '\\','/') -eq ($f.FullName -replace '\\','/')) {
          Write-Smith "already linked: $($f.Name)"
          $items += @{ kind = "agent"; name = $f.BaseName; source = $f.FullName; target = $target; strategy = "symlink"; preexisting = $true }
          continue
        }
        throw "collision in ~/.claude/agents: $($f.Name) (use -Force to overwrite)"
      }
      $strategy = Install-Item -Source $f.FullName -Target $target -PreferSymlink:$symlinkOk
      Write-Smith "$strategy agent: $($f.Name)"
      $items += @{ kind = "agent"; name = $f.BaseName; source = $f.FullName; target = $target; strategy = $strategy }
    }
  } elseif ($p.mode -eq "per-subdir") {
    foreach ($d in Get-ChildItem -Path $p.src -Directory -ErrorAction SilentlyContinue) {
      $target = Join-Path $p.dst $d.Name
      if ((Test-Path $target) -and -not $Force) {
        $existing = Get-Item $target -Force
        if ($existing.Target -and ($existing.Target -replace '\\','/') -eq ($d.FullName -replace '\\','/')) {
          Write-Smith "already linked: skill/$($d.Name)"
          $items += @{ kind = "skill"; name = $d.Name; source = $d.FullName; target = $target; strategy = "symlink"; preexisting = $true }
          continue
        }
        throw "collision in ~/.claude/skills: $($d.Name) (use -Force to overwrite)"
      }
      $strategy = Install-Item -Source $d.FullName -Target $target -PreferSymlink:$symlinkOk
      Write-Smith "$strategy skill: $($d.Name)"
      $items += @{ kind = "skill"; name = $d.Name; source = $d.FullName; target = $target; strategy = $strategy }
    }
  } else {
    # as-dir: install the entire commands/smith directory atomically
    if ((Test-Path $p.dst) -and -not $Force) {
      $existing = Get-Item $p.dst -Force
      if ($existing.Target -and ($existing.Target -replace '\\','/') -eq ($p.src -replace '\\','/')) {
        Write-Smith "already linked: commands/smith"
        $items += @{ kind = "command-dir"; name = "smith"; source = $p.src; target = $p.dst; strategy = "symlink"; preexisting = $true }
        continue
      }
      throw "collision at ~/.claude/commands/smith (use -Force to overwrite)"
    }
    $strategy = Install-Item -Source $p.src -Target $p.dst -PreferSymlink:$symlinkOk
    Write-Smith "$strategy commands/smith ($strategy)"
    $items += @{ kind = "command-dir"; name = "smith"; source = $p.src; target = $p.dst; strategy = $strategy }
  }
}

$mcpAdded = Ensure-McpRegistered
$mergeResult = Merge-Hooks

$invariantCount = Count-Invariants

$manifest = @{
  version          = "0.1.0"
  repo_root        = $RepoRoot
  user_claude      = $UserClaude
  installed_at     = (Get-Date).ToString("o")
  symlink_capable  = $symlinkOk
  items            = $items
  mcp_added        = $mcpAdded
  hooks_added      = $mergeResult.hooks
  permissions_added = $mergeResult.perms
  smith_sentinel   = $SmithSentinel
}
$manifest | ConvertTo-Json -Depth 8 | Set-Content -Path $ManifestPath -Encoding utf8

Write-Host ""
Write-Smith "================================================="
Write-Smith "installed: $($items.Count) items"
Write-Smith "mcp: $(if($mcpAdded){'registered'}else{'already present'})"
Write-Smith "hooks added: $($mergeResult.hooks.Count)"
Write-Smith "constitution: $invariantCount invariants"
Write-Smith "manifest: $ManifestPath"
Write-Smith "[smith] installed. Constitution sealed. Invariants enforced." "ok"
Write-Smith "Restart Claude Code in any project to surface /smith:* commands and mcp__agentsmith__* tools."
