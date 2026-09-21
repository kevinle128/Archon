param(
  [Parameter(Mandatory = $true)]
  [string] $SyncDirectoryRelativePath,

  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $BunArguments
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$bunVersion = '1.3.11'
$destination = 'C:\dev\archon-windows'
$destinationParent = Split-Path -Parent $destination
$logDirectory = Join-Path $destinationParent 'archon-windows-logs'

New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$runLog = Join-Path $logDirectory "$(Get-Date -Format 'yyyyMMdd-HHmmss').log"
Start-Transcript -Path $runLog | Out-Null
Write-Host "Windows test log: $runLog"

function Assert-LastExitCode {
  param([string] $Action)

  if ($LASTEXITCODE -ne 0) {
    throw "$Action failed with exit code $LASTEXITCODE."
  }
}

function Invoke-BunCommand {
  param(
    [string] $Bun,
    [string[]] $CommandArguments
  )

  Write-Host ''
  Write-Host "> bun $($CommandArguments -join ' ')"
  & $Bun @CommandArguments
  Assert-LastExitCode "bun $($CommandArguments -join ' ')"
}

function Invoke-WindowsChecks {
  $share = Get-PSDrive -PSProvider FileSystem |
    Where-Object { $_.DisplayRoot -eq '\\Mac\archon-src' } |
    Select-Object -First 1
  if (-not $share) {
    throw "The Parallels host share 'archon-src' is not mounted."
  }
  $source = $share.Root
  $syncDirectory = Join-Path $source $SyncDirectoryRelativePath
  $syncManifest = Get-Content -LiteralPath (Join-Path $syncDirectory 'manifest.json') -Raw |
    ConvertFrom-Json
  $bundleFile = Join-Path $syncDirectory 'repository.bundle'
  $patchFile = Join-Path $syncDirectory 'worktree.patch'

  $bunCommand = Get-Command bun.exe -ErrorAction SilentlyContinue
  $bun = if ($bunCommand) { $bunCommand.Source } else { Join-Path $env:USERPROFILE '.bun\bin\bun.exe' }
  if (-not (Test-Path -LiteralPath $bun)) {
    throw "Bun $bunVersion is required."
  }
  $installedBunVersion = (& $bun --version).Trim()
  if ($installedBunVersion -ne $bunVersion) {
    throw "Bun $bunVersion is required to match CI. Found $installedBunVersion."
  }

  $gitCommand = Get-Command git.exe -ErrorAction SilentlyContinue
  $gitCandidates = @(
    $(if ($gitCommand) { $gitCommand.Source }),
    'C:\dev\tools\git-full\cmd\git.exe',
    'C:\Program Files\Git\cmd\git.exe'
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
  $git = $gitCandidates | Select-Object -First 1
  if (-not $git) { throw 'Git for Windows is required.' }

  $bashCandidates = @(
    'C:\dev\tools\git-full\bin\bash.exe',
    'C:\Program Files\Git\bin\bash.exe',
    (Join-Path (Split-Path -Parent (Split-Path -Parent $git)) 'bin\bash.exe')
  ) | Where-Object { Test-Path -LiteralPath $_ }
  $bash = $bashCandidates | Select-Object -First 1
  if (-not $bash) { throw 'Git Bash is required.' }

  $python = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Programs\Python') `
    -Filter python.exe -Recurse -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
  if (-not $python) {
    $pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($pythonCommand -and $pythonCommand.Source -notlike '*\WindowsApps\*') {
      $python = $pythonCommand.Source
    }
  }
  if (-not $python) {
    throw 'Python 3 is required. Install it with: winget install --id Python.Python.3.13 --exact --scope user'
  }

  $env:PATH = "$(Split-Path -Parent $git);$(Split-Path -Parent $bash);$(Split-Path -Parent $bun);$(Split-Path -Parent $python);$env:PATH"
  $env:ARCHON_BASH_PATH = $bash

  New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null
  $safeDirectories = @(& $git config --global --get-all safe.directory)
  foreach ($safeDirectory in @('%(prefix)///Mac/archon-src/', $source, (Join-Path $source '.git'))) {
    if ($safeDirectories -notcontains $safeDirectory) {
      & $git config --global --add safe.directory $safeDirectory
      Assert-LastExitCode 'Git safe-directory setup'
    }
  }
  if (Test-Path -LiteralPath $destination) {
    if (-not (Test-Path -LiteralPath (Join-Path $destination '.git'))) {
      throw "$destination exists but is not the managed Git checkout. Move it before this script runs."
    }
    Remove-Item -LiteralPath $destination -Recurse -Force
  }

  $sourceHead = $syncManifest.head
  & $git clone --no-checkout $bundleFile $destination
  Assert-LastExitCode 'Git clone'
  & $git -C $destination config core.protectNTFS false
  Assert-LastExitCode 'Git index compatibility setup'
  & $git -C $destination read-tree --reset $sourceHead
  Assert-LastExitCode 'Guest index reset'

  if ((Get-Item -LiteralPath $patchFile).Length -gt 0) {
    & $git -C $destination apply --cached --whitespace=nowarn $patchFile
    Assert-LastExitCode 'Host patch apply'
  }
  & $git -C $destination checkout-index --all --force
  Assert-LastExitCode 'Guest checkout materialization'
  & $git -C $destination reset --mixed --no-refresh $sourceHead
  Assert-LastExitCode 'Guest patch unstage'
  & $git -C $destination config core.protectNTFS true
  Assert-LastExitCode 'Git NTFS protection restore'

  $untrackedFiles = @($syncManifest.untracked)
  foreach ($relativePath in $untrackedFiles) {
    $target = Join-Path $destination $relativePath
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $source $relativePath) -Destination $target -Force
  }

  Set-Location $destination
  Invoke-BunCommand -Bun $bun -CommandArguments @('install', '--frozen-lockfile')

  $customArguments = @($BunArguments | Where-Object { $_ })
  if ($customArguments.Count -gt 0) {
    if ($customArguments[0] -eq 'bun') {
      $customArguments = @($customArguments | Select-Object -Skip 1)
    }
    if ($customArguments.Count -eq 0) { throw 'A command must follow bun.' }
    Invoke-BunCommand -Bun $bun -CommandArguments $customArguments
    return
  }

  $ciCommands = @(
    , @('run', 'check:bundled')
    , @('run', 'check:bundled-skill')
    , @('run', 'check:bundled-schema')
    , @('run', 'check:pi-vendor-map')
    , @('run', 'check:capability-matrix')
    , @('run', 'type-check')
    , @('run', 'lint', '--max-warnings', '0')
    , @('run', 'format:check')
    , @('run', 'test')
  )
  foreach ($ciCommand in $ciCommands) {
    Invoke-BunCommand -Bun $bun -CommandArguments $ciCommand
  }
}

try {
  Invoke-WindowsChecks
}
finally {
  Stop-Transcript | Out-Null
}
