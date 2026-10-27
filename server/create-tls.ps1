param([Parameter(Mandatory=$true)][string]$DataDir, [switch]$Demo)
$ErrorActionPreference = 'Stop'
# Storeless CertificateRequest: no trusted-root import or system certificate changes.
$continuerTokenFile = Join-Path $DataDir $(if ($Demo) { 'access-demo.token' } else { 'access-live.token' })
$continuerPassword = [IO.File]::ReadAllText($continuerTokenFile).Trim()
if ($continuerPassword -notmatch '^[a-f0-9]{64}$') { throw 'Invalid local credential' }
$continuerRsa = [Security.Cryptography.RSACng]::new(2048)
try {
    $continuerRequest = [Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=Continuer Local', $continuerRsa, [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pkcs1)
    # Subject Alternative Name: IP address 127.0.0.1 (DER SEQUENCE of IP).
    $continuerRequest.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509Extension]::new('2.5.29.17', [byte[]](48,6,135,4,127,0,0,1), $false))
    $continuerRequest.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false, $false, 0, $true))
    $continuerCertificate = $continuerRequest.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-5), [DateTimeOffset]::UtcNow.AddYears(2))
    try {
        $continuerPem = "-----BEGIN CERTIFICATE-----`n" + [Convert]::ToBase64String($continuerCertificate.RawData, [Base64FormattingOptions]::InsertLineBreaks) + "`n-----END CERTIFICATE-----`n"
        # Captured by Node's execFile pipe, never inherited by a console or log.
        @{ certificate=$continuerPem; pfx=[Convert]::ToBase64String($continuerCertificate.Export([Security.Cryptography.X509Certificates.X509ContentType]::Pfx, $continuerPassword)) } | ConvertTo-Json -Compress
    } finally { $continuerCertificate.Dispose() }
} finally { $continuerRsa.Dispose() }
