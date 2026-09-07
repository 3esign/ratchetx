[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet("fast", "full")]
    [string]$Mode = "fast",

    [Parameter(Position = 1)]
    [ValidateSet("all", "core", "timepin")]
    [string]$Target = "all",

    [Parameter(Position = 2)]
    [string]$CargoBuildSbfExe = $env:RCX_CARGO_BUILD_SBF_EXE
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

$onchainRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$repositoryRoot = [IO.Path]::GetFullPath((Split-Path -Parent $onchainRoot))
$timepinRoot = Join-Path $onchainRoot "rcx-timepin-v2"
$coreRoot = Join-Path $onchainRoot "ratchet-core-g2"
$timepinManifest = Join-Path $timepinRoot "Cargo.toml"
$timepinProgramManifest = Join-Path $timepinRoot "programs\rcx-timepin-v2\Cargo.toml"
$timepinSvmManifest = Join-Path $timepinRoot "svm-tests\Cargo.toml"
$coreManifest = Join-Path $coreRoot "Cargo.toml"
$coreProgramManifest = Join-Path $coreRoot "programs\ratchet-core-g2\Cargo.toml"
$coreSvmManifest = Join-Path $coreRoot "svm-tests\Cargo.toml"
$timepinArtifact = Join-Path $timepinRoot "target\deploy\rcx_timepin_v2.so"
$coreArtifact = Join-Path $coreRoot "target\deploy\ratchet_core_g2.so"
$artifactVerifier = Join-Path $repositoryRoot "tools\verify-artifact.mjs"
$expectedBuilderVersion = "cargo-build-sbf 4.3.0"
$expectedSolanaCliVersion = "4.2.1"
$platformToolsVersion = "v1.56"
$expectedSbpfVersion = 3
$timepinProgramId = "C8wwxUGmoKAV22MaY3oW2Q6QeDbmB9dbNdbohsRjJkYp"
$historicalTimepinProgramId = "US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx"
$coreProgramId = "ANVGVtDrECeyQkS56UZ9ZiWCUxk2JWEVNJioFW8JEwbL"

function Invoke-CargoStep {
    param(
        [Parameter(Mandatory)] [string]$Label,
        [Parameter(Mandatory)] [string[]]$CargoArguments
    )

    $timer = [Diagnostics.Stopwatch]::StartNew()
    Write-Host "[run] $Label"
    & cargo @CargoArguments
    $exitCode = $LASTEXITCODE
    $timer.Stop()
    if ($exitCode -ne 0) {
        throw "$Label failed with exit code $exitCode after $($timer.Elapsed)"
    }
    Write-Host "[ok]  $Label ($($timer.Elapsed))"
}

