#requires -Version 7
# agentsmith-keymaker.ps1 — UserPromptSubmit hook
# Detects stub/missing artifacts in active project .claude/ and suggests scaffolding.
# Budget: <=500ms wall-clock. Silent on failure.

$ErrorActionPreference = 'Continue'
$deadline = (Get-Date).AddMilliseconds(500)

try {
    $cacheDir = Join-Path $env:USERPROFILE '.agentsmith'
    if (-not (Test-Path -LiteralPath $cacheDir)) {
        New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null
    }
    $cacheFile = Join-Path $cacheDir 'registry-cache.json'

    $cache = $null
    if (Test-Path -LiteralPath $cacheFile) {
        $info = Get-Item -LiteralPath $cacheFile
        if ((Get-Date) - $info.LastWriteTime -lt [TimeSpan]::FromSeconds(60)) {
            try { $cache = Get-Content -LiteralPath $cacheFile -Raw | ConvertFrom-Json } catch { }
        }
    }

    $projectRoot = $PWD.Path
    $claudeDir = Join-Path $projectRoot '.claude'
    if (-not (Test-Path -LiteralPath $claudeDir)) { exit 0 }

    $suggestion = $null

    if ($cache -and $cache.project -eq $projectRoot -and $cache.suggestion) {
        $suggestion = $cache.suggestion
    } else {
        $kinds = @{
            'agent'   = (Join-Path $claudeDir 'agents')
            'skill'   = (Join-Path $claudeDir 'skills')
            'command' = (Join-Path $claudeDir 'commands')
            'team'    = (Join-Path $claudeDir 'teams')
        }

        foreach ($kind in $kinds.Keys) {
            if ((Get-Date) -gt $deadline) { break }
            $dir = $kinds[$kind]
            if (-not (Test-Path -LiteralPath $dir)) { continue }
            $files = Get-ChildItem -LiteralPath $dir -Recurse -File -ErrorAction SilentlyContinue |
                     Where-Object { $_.Extension -in '.md', '.yaml', '.yml' } |
                     Select-Object -First 25
            foreach ($f in $files) {
                if ((Get-Date) -gt $deadline) { break }
                $content = Get-Content -LiteralPath $f.FullName -Raw -ErrorAction SilentlyContinue
                if (-not $content -or $content.Length -lt 40 -or
                    $content -match '(?i)\bTODO\b|\bSTUB\b|\bFIXME\b' -or
                    $content -notmatch '(?ms)^---\s*\r?\n.*?\r?\n---') {
                    $slug = [IO.Path]::GetFileNameWithoutExtension($f.Name)
                    $suggestion = "/smith:scaffold $kind $slug"
                    break
                }
            }
            if ($suggestion) { break }
        }

        $snap = [ordered]@{
            project    = $projectRoot
            cached_at  = (Get-Date).ToString('o')
            suggestion = $suggestion
        }
        try { $snap | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $cacheFile -Encoding UTF8 } catch { }
    }

    if ($suggestion) {
        Write-Output "[smith] suggested: $suggestion"
    }
} catch {
    [Console]::Error.WriteLine("[smith] keymaker warn: $_")
}

exit 0
