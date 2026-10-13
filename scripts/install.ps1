[CmdletBinding()]
param(
  [string]$CodexRoot = (Join-Path $env:USERPROFILE '.codex'),
  [string]$NodeExe = '',
  [string]$GitExe = '',
  [string]$PythonExe = '',
  [string]$OpenCodeExe = ''
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'This installer supports Windows only.' }
$sourceRoot = Split-Path -Parent $PSScriptRoot
$owner = 'GoFlow public export v1.1'
$utf8 = [System.Text.UTF8Encoding]::new($false)

function Assert-RegularPath([string]$Name) {
  $cursor = [System.IO.Path]::GetFullPath($Name)
  while ($cursor) {
    if (Test-Path -LiteralPath $cursor) {
      $item = Get-Item -LiteralPath $cursor -Force
      if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Linked install path refused.' }
    }
    $parent = Split-Path -Parent $cursor
    if (-not $parent -or $parent -eq $cursor) { break }
    $cursor = $parent
  }
}
function Native-Exe([string]$Name, [string]$Candidate) {
  if (-not $Candidate) {
    $found = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { $Candidate = $found.Source }
  }
  if (-not $Candidate -or $Candidate -notmatch '^[A-Za-z]:[\\/]' -or [System.IO.Path]::GetExtension($Candidate) -ne '.exe') {
    throw "$Name requires an absolute local native .exe path; supply its installer parameter."
  }
  Assert-RegularPath $Candidate
  if (-not (Test-Path -LiteralPath $Candidate -PathType Leaf)) { throw "$Name native executable was not found." }
  return [System.IO.Path]::GetFullPath($Candidate)
}
function Own-Directory([string]$Name) {
  Assert-RegularPath $Name
  if (Test-Path -LiteralPath $Name) {
    $marker = Join-Path $Name '.goflow-owned'
    Assert-RegularPath $marker
    if (-not (Test-Path -LiteralPath $marker -PathType Leaf) -or [System.IO.File]::ReadAllText($marker).Trim() -ne $owner) {
      throw 'Existing directory is not owned by this public export; nothing will be replaced.'
    }
  }
}
function Merge-Defaults($Current, $Defaults) {
  foreach ($property in $Defaults.PSObject.Properties) {
    $present = $Current.PSObject.Properties[$property.Name]
    if ($null -eq $present) { $Current | Add-Member -NotePropertyName $property.Name -NotePropertyValue $property.Value }
    elseif ($present.Value -is [pscustomobject] -and $property.Value -is [pscustomobject]) { Merge-Defaults $present.Value $property.Value }
  }
}
function Copy-Tree([string]$InputDirectory, [string]$OutputDirectory) {
  Assert-RegularPath $InputDirectory
  Assert-RegularPath $OutputDirectory
  [System.IO.Directory]::CreateDirectory($OutputDirectory) | Out-Null
  foreach ($entry in Get-ChildItem -LiteralPath $InputDirectory -Force) {
    Assert-RegularPath $entry.FullName
    $destination = Join-Path $OutputDirectory $entry.Name
    Assert-RegularPath $destination
    if ($entry.PSIsContainer) { Copy-Tree $entry.FullName $destination }
    else { [System.IO.File]::Copy($entry.FullName, $destination, $true) }
  }
}