function Assert-ElfArtifact {
    param([Parameter(Mandatory)] [string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Missing SBF artifact: $Path"
    }
    $stream = [IO.File]::OpenRead($Path)
    try {
        $header = [byte[]]::new(52)
        if ($stream.Read($header, 0, 52) -ne 52 -or
            $header[0] -ne 0x7f -or $header[1] -ne 0x45 -or
            $header[2] -ne 0x4c -or $header[3] -ne 0x46) {
            throw "Artifact is missing a complete ELF64 header: $Path"
        }
        if ($header[4] -ne 2 -or $header[5] -ne 1) {
            throw "Artifact must be a 64-bit little-endian ELF: $Path"
        }
        $elfFlags = [BitConverter]::ToUInt32($header, 48)
        if ($elfFlags -ne $expectedSbpfVersion) {
            throw "Artifact must be SBPFv$expectedSbpfVersion (ELF e_flags=$expectedSbpfVersion), observed $elfFlags`: $Path"
        }
    }
    finally {
        $stream.Dispose()
    }
}

function Build-SbfOnce {
    param(
        [Parameter(Mandatory)] [string]$Name,
        [Parameter(Mandatory)] [string]$Manifest,
        [Parameter(Mandatory)] [string]$Artifact,
        [Parameter(Mandatory)] [string]$Builder
    )

    if (Test-Path -LiteralPath $Artifact) {
        throw "Refusing to overwrite a pre-existing SBF artifact; use a fresh clean worktree: $Artifact"
    }
    $timer = [Diagnostics.Stopwatch]::StartNew()
    Write-Host "[run] cargo-build-sbf $Name --arch v3 --tools-version $platformToolsVersion --offline -- --locked (exactly once)"
    $buildOutput = @(& $Builder --manifest-path $Manifest --arch v3 --tools-version $platformToolsVersion --offline -- --locked 2>&1)
    $exitCode = $LASTEXITCODE
    $buildOutput | ForEach-Object { Write-Host $_ }
    $timer.Stop()
    if ($exitCode -ne 0) {
        throw "cargo-build-sbf $Name failed with exit code $exitCode after $($timer.Elapsed)"
    }
    $joinedOutput = $buildOutput -join [Environment]::NewLine
    if ($joinedOutput -match "Stack offset of .*exceeded max offset") {
        throw "cargo-build-sbf $Name exited zero but emitted an SBF stack-frame overflow"
    }
    Assert-ElfArtifact -Path $Artifact
    $hash = (Get-FileHash -LiteralPath $Artifact -Algorithm SHA256).Hash.ToLowerInvariant()
    Write-Host "[ok]  cargo-build-sbf $Name ($($timer.Elapsed))"
    Write-Host "SBF_SHA256 $Name $hash $Artifact"
    return $hash
}

function Copy-HashPinnedArtifact {
    param(
        [Parameter(Mandatory)] [string]$Source,
        [Parameter(Mandatory)] [string]$Hash
    )

    $normalizedHash = $Hash.ToLowerInvariant()
    $cacheRoot = Join-Path ([IO.Path]::GetTempPath()) "ratchetx-onchain-sbf"
    $cacheDirectory = Join-Path $cacheRoot $normalizedHash
    $destination = Join-Path $cacheDirectory ([IO.Path]::GetFileName($Source))
    if (-not (Test-Path -LiteralPath $cacheDirectory)) {
        $null = New-Item -ItemType Directory -Path $cacheDirectory
    }
    if (Test-Path -LiteralPath $destination -PathType Leaf) {
        $existingHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($existingHash -ne $normalizedHash) {
            throw "Hash-addressed SBF cache entry is corrupt: $destination"
        }
    }
    else {
        Copy-Item -LiteralPath $Source -Destination $destination
    }
    $copiedHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($copiedHash -ne $normalizedHash) {
        throw "SBF snapshot hash mismatch: $destination"
    }
    return [IO.Path]::GetFullPath($destination)
}

function Assert-ManifestToolPin {
    param([Parameter(Mandatory)] [string]$Path)

    $content = [IO.File]::ReadAllText($Path)
    $pin = [Regex]::Escape($platformToolsVersion)
    $matches = [Regex]::Matches(
        $content,
        "(?m)^\[package\.metadata\.solana\]\r?\n\s*tools-version\s*=\s*`"$pin`"\s*$"
    )
    if ($matches.Count -ne 1) {
        throw "Manifest must contain one exact [package.metadata.solana] tools-version = `"$platformToolsVersion`" pin: $Path"
    }
}

function Assert-CleanReleaseWorktree {
    $top = @(& git -C $repositoryRoot rev-parse --show-toplevel 2>&1)
    if ($LASTEXITCODE -ne 0 -or $top.Count -ne 1) {
        throw "Release runner must execute inside one Git worktree"
    }
    $resolvedTop = [IO.Path]::GetFullPath([string]$top[0])
    if ($resolvedTop.TrimEnd('\') -ne $repositoryRoot.TrimEnd('\')) {
        throw "Runner root $repositoryRoot does not equal Git root $resolvedTop"
    }
    $status = @(& git -C $repositoryRoot status --porcelain=v1 --untracked-files=all 2>&1)
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to inspect release worktree status"
    }
    if ($status.Count -ne 0) {
        throw "Full verification requires a clean committed release worktree; first entry: $($status[0])"
    }
    $commit = (& git -C $repositoryRoot rev-parse HEAD).Trim()
    $tree = (& git -C $repositoryRoot rev-parse 'HEAD^{tree}').Trim()
    Write-Host "SOURCE_COMMIT $commit"
    Write-Host "SOURCE_TREE $tree"
}

function Assert-ExactBuilder {
    if ([string]::IsNullOrWhiteSpace($CargoBuildSbfExe)) {
        throw "Full verification requires -CargoBuildSbfExe or RCX_CARGO_BUILD_SBF_EXE"
    }
    if (-not (Test-Path -LiteralPath $CargoBuildSbfExe -PathType Leaf)) {
        throw "Pinned cargo-build-sbf executable not found: $CargoBuildSbfExe"
    }
    $resolved = (Resolve-Path -LiteralPath $CargoBuildSbfExe).Path
    $version = @(& $resolved --version 2>&1)
    if ($LASTEXITCODE -ne 0 -or $version.Count -lt 1 -or [string]$version[0] -ne $expectedBuilderVersion) {
        throw "Expected $expectedBuilderVersion, observed: $($version -join ' | ')"
    }
    $solanaVersion = @(& solana --version 2>&1)
    if ($LASTEXITCODE -ne 0 -or ($solanaVersion -join ' ') -notmatch "^solana-cli $([Regex]::Escape($expectedSolanaCliVersion))\b") {
        throw "Expected solana-cli $expectedSolanaCliVersion, observed: $($solanaVersion -join ' | ')"
    }
    Write-Host "TOOLCHAIN_BUILDER $($version[0])"
    Write-Host "TOOLCHAIN_PLATFORM $platformToolsVersion"
    Write-Host "TOOLCHAIN_SOLANA $($solanaVersion -join ' ')"
    Write-Host "TOOLCHAIN_ARCH v$expectedSbpfVersion"
    return $resolved
}

function Invoke-ArtifactVerifier {
    param(
        [Parameter(Mandatory)] [string]$Path,
        [Parameter(Mandatory)] [string]$ProgramId,
        [Parameter(Mandatory)] [string]$Hash,
        [string]$ForbiddenProgramIds = ""
    )

    if (-not (Test-Path -LiteralPath $artifactVerifier -PathType Leaf)) {
        throw "Missing artifact verifier: $artifactVerifier"
    }
    $previousSbpf = [Environment]::GetEnvironmentVariable("EXPECT_SBPF", "Process")
    $previousContentAddress = [Environment]::GetEnvironmentVariable("REQUIRE_CONTENT_ADDRESS", "Process")
    $previousForbidden = [Environment]::GetEnvironmentVariable("FORBID_PROGRAM_IDS", "Process")
    try {
        [Environment]::SetEnvironmentVariable("EXPECT_SBPF", [string]$expectedSbpfVersion, "Process")
        [Environment]::SetEnvironmentVariable("REQUIRE_CONTENT_ADDRESS", "1", "Process")
        [Environment]::SetEnvironmentVariable("FORBID_PROGRAM_IDS", $ForbiddenProgramIds, "Process")
        $size = (Get-Item -LiteralPath $Path).Length
        & node $artifactVerifier $Path $ProgramId $Hash ([string]$size)
        if ($LASTEXITCODE -ne 0) {
            throw "Artifact tuple verification failed for $Path"
        }
    }
    finally {
        [Environment]::SetEnvironmentVariable("EXPECT_SBPF", $previousSbpf, "Process")
        [Environment]::SetEnvironmentVariable("REQUIRE_CONTENT_ADDRESS", $previousContentAddress, "Process")
        [Environment]::SetEnvironmentVariable("FORBID_PROGRAM_IDS", $previousForbidden, "Process")
    }
}

function Invoke-FormatAndHostTests {
    param([Parameter(Mandatory)] [string]$Selection)

    if ($Selection -in @("all", "timepin")) {
        Invoke-CargoStep -Label "fmt rcx-timepin-v2" -CargoArguments @("fmt", "--manifest-path", $timepinManifest, "--", "--check")
        Invoke-CargoStep -Label "fmt rcx-timepin-v2 SVM" -CargoArguments @("fmt", "--manifest-path", $timepinSvmManifest, "--", "--check")
        Invoke-CargoStep -Label "host tests rcx-timepin-v2" -CargoArguments @("test", "--manifest-path", $timepinManifest, "--lib", "--locked", "--offline")
    }
    if ($Selection -in @("all", "core")) {
        Invoke-CargoStep -Label "fmt ratchet-core-g2" -CargoArguments @("fmt", "--manifest-path", $coreManifest, "--", "--check")
        Invoke-CargoStep -Label "fmt ratchet-core-g2 SVM" -CargoArguments @("fmt", "--manifest-path", $coreSvmManifest, "--", "--check")
        Invoke-CargoStep -Label "host tests ratchet-core-g2" -CargoArguments @("test", "--manifest-path", $coreManifest, "--lib", "--locked", "--offline")
    }
}

$total = [Diagnostics.Stopwatch]::StartNew()
try {
    foreach ($requiredPath in @(
        $timepinManifest,
        $timepinProgramManifest,
        $timepinSvmManifest,
        $coreManifest,
        $coreProgramManifest,
        $coreSvmManifest,
        $artifactVerifier
    )) {
        if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
            throw "Missing manifest: $requiredPath"
        }
    }

    Write-Host "ONCHAIN_VERIFY mode=$Mode target=$Target root=$onchainRoot"
    $builder = $null
    if ($Mode -eq "full") {
        Assert-CleanReleaseWorktree
        Assert-ManifestToolPin -Path $timepinProgramManifest
        Assert-ManifestToolPin -Path $coreProgramManifest
        $builder = Assert-ExactBuilder
    }
    Invoke-FormatAndHostTests -Selection $Target

    if ($Mode -eq "fast") {
        if ($Target -in @("all", "timepin")) {
            Invoke-CargoStep -Label "check rcx-timepin-v2 SVM" -CargoArguments @("check", "--manifest-path", $timepinSvmManifest, "--all-targets", "--locked", "--offline")
        }
        if ($Target -in @("all", "core")) {
            Invoke-CargoStep -Label "check ratchet-core-g2 SVM" -CargoArguments @("check", "--manifest-path", $coreSvmManifest, "--all-targets", "--locked", "--offline")
        }
    }
    else {
        $timepinSnapshot = $null
        $timepinHash = $null
        if ($Target -in @("all", "timepin")) {
            $timepinHash = Build-SbfOnce `
                -Name "rcx-timepin-v2" `
                -Manifest $timepinManifest `
                -Artifact $timepinArtifact `
                -Builder $builder
            $timepinSnapshot = Copy-HashPinnedArtifact -Source $timepinArtifact -Hash $timepinHash
            Invoke-ArtifactVerifier `
                -Path $timepinSnapshot `
                -ProgramId $timepinProgramId `
                -Hash $timepinHash `
                -ForbiddenProgramIds $historicalTimepinProgramId
        }
        else {
            $configuredTimepin = [Environment]::GetEnvironmentVariable("RCX_TIMEPIN_V2_SO", "Process")
            if ([string]::IsNullOrWhiteSpace($configuredTimepin)) {
                throw "Full Core verification requires RCX_TIMEPIN_V2_SO to name an immutable hash-addressed C8 Timepin artifact"
            }
            $timepinSnapshot = (Resolve-Path -LiteralPath $configuredTimepin).Path
            Assert-ElfArtifact -Path $timepinSnapshot
            $timepinHash = (Get-FileHash -LiteralPath $timepinSnapshot -Algorithm SHA256).Hash.ToLowerInvariant()
            Invoke-ArtifactVerifier `
                -Path $timepinSnapshot `
                -ProgramId $timepinProgramId `
                -Hash $timepinHash `
                -ForbiddenProgramIds $historicalTimepinProgramId
            Write-Host "SBF_DEP_SHA256 rcx-timepin-v2 $timepinHash $timepinSnapshot"
        }

        $coreSnapshot = $null
        $coreHash = $null
        if ($Target -in @("all", "core")) {
            $coreHash = Build-SbfOnce `
                -Name "ratchet-core-g2" `
                -Manifest $coreManifest `
                -Artifact $coreArtifact `
                -Builder $builder
            $coreSnapshot = Copy-HashPinnedArtifact -Source $coreArtifact -Hash $coreHash
            Invoke-ArtifactVerifier `
                -Path $coreSnapshot `
                -ProgramId $coreProgramId `
                -Hash $coreHash `
                -ForbiddenProgramIds $historicalTimepinProgramId
        }
        Write-Host "SBF_PIN RCX_TIMEPIN_V2_SO=$timepinSnapshot"
        if ($null -ne $coreSnapshot) {
            Write-Host "SBF_PIN RATCHET_CORE_G2_SO=$coreSnapshot"
        }

        $previousTimepinSbf = [Environment]::GetEnvironmentVariable("RCX_TIMEPIN_V2_SO", "Process")
        $previousCoreSbf = [Environment]::GetEnvironmentVariable("RATCHET_CORE_G2_SO", "Process")
        try {
            [Environment]::SetEnvironmentVariable("RCX_TIMEPIN_V2_SO", $timepinSnapshot, "Process")
            if ($null -ne $coreSnapshot) {
                [Environment]::SetEnvironmentVariable("RATCHET_CORE_G2_SO", $coreSnapshot, "Process")
            }
            if ($Target -in @("all", "timepin")) {
                Invoke-CargoStep -Label "LiteSVM rcx-timepin-v2" -CargoArguments @("test", "--manifest-path", $timepinSvmManifest, "--tests", "--locked", "--offline")
            }
            if ($Target -in @("all", "core")) {
                Invoke-CargoStep -Label "LiteSVM ratchet-core-g2" -CargoArguments @("test", "--manifest-path", $coreSvmManifest, "--tests", "--locked", "--offline")
            }
        }
        finally {
            [Environment]::SetEnvironmentVariable("RCX_TIMEPIN_V2_SO", $previousTimepinSbf, "Process")
            [Environment]::SetEnvironmentVariable("RATCHET_CORE_G2_SO", $previousCoreSbf, "Process")
        }

        if ((Get-FileHash -LiteralPath $timepinSnapshot -Algorithm SHA256).Hash.ToLowerInvariant() -ne $timepinHash) {
            throw "A hash-pinned SBF snapshot changed during LiteSVM execution"
        }
        if ($null -ne $coreSnapshot -and
            (Get-FileHash -LiteralPath $coreSnapshot -Algorithm SHA256).Hash.ToLowerInvariant() -ne $coreHash) {
            throw "The hash-pinned Core SBF snapshot changed during LiteSVM execution"
        }
    }

    $total.Stop()
    Write-Host "ONCHAIN_VERIFY_OK mode=$Mode target=$Target elapsed=$($total.Elapsed)"
}
catch {
    $total.Stop()
    Write-Error "ONCHAIN_VERIFY_FAILED mode=$Mode target=$Target elapsed=$($total.Elapsed): $($_.Exception.Message)"
    exit 1
}
