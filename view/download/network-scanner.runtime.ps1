param(
    [string[]]$SubnetRanges = @(),
    [string]$SubnetRange = "",
    [string]$MapName,
    [string]$ApiBaseUrl = "https://api-lan-map.portoinf-server.com/",
    [string]$ApiKey = "c3f1d5b8e6a44f4d8f8e3f2b1a9c6d70",
    [int]$ApiTimeoutSec = 120,
    [string]$OutputFolder = "output",
    [string]$OutputFileName = "NetworkHierarchy.json",
    [switch]$EnableSnmpDiscovery,
    [string]$SnmpCommunity = "public",
    [int]$SnmpTimeoutMs = 1500,
    [int[]]$CommonTcpPorts = @(22, 23, 53, 80, 443, 445, 3389, 9100),
    [switch]$SkipPortScan,
    [int]$HostDiscoveryBatchSize = 32,
    [int]$PortConnectTimeoutMs = 1200,
    [int]$PortScanThrottle = 16
)

$script:VendorCache = @{}
$script:LocalIPv4Cache = $null
$script:ProgressFallbackState = @{}
$ProgressPreference = "Continue"
if ($PSVersionTable.PSVersion.Major -ge 7) {
    try {
        $PSStyle.Progress.View = "Classic"
    } catch {
    }
}

function Write-ScannerProgress {
    param(
        [int]$Id,
        [string]$Activity,
        [string]$Status = "",
        [int]$PercentComplete = -1,
        [int]$ParentId = -1,
        [switch]$Completed
    )

    if ($ParentId -ge 0) {
        if ($Completed) {
            Write-Progress -Id $Id -ParentId $ParentId -Activity $Activity -Completed
        } else {
            Write-Progress -Id $Id -ParentId $ParentId -Activity $Activity -Status $Status -PercentComplete $PercentComplete
        }
    } else {
        if ($Completed) {
            Write-Progress -Id $Id -Activity $Activity -Completed
        } else {
            Write-Progress -Id $Id -Activity $Activity -Status $Status -PercentComplete $PercentComplete
        }
    }

    if ($Completed) {
        if ($script:ProgressFallbackState.ContainsKey($Id)) {
            $script:ProgressFallbackState.Remove($Id)
        }
        Write-Host "[Done] $Activity" -ForegroundColor DarkGray
        return
    }

    $Now = Get-Date
    $State = $script:ProgressFallbackState[$Id]
    $ShouldLog = $false

    if (-not $State) {
        $ShouldLog = $true
    } else {
        $DeltaPct = [Math]::Abs(($PercentComplete -as [int]) - ($State.Percent -as [int]))
        $DeltaSeconds = ($Now - $State.At).TotalSeconds
        if ($DeltaPct -ge 10 -or $DeltaSeconds -ge 2 -or $Status -ne $State.Status) {
            $ShouldLog = $true
        }
    }

    if ($ShouldLog) {
        if ($PercentComplete -ge 0) {
            Write-Host ("[{0,3}%] {1} - {2}" -f $PercentComplete, $Activity, $Status) -ForegroundColor DarkGray
        } else {
            Write-Host ("[ ... ] {0} - {1}" -f $Activity, $Status) -ForegroundColor DarkGray
        }
        $script:ProgressFallbackState[$Id] = @{
            Percent = $PercentComplete
            Status = $Status
            At = $Now
        }
    }
}

function Get-MacVendor {
    param(
        [string]$MacAddress
    )

    if ($MacAddress -eq "Unknown") { return "Unknown Vendor" }

    $NormalizedMac = $MacAddress.Replace("-", ":").ToUpperInvariant()
    $Oui = if ($NormalizedMac.Length -ge 8) { $NormalizedMac.Substring(0, 8) } else { $NormalizedMac }

    if ($script:VendorCache.ContainsKey($Oui)) {
        return $script:VendorCache[$Oui]
    }

    try {
        $Vendor = Invoke-RestMethod -Uri "https://api.macvendors.com/$NormalizedMac" -Method Get -TimeoutSec 4 -ErrorAction Stop
        if ($Vendor) {
            $script:VendorCache[$Oui] = [string]$Vendor
            return [string]$Vendor
        }
    } catch {}

    $script:VendorCache[$Oui] = "Unknown Vendor"

    return "Unknown Vendor"
}

