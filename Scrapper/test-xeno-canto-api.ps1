param(
    [string]$ScientificName,
    [string]$SpeciesCsv,
    [ValidateRange(1, 20)]
    [int]$SamplesPerSpecies = 5,
    [string]$OutputDirectory = ".\xeno-canto-dictionary",
    [Nullable[double]]$Latitude,
    [Nullable[double]]$Longitude
)

$ErrorActionPreference = "Stop"
$secureKey = $null
$pointer = [IntPtr]::Zero
$key = $null

function Get-ApiJson {
    param([Parameter(Mandatory = $true)][string]$Uri)
    try {
        return Invoke-RestMethod -Uri $Uri -Method Get -TimeoutSec 60 -UseBasicParsing
    }
    catch {
        $response = $_.Exception.Response
        if ($response) {
            $status = [int]$response.StatusCode
            $body = ""
            $stream = $null
            try { $stream = $response.GetResponseStream() }
            catch { }
            if ($stream) {
                $reader = New-Object System.IO.StreamReader($stream)
                try { $body = $reader.ReadToEnd() }
                finally { $reader.Dispose() }
            }
            elseif ($response.PSObject.Properties.Name -contains "Content") {
                try { $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult() }
                catch { }
            }
            if ($body) { throw "API request failed (HTTP $status): $body" }
            throw "API request failed (HTTP $status)."
        }
        throw "Could not connect to the API. Check your internet connection and try again."
    }
}

function Get-SafeName {
    param([string]$Value)
    $safe = [regex]::Replace($Value, '[^a-zA-Z0-9._-]+', '_').Trim('_')
    if (-not $safe) { return "species" }
    if ($safe.Length -gt 100) { return $safe.Substring(0, 100) }
    return $safe
}

function Get-DownloadExtension {
    param(
        [string]$Url,
        [string]$ContentType,
        [string]$Fallback
    )
    try {
        $extension = [IO.Path]::GetExtension(([uri]$Url).AbsolutePath).TrimStart(".")
        if ($extension -match '^[a-zA-Z0-9]{2,5}$') { return $extension.ToLowerInvariant() }
    }
    catch {
        # Use the content type or fallback when a media URL has no usable extension.
    }
    $type = ($ContentType -split ";")[0].ToLowerInvariant()
    switch ($type) {
        "audio/mpeg" { return "mp3" }
        "audio/mp4" { return "m4a" }
        "image/jpeg" { return "jpg" }
        "image/png" { return "png" }
        "image/webp" { return "webp" }
        default { return $Fallback }
    }
}

function Save-RemoteFile {
    param(
        [Parameter(Mandatory = $true)][string]$Uri,
        [Parameter(Mandatory = $true)][string]$Path
    )
    if (-not $Uri -or $Uri -notmatch '^https://') {
        throw "The source did not provide a valid HTTPS media URL."
    }
    $temporaryPath = "$Path.download"
    try {
        Invoke-WebRequest -Uri $Uri -Method Get -OutFile $temporaryPath -TimeoutSec 180 -UseBasicParsing
        if (-not (Test-Path -LiteralPath $temporaryPath) -or (Get-Item -LiteralPath $temporaryPath).Length -eq 0) {
            throw "The server returned an empty file."
        }
        Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
    }
    catch {
        Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
        throw
    }
}

function Get-RecordingQuery {
    param([string]$Name)
    $parts = $Name.Trim() -split '\s+'
    if ($parts.Count -lt 2) {
        throw "Enter a scientific name with at least genus and species, e.g. Corvus corax."
    }
    $genus = [uri]::EscapeDataString(('gen:"=' + $parts[0] + '"'))
    $species = [uri]::EscapeDataString(('sp:"=' + $parts[1] + '"'))
    $query = "$genus%20$species%20grp:birds"
    if ($null -ne $Latitude -and $null -ne $Longitude) {
        $culture = [Globalization.CultureInfo]::InvariantCulture
        $lat = ([double]$Latitude).ToString("0.#####", $culture)
        $lon = ([double]$Longitude).ToString("0.#####", $culture)
        $query += "%20lat:$lat%20lon:$lon"
    }
    return $query
}

