[CmdletBinding()]
param(
  [ValidateSet('disable','enable','rollback')][string]$Action = 'disable',
  [string]$CodexRoot = (Join-Path $env:USERPROFILE '.codex'),
  [string]$NodeExe = ''
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT' -or $CodexRoot -notmatch '^[A-Za-z]:[\\/]') { throw 'An absolute local Windows CodexRoot is required.' }
$CodexRoot = [System.IO.Path]::GetFullPath($CodexRoot)
if (-not $NodeExe) {
  $config = Join-Path $CodexRoot 'goflow\runtime-config.json'
  if (Test-Path -LiteralPath $config -PathType Leaf) { $NodeExe = (Get-Content -LiteralPath $config -Raw | ConvertFrom-Json).nodeExe }
}
if (-not $NodeExe) {
  $found = Get-Command 'node.exe' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found) { $NodeExe = $found.Source }
}
if (-not $NodeExe -or $NodeExe -notmatch '^[A-Za-z]:[\\/].*\.exe$' -or -not (Test-Path -LiteralPath $NodeExe -PathType Leaf)) { throw 'Supply an absolute native Node executable with -NodeExe.' }
$savedNodeOptions = $env:NODE_OPTIONS
try {
  Remove-Item Env:\NODE_OPTIONS -ErrorAction SilentlyContinue
  & $NodeExe (Join-Path $PSScriptRoot 'control.mjs') $Action $CodexRoot
  if ($LASTEXITCODE -ne 0) { throw 'GoFlow control failed; existing runtime and task state remain available.' }
} finally {
  if ($null -eq $savedNodeOptions) { Remove-Item Env:\NODE_OPTIONS -ErrorAction SilentlyContinue }
  else { $env:NODE_OPTIONS = $savedNodeOptions }
}