function Get-SnmpSysName {
    param(
        [string]$IPAddress,
        [string]$Community,
        [int]$TimeoutMs
    )

    $GetSnmpCommand = Get-Command -Name Get-SNMP -ErrorAction SilentlyContinue
    if (-not $GetSnmpCommand) { return $null }

    try {
        $Response = Get-SNMP -IPAddress $IPAddress -Community $Community -OID "1.3.6.1.2.1.1.5.0" -TimeOut $TimeoutMs -ErrorAction Stop
        if (-not $Response) { return $null }

        if ($Response.PSObject.Properties.Name -contains "Data") { return [string]$Response.Data }
        if ($Response.PSObject.Properties.Name -contains "Value") { return [string]$Response.Value }

        return [string]$Response
    } catch {
        return $null
    }
}

function Get-LocalIPv4Addresses {
    if ($null -ne $script:LocalIPv4Cache) {
        return $script:LocalIPv4Cache
    }

    $LocalAddresses = @()

    try {
        $LocalAddresses = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
            Where-Object {
                $_.IPAddress -and
                $_.IPAddress -notlike '127.*' -and
                $_.IPAddress -notlike '169.254.*'
            } |
            Select-Object -ExpandProperty IPAddress)
    } catch {
        $LocalAddresses = @()
    }

    $script:LocalIPv4Cache = @($LocalAddresses | Sort-Object -Unique)
    return $script:LocalIPv4Cache
}

function Resolve-DeviceHostName {
    param(
        [string]$IPAddress
    )

    if ((Get-LocalIPv4Addresses) -contains $IPAddress) {
        return Normalize-DeviceName -Name $env:COMPUTERNAME
    }

    try {
        $ResolvedName = [System.Net.Dns]::GetHostEntry($IPAddress).HostName
        if ([string]::IsNullOrWhiteSpace($ResolvedName)) {
            return "Unknown-Device"
        }

        if ($ResolvedName -match '(?i)(^|\.)host\.docker\.internal$|(^|\.)docker\.internal$') {
            return "Unknown-Device"
        }

        return $ResolvedName
    } catch {
        return "Unknown-Device"
    }
}

function Test-UsableDeviceName {
    param(
        [string]$Name
    )

    if ([string]::IsNullOrWhiteSpace($Name)) {
        return $false
    }

    if ($Name -eq "Unknown-Device") {
        return $false
    }

    if ($Name -match '(?i)(^|\.)host\.docker\.internal$|(^|\.)docker\.internal$|^localhost(\.|$)') {
        return $false
    }

    return $true
}

function Get-PreferredDeviceName {
    param(
        [string]$DnsName,
        [string]$SnmpName
    )

    if (Test-UsableDeviceName -Name $DnsName) {
        return $DnsName
    }

    if (Test-UsableDeviceName -Name $SnmpName) {
        return $SnmpName
    }

    return "Unknown-Device"
}

function Normalize-DeviceName {
    param(
        [string]$Name
    )

    if (-not (Test-UsableDeviceName -Name $Name)) {
        return "Unknown-Device"
    }

    if ($Name -match '^[^.]+\.[^.]+$|^[^.]+\.[^.]+\.[^.]+$|^[^.]+\.[^.]+\.[^.]+\.[^.]+$') {
        return ($Name.Split('.')[0])
    }

    return $Name
}

function Get-PingStats {
    param(
        [string]$IPAddress,
        [int]$Count = 4
    )

    $Replies = Test-Connection -ComputerName $IPAddress -Count $Count -ErrorAction SilentlyContinue
    $ReplyCount = @($Replies).Count
    $LossPct = [math]::Round((($Count - $ReplyCount) / $Count) * 100, 2)

    $Times = @()
    foreach ($Reply in @($Replies)) {
        if ($Reply.PSObject.Properties.Name -contains "ResponseTime") {
            $Times += [double]$Reply.ResponseTime
        } elseif ($Reply.PSObject.Properties.Name -contains "Latency") {
            $Times += [double]$Reply.Latency
        }
    }

    if ($Times.Count -eq 0) {
        return @{
            Sent = $Count
            Received = $ReplyCount
            PacketLossPct = $LossPct
            MinMs = $null
            AvgMs = $null
            MaxMs = $null
        }
    }

    return @{
        Sent = $Count
        Received = $ReplyCount
        PacketLossPct = $LossPct
        MinMs = [math]::Round(($Times | Measure-Object -Minimum).Minimum, 2)
        AvgMs = [math]::Round(($Times | Measure-Object -Average).Average, 2)
        MaxMs = [math]::Round(($Times | Measure-Object -Maximum).Maximum, 2)
    }
}

