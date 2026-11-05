# DIOS Amplifier: sets up access keys on Vercel (run once, through setup-keys.bat).
# Makes a random KEY_SECRET and your admin login, stores them in Vercel, then redeploys.
$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot

function New-Random([int]$bytes) {
  $b = New-Object byte[] $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  return ([Convert]::ToBase64String($b) -replace '[+/=]', '')
}

Write-Host ''
Write-Host '=== DIOS Amplifier access keys ===' -ForegroundColor Magenta
$name = 'aadi'
$password = New-Random 18
$secret = New-Random 48

function Set-VercelEnv([string]$key, [string]$value) {
  foreach ($envName in @('production')) {
    npx vercel@latest env rm $key $envName -y 2>$null | Out-Null
    $value | npx vercel@latest env add $key $envName | Out-Null
  }
  Write-Host "  saved $key"
}

Write-Host ''
Write-Host 'Saving secrets to Vercel...'
Set-VercelEnv 'KEY_SECRET' $secret
Set-VercelEnv 'ADMINS' ("$name" + ':' + "$password")

$login = @"
DIOS Amplifier admin login (keep this private; it is not uploaded to GitHub)
Admin page: https://discord-amplifier.vercel.app/admin.html
Name: $name
Password: $password

Add more admins: in Vercel, Settings > Environment Variables > ADMINS, use
name1:password1,name2:password2   then redeploy.
Turn a key off: add its id to REVOKED_KEYS (comma separated), then redeploy.
"@
Set-Content -Path (Join-Path $PSScriptRoot 'admin-login.txt') -Value $login -Encoding UTF8

Write-Host ''
Write-Host 'Deploying...'
npx vercel@latest deploy --prod --yes

Write-Host ''
Write-Host 'Done. Your admin login is saved in admin-login.txt in this folder.' -ForegroundColor Green
Start-Process notepad.exe (Join-Path $PSScriptRoot 'admin-login.txt')
