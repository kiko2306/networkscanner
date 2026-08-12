$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$scannerSource = Join-Path $repoRoot "network-scanner.ps1"
$outputDir = Join-Path $repoRoot "view\download"
$outputFile = Join-Path $outputDir "network-scanner.exe"
$launcherPs1 = Join-Path $outputDir "network-scanner-launcher.ps1"

if (-not (Test-Path $scannerSource)) {
    throw "Input script not found: $scannerSource"
}

New-Item -ItemType Directory -Path $outputDir -Force | Out-Null

$scannerBase64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($scannerSource))

$launcherContent = @"
`$ErrorActionPreference = "Stop"
`$PassThroughArgs = @(`$args)

`$scriptBytes = [Convert]::FromBase64String("$scannerBase64")
`$launchDir = [System.AppContext]::BaseDirectory
`$scannerPath = Join-Path `$launchDir "network-scanner.runtime.ps1"

try {
    [System.IO.File]::WriteAllBytes(`$scannerPath, `$scriptBytes)
} catch {
    `$fallbackDir = Join-Path `$env:TEMP "network-scanner"
    New-Item -ItemType Directory -Path `$fallbackDir -Force | Out-Null
    `$scannerPath = Join-Path `$fallbackDir "network-scanner.runtime.ps1"
    [System.IO.File]::WriteAllBytes(`$scannerPath, `$scriptBytes)
}

`$pwshCommand = Get-Command -Name "pwsh.exe" -ErrorAction SilentlyContinue
if (`$pwshCommand) {
    `$shellExe = `$pwshCommand.Source
    `$engineLabel = "PowerShell 7 (pwsh)"
} else {
    `$shellExe = (Get-Command -Name "powershell.exe" -ErrorAction Stop).Source
    `$engineLabel = "Windows PowerShell 5.1"
}

Write-Host "Starting network scanner using `$engineLabel..." -ForegroundColor Cyan

if (`$null -eq `$PassThroughArgs) {
    `$PassThroughArgs = @()
}

`$arguments = @("-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", `$scannerPath)
if (`$PassThroughArgs.Count -gt 0) {
    `$arguments += `$PassThroughArgs
}

Push-Location `$launchDir
try {
    & `$shellExe @arguments
    exit `$LASTEXITCODE
} catch {
    Write-Host "ERROR: `$(`$_.Exception.Message)" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
} finally {
    Pop-Location
}
"@

Set-Content -Path $launcherPs1 -Value $launcherContent -Encoding UTF8

Set-PSRepository PSGallery -InstallationPolicy Trusted
Install-Module -Name ps2exe -Scope CurrentUser -Force
Invoke-PS2EXE -InputFile $launcherPs1 -OutputFile $outputFile

Write-Host "Scanner executable generated: $outputFile"