function Get-OpenTcpPorts {
    param(
        [string]$IPAddress,
        [int[]]$Ports,
        [int]$ParentProgressId,
        [int]$ProgressId,
        [int]$ConnectTimeoutMs = 1200,
        [int]$Throttle = 16
    )

    Write-ScannerProgress -Id $ProgressId -ParentId $ParentProgressId -Activity "Port scan" -Status "Checking ${IPAddress}" -PercentComplete 10

    if ($PSVersionTable.PSVersion.Major -ge 7) {
        $OpenPorts = @(
            $Ports | ForEach-Object -Parallel {
                $Port = $_
                $Client = [System.Net.Sockets.TcpClient]::new()
                try {
                    $ConnectTask = $Client.ConnectAsync($using:IPAddress, $Port)
                    if ($ConnectTask.Wait($using:ConnectTimeoutMs) -and $Client.Connected) {
                        $Port
                    }
                } catch {
                } finally {
                    $Client.Dispose()
                }
            } -ThrottleLimit $Throttle
        )
    } else {
        $OpenPorts = @()
        $PortCount = $Ports.Count
        for ($p = 0; $p -lt $PortCount; $p++) {
            $Port = $Ports[$p]
            $Pct = [int]((($p + 1) / $PortCount) * 100)
            Write-ScannerProgress -Id $ProgressId -ParentId $ParentProgressId -Activity "Port scan" -Status "Checking ${IPAddress}:$Port" -PercentComplete $Pct

            $Client = [System.Net.Sockets.TcpClient]::new()
            try {
                $ConnectTask = $Client.ConnectAsync($IPAddress, $Port)
                if ($ConnectTask.Wait($ConnectTimeoutMs) -and $Client.Connected) {
                    $OpenPorts += $Port
                }
            } catch {
            } finally {
                $Client.Dispose()
            }
        }
    }

    Write-ScannerProgress -Id $ProgressId -ParentId $ParentProgressId -Activity "Port scan" -Completed

    return @($OpenPorts | Sort-Object -Unique)
}

function Get-ActiveIpsFromSubnet {
    param(
        [string[]]$Targets,
        [int]$BatchSize = 32
    )

    $Live = @()
    $Total = $Targets.Count
    if ($Total -eq 0) { return $Live }

    if ($PSVersionTable.PSVersion.Major -lt 7) {
        for ($i = 0; $i -lt $Total; $i++) {
            $Pct = [int]((($i + 1) / $Total) * 100)
            Write-ScannerProgress -Id 1 -Activity "Scanning subnet" -Status "Pinging $($Targets[$i])" -PercentComplete $Pct
            if (Test-Connection -ComputerName $Targets[$i] -Count 1 -Quiet -ErrorAction SilentlyContinue) {
                $Live += $Targets[$i]
            }
        }
        Write-ScannerProgress -Id 1 -Activity "Scanning subnet" -Completed
        return $Live
    }

    $EffectiveBatch = [Math]::Max(1, [Math]::Min($BatchSize, $Total))
    $Processed = 0

    for ($offset = 0; $offset -lt $Total; $offset += $EffectiveBatch) {
        $End = [Math]::Min($offset + $EffectiveBatch - 1, $Total - 1)
        $Batch = $Targets[$offset..$End]

        $BatchLive = @(
            $Batch | ForEach-Object -Parallel {
                if (Test-Connection -ComputerName $_ -Count 1 -Quiet -ErrorAction SilentlyContinue) {
                    $_
                }
            } -ThrottleLimit $Batch.Count
        )

        if ($BatchLive.Count -gt 0) {
            $Live += $BatchLive
        }

        $Processed += $Batch.Count
        $Pct = [int](($Processed / $Total) * 100)
        Write-ScannerProgress -Id 1 -Activity "Scanning subnet" -Status "Processed $Processed of $Total" -PercentComplete $Pct
    }

    Write-ScannerProgress -Id 1 -Activity "Scanning subnet" -Completed
    return @($Live | Sort-Object -Unique)
}