try {
    if (($null -eq $Latitude) -xor ($null -eq $Longitude)) {
        throw "Provide both -Latitude and -Longitude, or neither."
    }
    if ($null -ne $Latitude -and ([double]$Latitude -lt -90 -or [double]$Latitude -gt 90)) {
        throw "Latitude must be between -90 and 90."
    }
    if ($null -ne $Longitude -and ([double]$Longitude -lt -180 -or [double]$Longitude -gt 180)) {
        throw "Longitude must be between -180 and 180."
    }

    $secureKey = Read-Host "Xeno-canto API key" -AsSecureString
    if ($secureKey.Length -eq 0) {
        throw "No API key was entered."
    }
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
    $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)

    $testQuery = [uri]::EscapeDataString('gen:"=Corvus" sp:"=corax" grp:birds')
    $testUri = "https://xeno-canto.org/api/3/recordings?query=$testQuery&key=$([uri]::EscapeDataString($key))&per_page=1"
    try {
        $testResult = Get-ApiJson -Uri $testUri
    }
    catch {
        throw "Xeno-canto API test failed. Check your key and connection. $($_.Exception.Message)"
    }
    Write-Host "Xeno-canto API request succeeded."
    Write-Host "Test species: Common Raven (Corvus corax)"
    Write-Host "Recordings in Xeno-canto: $($testResult.numRecordings)"

    $speciesNames = @()
    if ($SpeciesCsv) {
        if (-not (Test-Path -LiteralPath $SpeciesCsv -PathType Leaf)) {
            throw "CSV file not found: $SpeciesCsv"
        }
        $csvRows = Import-Csv -LiteralPath $SpeciesCsv
        foreach ($row in $csvRows) {
            $nameProperty = $row.PSObject.Properties | Where-Object {
                $_.Name -match '^(scientific_?name|scientific name|species|taxon)$'
            } | Select-Object -First 1
            if (-not $nameProperty) {
                throw "CSV needs a column named ScientificName, Scientific Name, Species, or Taxon."
            }
            $name = ([string]$nameProperty.Value).Trim()
            if ($name) { $speciesNames += $name }
        }
    }
    else {
        if (-not $ScientificName) {
            $ScientificName = Read-Host "Species scientific name to download (Enter for Corvus corax)"
            if (-not $ScientificName.Trim()) { $ScientificName = "Corvus corax" }
        }
        $speciesNames = @($ScientificName.Trim())
    }

    $speciesNames = @($speciesNames | Select-Object -Unique)
    if (-not $speciesNames.Count) {
        throw "No scientific names were found to download."
    }

    if (-not $SpeciesCsv) {
        $sampleText = Read-Host "Random recordings per species (1-20, default $SamplesPerSpecies)"
        if ($sampleText) {
            $parsedSamples = 0
            if (-not [int]::TryParse($sampleText, [ref]$parsedSamples) -or $parsedSamples -lt 1 -or $parsedSamples -gt 20) {
                throw "Enter a whole number from 1 to 20."
            }
            $SamplesPerSpecies = $parsedSamples
        }
    }

    $resolvedOutput = [IO.Path]::GetFullPath($OutputDirectory)
    if (-not (Test-Path -LiteralPath $resolvedOutput)) {
        New-Item -ItemType Directory -Path $resolvedOutput -Force | Out-Null
    }

    $manifest = [ordered]@{
        createdAt = (Get-Date).ToUniversalTime().ToString("o")
        group = "Birds"
        samplesPerSpecies = $SamplesPerSpecies
        location = if ($null -ne $Latitude) {
            @{ latitude = [double]$Latitude; longitude = [double]$Longitude; note = "Xeno-canto coordinate search is approximate (about one degree), not the app's map radius." }
        } else { $null }
        species = @()
        issues = @()
    }

    foreach ($name in $speciesNames) {
        Write-Host ""
        Write-Host "Searching $name..."
        $speciesFolder = Join-Path $resolvedOutput (Get-SafeName -Value $name)
        New-Item -ItemType Directory -Path $speciesFolder -Force | Out-Null
        $entry = [ordered]@{
            scientificName = $name
            requestedSamples = $SamplesPerSpecies
            availableRecordings = 0
            taxonomy = $null
            descriptions = @()
            image = $null
            recordings = @()
            issues = @()
        }

        try {
            $query = Get-RecordingQuery -Name $name
            $searchUri = "https://xeno-canto.org/api/3/recordings?query=$query&key=$([uri]::EscapeDataString($key))&per_page=500"
            $search = Get-ApiJson -Uri $searchUri
            $entry.availableRecordings = [int]$search.numRecordings
            Write-Host "  Xeno-canto recordings matching query: $($entry.availableRecordings)"
            if ($entry.availableRecordings -gt 0) {
                $pageCount = [math]::Max(1, [int]$search.numPages)
                $page = Get-Random -Minimum 1 -Maximum ($pageCount + 1)
                if ($page -eq 1) {
                    $recordings = @($search.recordings)
                }
                else {
                    $pageUri = "https://xeno-canto.org/api/3/recordings?query=$query&key=$([uri]::EscapeDataString($key))&per_page=500&page=$page"
                    $pageResult = Get-ApiJson -Uri $pageUri
                    $recordings = @($pageResult.recordings)
                }
                $chosen = @($recordings | Sort-Object { Get-Random } | Select-Object -First ([math]::Min($SamplesPerSpecies, $recordings.Count)))
                if ($chosen.Count -lt [math]::Min($SamplesPerSpecies, $entry.availableRecordings)) {
                    $entry.issues += "Only $($chosen.Count) unique recordings were returned for the requested sample count."
                }

                foreach ($recording in $chosen) {
                    $recordingId = [string]$recording.id
                    if (-not $recordingId) { $recordingId = "recording-$($entry.recordings.Count + 1)" }
                    $safeId = Get-SafeName -Value $recordingId
                    $recordingEntry = [ordered]@{
                        id = $recordingId
                        recordist = $recording.rec
                        date = $recording.date
                        country = $recording.cnt
                        locality = $recording.loc
                        quality = $recording.q
                        length = $recording.length
                        license = $recording.lic
                        sourcePage = "https://xeno-canto.org/$recordingId"
                        audioSource = $recording.file
                        audioFile = $null
                        spectrogramSource = $null
                        spectrogramFile = $null
                    }

                    if ($recording.file) {
                        try {
                            $audioPath = Join-Path $speciesFolder "$safeId.mp3"
                            Save-RemoteFile -Uri ([string]$recording.file) -Path $audioPath
                            $recordingEntry.audioFile = Split-Path -Leaf $audioPath
                            Write-Host "  Downloaded audio: $($recordingEntry.audioFile)"
                        }
                        catch {
                            $message = "XC$recordingId audio download failed: $($_.Exception.Message)"
                            $entry.issues += $message
                            Write-Warning $message
                        }
                    }
                    else {
                        $entry.issues += "XC$recordingId did not provide an audio URL."
                    }

                    $spectrogramUrl = $null
                    if ($recording.sono) {
                        $spectrogramUrl = $recording.sono.large
                        if (-not $spectrogramUrl) { $spectrogramUrl = $recording.sono.med }
                    }
                    if ($spectrogramUrl) {
                        try {
                            $response = Invoke-WebRequest -Uri ([string]$spectrogramUrl) -Method Get -OutFile (Join-Path $speciesFolder "$safeId.spectrogram") -PassThru -TimeoutSec 120 -UseBasicParsing
                            $spectrogramPath = Join-Path $speciesFolder "$safeId.spectrogram"
                            $extension = Get-DownloadExtension -Url ([string]$spectrogramUrl) -ContentType ([string]$response.Headers["Content-Type"]) -Fallback "jpg"
                            $finalSpectrogramPath = Join-Path $speciesFolder "$safeId.spectrogram.$extension"
                            Move-Item -LiteralPath $spectrogramPath -Destination $finalSpectrogramPath -Force
                            $recordingEntry.spectrogramSource = [string]$spectrogramUrl
                            $recordingEntry.spectrogramFile = Split-Path -Leaf $finalSpectrogramPath
                            Write-Host "  Downloaded spectrogram: $($recordingEntry.spectrogramFile)"
                        }
                        catch {
                            $message = "XC$recordingId spectrogram download failed: $($_.Exception.Message)"
                            $entry.issues += $message
                            Remove-Item -LiteralPath (Join-Path $speciesFolder "$safeId.spectrogram") -Force -ErrorAction SilentlyContinue
                            Remove-Item -LiteralPath (Join-Path $speciesFolder "$safeId.spectrogram.download") -Force -ErrorAction SilentlyContinue
                            Write-Warning $message
                        }
                    }
                    $entry.recordings += $recordingEntry
                }
            }

            try {
                $matchUri = "https://api.gbif.org/v1/species/match?name=$([uri]::EscapeDataString($name))"
                $match = Get-ApiJson -Uri $matchUri
                if ($match.usageKey) {
                    $gbifUri = "https://api.gbif.org/v1/species/$($match.usageKey)"
                    $taxon = Get-ApiJson -Uri $gbifUri
                    $entry.taxonomy = $taxon
                    Write-Host "  GBIF species information found (key $($match.usageKey))."
                    $descriptionsUri = "https://api.gbif.org/v1/species/$($match.usageKey)/descriptions?limit=10"
                    try {
                        $descriptionResult = Get-ApiJson -Uri $descriptionsUri
                        $entry.descriptions = @($descriptionResult.results)
                    }
                    catch {
                        $entry.issues += "GBIF species descriptions unavailable: $($_.Exception.Message)"
                    }

                    $mediaUri = "https://api.gbif.org/v1/species/$($match.usageKey)/media?limit=20"
                    try {
                        $mediaResult = Get-ApiJson -Uri $mediaUri
                        $media = @($mediaResult.results | Where-Object { $_.identifier } | Select-Object -First 1)
                        if ($media.Count -gt 0) {
                            $mediaItem = $media[0]
                            $entry.image = [ordered]@{
                                sourceUrl = $mediaItem.identifier
                                title = $mediaItem.title
                                creator = $mediaItem.creator
                                license = if ($mediaItem.license) { $mediaItem.license } else { $mediaItem.rights }
                                attribution = $mediaItem.rightsHolder
                                file = $null
                            }
                            try {
                                $imageTempPath = Join-Path $speciesFolder "species-image"
                                $imageResponse = Invoke-WebRequest -Uri ([string]$mediaItem.identifier) -Method Get -OutFile $imageTempPath -PassThru -TimeoutSec 120 -UseBasicParsing
                                $extension = Get-DownloadExtension -Url ([string]$mediaItem.identifier) -ContentType ([string]$imageResponse.Headers["Content-Type"]) -Fallback "jpg"
                                $imagePath = Join-Path $speciesFolder "species-image.$extension"
                                Move-Item -LiteralPath $imageTempPath -Destination $imagePath -Force
                                $entry.image.file = Split-Path -Leaf $imagePath
                                Write-Host "  Downloaded species image: $($entry.image.file)"
                            }
                            catch {
                                $entry.issues += "Species image download failed: $($_.Exception.Message)"
                                Remove-Item -LiteralPath (Join-Path $speciesFolder "species-image") -Force -ErrorAction SilentlyContinue
                                Write-Warning "Species image download failed: $($_.Exception.Message)"
                            }
                        }
                    }
                    catch {
                        $entry.issues += "GBIF species image lookup failed: $($_.Exception.Message)"
                    }
                }
                else {
                    $entry.issues += "GBIF did not find a matching species record."
                    Write-Host "  GBIF species information not found."
                }
            }
            catch {
                $entry.issues += "GBIF lookup failed: $($_.Exception.Message)"
                Write-Warning "GBIF information could not be retrieved: $($_.Exception.Message)"
            }
        }
        catch {
            $entry.issues += "Xeno-canto search failed: $($_.Exception.Message)"
            Write-Warning "Search failed for $name`: $($_.Exception.Message)"
        }

        $metadataPath = Join-Path $speciesFolder "species.json"
        $entry | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $metadataPath -Encoding UTF8
        $manifest.species += $entry
        foreach ($issue in $entry.issues) {
            $manifest.issues += "$name`: $issue"
        }
    }

    $manifestPath = Join-Path $resolvedOutput "manifest.json"
    $manifest | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
    $readmePath = Join-Path $resolvedOutput "README.txt"
    @(
        "Fieldnotes Xeno-canto download"
        "Created: $($manifest.createdAt)"
        "Species: $($manifest.species.Count)"
        "Requested recordings per species: $SamplesPerSpecies"
        "Location search: $(if ($null -ne $Latitude) { 'approximate coordinates supplied' } else { 'worldwide' })"
        ""
        "Audio recordings and spectrograms are from Xeno-canto. Each recording license, recordist and source page are in species.json and manifest.json."
        "Species details, descriptions, and available image rights information are from GBIF."
        "Review license and attribution terms before reuse or redistribution."
        "Issues: $($manifest.issues.Count). See manifest.json."
    ) | Set-Content -LiteralPath $readmePath -Encoding UTF8

    $downloadedAudio = @($manifest.species | ForEach-Object { $_.recordings } | Where-Object { $_.audioFile }).Count
    $downloadedSpectrograms = @($manifest.species | ForEach-Object { $_.recordings } | Where-Object { $_.spectrogramFile }).Count
    Write-Host ""
    Write-Host "Download complete."
    Write-Host "Species processed: $($manifest.species.Count)"
    Write-Host "Audio files downloaded: $downloadedAudio"
    Write-Host "Spectrogram files downloaded: $downloadedSpectrograms"
    Write-Host "Issues logged: $($manifest.issues.Count)"
    Write-Host "Output folder: $resolvedOutput"
    Write-Host "Manifest: $manifestPath"
    if ($manifest.issues.Count -gt 0) {
        Write-Warning "Some resources were unavailable; see manifest.json and species subfolders for details."
    }
}
catch {
    Write-Error $_.Exception.Message
    exit 1
}
finally {
    if ($pointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
    if ($secureKey) {
        $secureKey.Dispose()
    }
    $key = $null
    $testUri = $null
    $searchUri = $null
    $pageUri = $null
}