if ($CodexRoot -notmatch '^[A-Za-z]:[\\/]') { throw 'CodexRoot must be an absolute local Windows path.' }
$CodexRoot = [System.IO.Path]::GetFullPath($CodexRoot)
$runtime = Join-Path $CodexRoot 'goflow'
$skill = Join-Path $CodexRoot 'skills\goflow'
Own-Directory $runtime
Own-Directory $skill
$required = @('src\core.mjs','src\cli.mjs','src\server.mjs','src\quota.mjs','scripts\secure_usage.py','scripts\control.mjs','scripts\control.ps1','skills\goflow\SKILL.md','.codex-plugin\plugin.json','runtime-config.example.json','package.json','AGENTS.fragment.md','LICENSE','LICENSE.upstream','.mcp.example.json')
foreach ($relative in $required) {
  $inputFile = Join-Path $sourceRoot $relative
  Assert-RegularPath $inputFile
  if (-not (Test-Path -LiteralPath $inputFile -PathType Leaf)) { throw 'Incomplete source export; install refused.' }
}
$configPath = Join-Path $runtime 'runtime-config.json'
Assert-RegularPath $configPath
$defaults = Get-Content -LiteralPath (Join-Path $sourceRoot 'runtime-config.example.json') -Raw | ConvertFrom-Json
$newConfiguration = -not (Test-Path -LiteralPath $configPath)
$settings = if (-not $newConfiguration) { Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json } else { $defaults }
if ($settings -isnot [pscustomobject]) { throw 'Runtime configuration must be a JSON object.' }
Merge-Defaults $settings $defaults
if ($newConfiguration) {
  $settings.billingGuard = [pscustomobject]@{useBalanceDisabledConfirmed=$false;activeGoSubscriptionConfirmed=$false;confirmedAt=$null;confirmationSource=$null}
}
if (-not $NodeExe -and $settings.nodeExe) { $NodeExe = $settings.nodeExe }
if (-not $GitExe -and $settings.gitExe) { $GitExe = $settings.gitExe }
if (-not $PythonExe -and $settings.pythonExe) { $PythonExe = $settings.pythonExe }
if (-not $OpenCodeExe -and $settings.opencodeExe) { $OpenCodeExe = $settings.opencodeExe }
$NodeExe = Native-Exe 'node.exe' $NodeExe
$GitExe = Native-Exe 'git.exe' $GitExe
$PythonExe = Native-Exe 'python.exe' $PythonExe
if (-not $OpenCodeExe) {
  if ($env:APPDATA) {
    $candidate = Join-Path $env:APPDATA 'npm\node_modules\opencode-ai\bin\opencode.exe'
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { $OpenCodeExe = $candidate }
  }
  if (-not $OpenCodeExe) {
    $native = Get-Command 'opencode.exe' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($native) { $OpenCodeExe = $native.Source }
  }
  if (-not $OpenCodeExe) {
    $shim = Get-Command 'opencode' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($shim) {
      $candidate = Join-Path (Split-Path -Parent $shim.Source) 'node_modules\opencode-ai\bin\opencode.exe'
      if (Test-Path -LiteralPath $candidate -PathType Leaf) { $OpenCodeExe = $candidate }
    }
  }
}
$OpenCodeExe = Native-Exe 'opencode.exe' $OpenCodeExe
$savedNodeOptions = $env:NODE_OPTIONS
try {
  Remove-Item Env:\NODE_OPTIONS -ErrorAction SilentlyContinue
  $nodeVersion = (& $NodeExe --version | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 24) { throw 'Node.js 24 or newer is required.' }
  $goVersion = (& $OpenCodeExe --version | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $goVersion -ne '1.18.15') { throw 'Only the reviewed OpenCode 1.18.15 is supported; no automatic upgrade will run.' }
  & $GitExe --version | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Git version check failed.' }
  & $PythonExe -I -S -X utf8 --version | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Python executable check failed.' }
  & $NodeExe (Join-Path $sourceRoot 'scripts\control.mjs') preflight $CodexRoot | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Existing registration or active task prevents installation.' }

  [System.IO.Directory]::CreateDirectory($runtime) | Out-Null
  [System.IO.File]::WriteAllText((Join-Path $runtime '.goflow-owned'), $owner + "`n", $utf8)
  foreach ($folder in @('src','skills\goflow','.codex-plugin')) { Copy-Tree (Join-Path $sourceRoot $folder) (Join-Path $runtime $folder) }
  [System.IO.Directory]::CreateDirectory((Join-Path $runtime 'scripts')) | Out-Null
  foreach ($relative in @('scripts\install.ps1','scripts\control.mjs','scripts\control.ps1','scripts\secure_usage.py','package.json','AGENTS.fragment.md','LICENSE','LICENSE.upstream','README.md','runtime-config.example.json','.mcp.example.json')) {
    $out = Join-Path $runtime $relative
    Assert-RegularPath $out
    [System.IO.File]::Copy((Join-Path $sourceRoot $relative), $out, $true)
  }
  $settings.nodeExe = $NodeExe
  $settings.gitExe = $GitExe
  $settings.pythonExe = $PythonExe
  $settings.opencodeExe = $OpenCodeExe
  [System.IO.File]::WriteAllText($configPath, ($settings | ConvertTo-Json -Depth 30) + "`n", $utf8)
  $mcp = @{mcpServers=@{goflow=@{command=$NodeExe;args=@((Join-Path $runtime 'src\server.mjs'))}}}
  Assert-RegularPath (Join-Path $runtime '.mcp.json')
  [System.IO.File]::WriteAllText((Join-Path $runtime '.mcp.json'), ($mcp | ConvertTo-Json -Depth 6) + "`n", $utf8)
  & $NodeExe (Join-Path $runtime 'scripts\control.mjs') register $CodexRoot | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Registration failed; runtime and state are retained for recovery.' }
  Write-Output 'GoFlow installed as a user MCP and global skill. Start a new Codex session. New installations keep billing guard OFF; existing confirmations and mode are preserved.'
} finally {
  if ($null -eq $savedNodeOptions) { Remove-Item Env:\NODE_OPTIONS -ErrorAction SilentlyContinue }
  else { $env:NODE_OPTIONS = $savedNodeOptions }
}