function Get-RoleGuess {
    param(
        [string]$HostName,
        [string]$DeviceType,
        [int[]]$OpenPorts,
        [string]$Vendor
    )

    $NameAndVendor = "$HostName $Vendor"

    if ($DeviceType -eq "Managed-Network-Device") {
        if ($NameAndVendor -match "(?i)(ap|wifi|wlan|access[\s-]*point)") { return "Access-Point" }
        if ($OpenPorts -contains 53) { return "Router" }
        return "Managed-Switch-Or-Appliance"
    }

    if ($OpenPorts -contains 9100) { return "Printer" }
    if ($NameAndVendor -match "(?i)(ap|wifi|wlan|access[\s-]*point|ubiquiti|unifi|tplink|tp-link|aruba|ruckus)") { return "Access-Point" }
    if (($OpenPorts -contains 80 -or $OpenPorts -contains 443) -and $NameAndVendor -match "(?i)(netgear|tp-link|d-link|mikrotik|cisco|router|gateway)") { return "Wireless-Router" }
    if (($OpenPorts -contains 80 -or $OpenPorts -contains 443) -and $OpenPorts -contains 53) { return "Router" }
    if ($OpenPorts -contains 445 -and $OpenPorts -contains 3389) { return "Windows-Host" }
    if ($OpenPorts -contains 445) { return "File-Server-Or-Workstation" }
    if ($OpenPorts -contains 22 -and -not ($OpenPorts -contains 445)) { return "Linux-Or-Network-Appliance" }
    if ($HostName -match "(?i)(printer|hp|canon|epson|brother)") { return "Printer" }
    if ($HostName -match "(?i)(camera|cam|nvr|dvr)") { return "Camera-Or-NVR" }

    return "Unknown-End-Device"
}

function Get-DeviceIconInfo {
    param(
        [string]$HostName,
        [string]$DeviceType,
        [string]$RoleGuess
    )

    if ($DeviceType -eq "Gateway") {
        return @{ Key = "gateway"; Icon = "[GW]" }
    }

    switch ($RoleGuess) {
        "Access-Point" { return @{ Key = "ap"; Icon = "[AP]" } }
        "Wireless-Router" { return @{ Key = "router"; Icon = "[RT]" } }
        "Router" { return @{ Key = "router"; Icon = "[RT]" } }
        "Managed-Switch-Or-Appliance" { return @{ Key = "switch"; Icon = "[SW]" } }
        "Printer" { return @{ Key = "printer"; Icon = "[PR]" } }
        "Camera-Or-NVR" { return @{ Key = "camera"; Icon = "[CAM]" } }
        "Windows-Host" { return @{ Key = "workstation"; Icon = "[PC]" } }
        "File-Server-Or-Workstation" { return @{ Key = "server"; Icon = "[SRV]" } }
        "Linux-Or-Network-Appliance" { return @{ Key = "server"; Icon = "[SRV]" } }
    }

    $Name = "$HostName"
    if ($Name -match "(?i)(printer|hp|canon|epson|brother)") { return @{ Key = "printer"; Icon = "[PR]" } }
    if ($Name -match "(?i)(camera|cam|nvr|dvr)") { return @{ Key = "camera"; Icon = "[CAM]" } }
    if ($Name -match "(?i)(ap|wifi|wlan|access[\s-]*point)") { return @{ Key = "ap"; Icon = "[AP]" } }

    return @{ Key = "unknown"; Icon = "[?]" }
}

function Get-IpLookupFromTree {
    param(
        [object]$Node
    )

    $Lookup = @{}

    function Visit-TreeNode {
        param([object]$Current)

        if ($null -eq $Current) { return }

        $IpProp = $Current.PSObject.Properties["IPAddress"]
        if ($IpProp -and $IpProp.Value) {
            $Lookup[[string]$IpProp.Value] = $Current
        }

        $ChildrenProp = $Current.PSObject.Properties["Children"]
        if ($ChildrenProp -and $ChildrenProp.Value) {
            foreach ($Child in $ChildrenProp.Value) {
                Visit-TreeNode -Current $Child
            }
        }
    }

    Visit-TreeNode -Current $Node
    return $Lookup
}

