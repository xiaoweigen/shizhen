$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$package = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$unpacked = Join-Path $projectRoot ($package.build.directories.output + '/win-unpacked')
$applicationPath = Join-Path $unpacked ($package.productName + '.exe')
if (-not (Test-Path -LiteralPath $applicationPath -PathType Leaf)) { throw 'Packaged application not found.' }
$launcherPrefix = [string][char]0x542f + [char]0x52a8
$shortcutPath = Join-Path $projectRoot ($launcherPrefix + $package.productName + '.lnk')
$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)
$shortcut.TargetPath = $applicationPath
$shortcut.WorkingDirectory = $unpacked
$shortcut.IconLocation = $applicationPath + ',0'
$shortcut.Description = $package.productName + ' ' + $package.version
$shortcut.Save()
Write-Output ('Launcher updated: ' + $shortcutPath)