function Get-ChangedFields {
    param(
        [hashtable]$CurrentNode,
        [object]$PreviousNode
    )

    $Changes = @()
    $Fields = @("Name", "MACAddress", "ModelVendor", "Type", "RoleGuess", "DeviceIconKey", "DeviceIcon", "AdminUser", "AdminPassword")

    foreach ($Field in $Fields) {
        $CurrentValue = [string]$CurrentNode[$Field]
        $PreviousValue = ""
        $PreviousProp = $PreviousNode.PSObject.Properties[$Field]
        if ($PreviousProp) {
            $PreviousValue = [string]$PreviousProp.Value
        }

        if ($CurrentValue -ne $PreviousValue) {
            $Changes += $Field
        }
    }

    $CurrentPorts = @($CurrentNode.OpenTcpPorts) | Sort-Object
    $PreviousPortsProp = $PreviousNode.PSObject.Properties["OpenTcpPorts"]
    $PreviousPorts = if ($PreviousPortsProp) { @($PreviousPortsProp.Value) | Sort-Object } else { @() }
    if (($CurrentPorts -join ",") -ne ($PreviousPorts -join ",")) {
        $Changes += "OpenTcpPorts"
    }

    return $Changes
}

function Normalize-SubnetPrefix {
    param(
        [string]$Prefix
    )

    if ([string]::IsNullOrWhiteSpace($Prefix)) {
        return $null
    }

    $Trimmed = $Prefix.Trim()
    if ($Trimmed.EndsWith(".")) {
        return $Trimmed
    }

    return "$Trimmed."
}

function Get-LocalSubnetPrefixes {
    $Prefixes = @()

    try {
        $LocalIpv4 = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
            Where-Object {
                $_.IPAddress -and
                $_.IPAddress -notlike '127.*' -and
                $_.IPAddress -notlike '169.254.*'
            })

        foreach ($Entry in $LocalIpv4) {
            $Parts = @([string]$Entry.IPAddress -split '\.')
            if ($Parts.Count -eq 4) {
                $Prefixes += "$($Parts[0]).$($Parts[1]).$($Parts[2])."
            }
        }
    } catch {
        return @()
    }

    return @($Prefixes | Select-Object -Unique | Sort-Object)
}

# Resolve runtime base path for both .ps1 and compiled .exe modes.
$RuntimeBasePath = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($RuntimeBasePath) -and -not [string]::IsNullOrWhiteSpace($PSCommandPath)) {
    $RuntimeBasePath = Split-Path -Path $PSCommandPath -Parent
}
if ([string]::IsNullOrWhiteSpace($RuntimeBasePath) -and -not [string]::IsNullOrWhiteSpace($MyInvocation.MyCommand.Path)) {
    $RuntimeBasePath = Split-Path -Path $MyInvocation.MyCommand.Path -Parent
}
if ([string]::IsNullOrWhiteSpace($RuntimeBasePath)) {
    $RuntimeBasePath = [System.AppContext]::BaseDirectory
}
if ([string]::IsNullOrWhiteSpace($RuntimeBasePath)) {
    $RuntimeBasePath = (Get-Location).Path
}

# Define output paths relative to runtime location
$OutputDir  = Join-Path -Path $RuntimeBasePath -ChildPath $OutputFolder
$OutputFile = Join-Path -Path $OutputDir -ChildPath $OutputFileName

# Ensure output folder exists next to this script
if (-not (Test-Path -Path $OutputDir)) {
    New-Item -Path $OutputDir -ItemType Directory | Out-Null
}

# Find the local machine's gateway and uplink interface
$DefaultRoute = Get-NetRoute -DestinationPrefix "0.0.0.0/0" |
    Sort-Object -Property RouteMetric, ifMetric |
    Select-Object -First 1

$Gateway = $DefaultRoute.NextHop
if (-not $Gateway) { $Gateway = "Unknown-Router" }

$UplinkAdapter = if ($DefaultRoute.InterfaceIndex) {
    Get-NetAdapter -InterfaceIndex $DefaultRoute.InterfaceIndex -ErrorAction SilentlyContinue | Select-Object -First 1
} else {
    $null
}

$UplinkMacAddress = if ($UplinkAdapter) { $UplinkAdapter.MacAddress } else { "Unknown" }
$SnmpAvailable = [bool](Get-Command -Name Get-SNMP -ErrorAction SilentlyContinue)
$ScanTimestamp = (Get-Date).ToString("o")
$PreviousIpLookup = @{}

if ($EnableSnmpDiscovery -and -not $SnmpAvailable) {
    Write-Warning "SNMP discovery requested, but Get-SNMP was not found. Install an SNMP PowerShell module (for example PoshSNMP) to enable this mode."
}

if (Test-Path -Path $OutputFile) {
    try {
        $PreviousTree = Get-Content -Path $OutputFile -Raw | ConvertFrom-Json
        $PreviousIpLookup = Get-IpLookupFromTree -Node $PreviousTree
    } catch {
        Write-Warning "Previous output exists but could not be parsed for history diff. Continuing with a fresh comparison baseline."
    }
}

Write-Host "Root Router Detected: $Gateway" -ForegroundColor Cyan

if (-not $PSBoundParameters.ContainsKey("SubnetRanges") -and -not $PSBoundParameters.ContainsKey("SubnetRange")) {
    $ScanAllAnswer = Read-Host "Run scan on all local machine subnets? (Y/N, default Y)"
    if ([string]::IsNullOrWhiteSpace($ScanAllAnswer) -or $ScanAllAnswer -match '^(?i)y(es)?$') {
        $DetectedSubnets = Get-LocalSubnetPrefixes
        if ($DetectedSubnets.Count -gt 0) {
            $SubnetRanges = $DetectedSubnets
            Write-Host "Detected local subnet prefixes: $($DetectedSubnets -join ', ')" -ForegroundColor Cyan
        } else {
            Write-Warning "Could not detect local subnet prefixes automatically."
        }
    }

    if (-not $SubnetRanges -or $SubnetRanges.Count -eq 0) {
        $SubnetInput = Read-Host "Enter subnet prefix(es) to scan (example: 192.168.1. or 192.168.1.,192.168.50.)"
        if (-not [string]::IsNullOrWhiteSpace($SubnetInput)) {
            $SubnetRanges = @($SubnetInput -split "," | ForEach-Object { $_.Trim() } | Where-Object { $_ })
        }
    }
}

$EffectiveSubnets = @()
if ($SubnetRanges -and $SubnetRanges.Count -gt 0) {
    $EffectiveSubnets += $SubnetRanges
}
if ($SubnetRange) {
    $EffectiveSubnets += $SubnetRange
}
if ($EffectiveSubnets.Count -eq 0) {
    $EffectiveSubnets = @("192.168.1.")
}
$EffectiveSubnets = @($EffectiveSubnets | ForEach-Object { Normalize-SubnetPrefix -Prefix $_ } | Where-Object { $_ } | Select-Object -Unique)

if ($EffectiveSubnets.Count -eq 0) {
    throw "No valid subnet prefixes were provided."
}

Write-Host "Scanning network ranges: $($EffectiveSubnets -join ', ')" -ForegroundColor Cyan

do {
    $MapName = Read-Host "Enter a name for this network map"
} while ([string]::IsNullOrWhiteSpace($MapName))

# Initialize the parent object
$NetworkTree = @{
    Name     = "Main Router ($Gateway)"
    MapName = $MapName
    Type     = "Gateway"
    ScannedAt = $ScanTimestamp
    UplinkMACAddress = $UplinkMacAddress
    DeviceIconKey = "gateway"
    DeviceIcon = "[GW]"
    Children = @()
}

$CurrentIpLookup = @{}
$NewDevices = @()
$ChangedDevices = @()

# 1. Ping sweep to find all live "children" using batched parallel probing
$Targets = @()
foreach ($Subnet in $EffectiveSubnets) {
    for ($i = 1; $i -le 254; $i++) {
        $IP = "$Subnet$i"
        if ($IP -ne $Gateway) {
            $Targets += $IP
        }
    }
}
$Targets = @($Targets | Select-Object -Unique)
$ActiveIPs = Get-ActiveIpsFromSubnet -Targets $Targets -BatchSize $HostDiscoveryBatchSize

# 2. Gather ARP and MAC info for each child
$TotalActive = $ActiveIPs.Count
for ($index = 0; $index -lt $TotalActive; $index++) {
    $IP = $ActiveIPs[$index]
    $Percent = if ($TotalActive -gt 0) { [int]((($index + 1) / $TotalActive) * 100) } else { 100 }
    Write-ScannerProgress -Id 2 -Activity "Mapping active devices" -Status "Mapping $IP ($($index + 1) of $TotalActive)" -PercentComplete $Percent

    Write-Host "Mapping child device: $IP" -ForegroundColor Yellow
    
    # Resolve Hostname
    $DnsHostName = Resolve-DeviceHostName -IPAddress $IP
    
    # Get MAC Address using local ARP table
    $MacAddress = "Unknown"
    $ArpRecord = Get-NetNeighbor -IPAddress $IP -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($ArpRecord) { $MacAddress = $ArpRecord.LinkLayerAddress }
    
    # Attempt to enrich vendor from MAC address
    $Vendor = "Unknown Vendor"
    if ($MacAddress -match '^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$') {
        $Vendor = Get-MacVendor -MacAddress $MacAddress
    }

    # Collect stability and latency metrics
    $PingStats = Get-PingStats -IPAddress $IP -Count 4

    # Optional port scan and role inference
    $OpenTcpPorts = @()
    if (-not $SkipPortScan) {
        $OpenTcpPorts = Get-OpenTcpPorts -IPAddress $IP -Ports $CommonTcpPorts -ParentProgressId 2 -ProgressId 20 -ConnectTimeoutMs $PortConnectTimeoutMs -Throttle $PortScanThrottle
    }

    # Optional SNMP probe for managed infrastructure hints
    $SnmpSysName = $null
    $DeviceType = "End-Device"
    $DiscoveryEvidence = @("ICMP", "ARP")

    if ($EnableSnmpDiscovery -and $SnmpAvailable) {
        $SnmpSysName = Get-SnmpSysName -IPAddress $IP -Community $SnmpCommunity -TimeoutMs $SnmpTimeoutMs
        if ($SnmpSysName) {
            $DeviceType = "Managed-Network-Device"
            $DiscoveryEvidence += "SNMP"
        }
    }

    $HostName = Normalize-DeviceName -Name (Get-PreferredDeviceName -DnsName $DnsHostName -SnmpName $SnmpSysName)

    $RoleGuess = Get-RoleGuess -HostName $HostName -DeviceType $DeviceType -OpenPorts $OpenTcpPorts -Vendor $Vendor
    $IconInfo = Get-DeviceIconInfo -HostName $HostName -DeviceType $DeviceType -RoleGuess $RoleGuess

    $PreviousNode = $PreviousIpLookup[$IP]
    $FirstSeen = $ScanTimestamp
    $AdminUser = ""
    $AdminPassword = ""
    if ($PreviousNode) {
        $FirstSeenProp = $PreviousNode.PSObject.Properties["FirstSeen"]
        if ($FirstSeenProp -and $FirstSeenProp.Value) {
            $FirstSeen = [string]$FirstSeenProp.Value
        }

        $AdminUserProp = $PreviousNode.PSObject.Properties["AdminUser"]
        if ($AdminUserProp -and $AdminUserProp.Value) {
            $AdminUser = [string]$AdminUserProp.Value
        }

        $AdminPassProp = $PreviousNode.PSObject.Properties["AdminPassword"]
        if ($AdminPassProp -and $AdminPassProp.Value) {
            $AdminPassword = [string]$AdminPassProp.Value
        }
    }
    
    # Create the child object node
    $ChildNode = @{
        Name        = $HostName
        IPAddress   = $IP
        MACAddress  = $MacAddress
        ModelVendor = $Vendor
        Type        = $DeviceType
        RoleGuess   = $RoleGuess
        DeviceIconKey = $IconInfo.Key
        DeviceIcon = $IconInfo.Icon
        DiscoveryEvidence = $DiscoveryEvidence
        OpenTcpPorts = $OpenTcpPorts
        Ping = $PingStats
        FirstSeen = $FirstSeen
        LastSeen = $ScanTimestamp
        AdminUser = $AdminUser
        AdminPassword = $AdminPassword
        SnmpSysName = if ($SnmpSysName) { $SnmpSysName } else { $null }
    }

    $CurrentIpLookup[$IP] = $ChildNode

    if (-not $PreviousNode) {
        $NewDevices += @{
            IPAddress = $IP
            Name = $HostName
            RoleGuess = $RoleGuess
        }
    } else {
        $FieldsChanged = Get-ChangedFields -CurrentNode $ChildNode -PreviousNode $PreviousNode
        if ($FieldsChanged.Count -gt 0) {
            $ChangedDevices += @{
                IPAddress = $IP
                Name = $HostName
                ChangedFields = $FieldsChanged
            }
        }
    }
    
    $NetworkTree.Children += $ChildNode
}
Write-ScannerProgress -Id 2 -Activity "Mapping active devices" -Completed

$RemovedDevices = @()
foreach ($OldIP in $PreviousIpLookup.Keys) {
    if (-not $CurrentIpLookup.ContainsKey($OldIP)) {
        $PreviousNameProp = $PreviousIpLookup[$OldIP].PSObject.Properties["Name"]
        $RemovedDevices += @{
            IPAddress = [string]$OldIP
            Name = if ($PreviousNameProp) { [string]$PreviousNameProp.Value } else { "Unknown" }
        }
    }
}

$NetworkTree.ScanSummary = @{
    ScannedAt = $ScanTimestamp
    SubnetsScanned = $EffectiveSubnets
    ActiveDeviceCount = $TotalActive
    DirectChildrenCount = $NetworkTree.Children.Count
    NewDeviceCount = $NewDevices.Count
    RemovedDeviceCount = $RemovedDevices.Count
    ChangedDeviceCount = $ChangedDevices.Count
    PortScanEnabled = (-not $SkipPortScan)
    SnmpDiscoveryEnabled = [bool]$EnableSnmpDiscovery
}

$NetworkTree.ScanDiff = @{
    NewDevices = $NewDevices
    RemovedDevices = $RemovedDevices
    ChangedDevices = $ChangedDevices
}

# 3. Export the hierarchy to JSON
Write-ScannerProgress -Id 3 -Activity "Saving output" -Status "Writing JSON file" -PercentComplete 50
$NetworkTree | ConvertTo-Json -Depth 8 | Out-File $OutputFile -Encoding utf8
Write-ScannerProgress -Id 3 -Activity "Saving output" -Completed
Write-Host "Network hierarchy successfully saved to $OutputFile" -ForegroundColor Green

$ApiUrl = "$($ApiBaseUrl.TrimEnd('/'))/api/maps"
try {
    if ([string]::IsNullOrWhiteSpace($ApiKey)) {
            $ApiKey = $env:API_KEY
        }

        if ([string]::IsNullOrWhiteSpace($ApiKey)) {
        $ApiKey = Read-Host "Enter API key for API upload"
    }
    if ([string]::IsNullOrWhiteSpace($ApiKey)) {
        throw "API key is required for upload."
    }

    Write-ScannerProgress -Id 4 -Activity "Uploading result" -Status "Sending map to API" -PercentComplete 50
    $RequestBody = @{
        name = $MapName
        map = $NetworkTree
    } | ConvertTo-Json -Depth 12

    $ApiResponse = Invoke-RestMethod -Uri $ApiUrl -Method Post -Body $RequestBody -ContentType "application/json" -TimeoutSec $ApiTimeoutSec -Headers @{ "x-api-key" = $ApiKey }
    Write-ScannerProgress -Id 4 -Activity "Uploading result" -Completed
    Write-Host "Map uploaded to API as id $($ApiResponse.id) (name: $($ApiResponse.name))." -ForegroundColor Green

    if (Test-Path -Path $OutputFile) {
        Remove-Item -Path $OutputFile -Force
        Write-Host "Deleted local output file after API upload: $OutputFile" -ForegroundColor DarkGray
    }
} catch {
    Write-ScannerProgress -Id 4 -Activity "Uploading result" -Completed
    throw "Could not upload map to API at $ApiUrl. Ensure the API is running. Error: $($_.Exception.Message)"
}
