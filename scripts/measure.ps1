# Total RAM for ZYNLEX: its own process plus the whole msedgewebview2 tree it spawned.
# Renderer memory lives in the children, so measuring zynlex.exe alone understates it badly.
#
#   .\scripts\measure.ps1                  one sample
#   .\scripts\measure.ps1 -Label "5 tabs"  tag the row
#   .\scripts\measure.ps1 -Name chrome     compare against another browser
param(
    [string]$Label = "",
    [string]$Name = "zynlex"
)

$all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, WorkingSetSize
$roots = $all | Where-Object { $_.Name -like "$Name*.exe" -and $_.ParentProcessId -notin ($all | Where-Object { $_.Name -like "$Name*.exe" }).ProcessId }
if (-not $roots) { Write-Error "no '$Name' process running"; exit 1 }

# Walk down from each root, collecting descendants.
$tree = @{}
$queue = [System.Collections.Queue]::new()
foreach ($r in $roots) { $queue.Enqueue($r) }
while ($queue.Count) {
    $p = $queue.Dequeue()
    if ($tree.ContainsKey($p.ProcessId)) { continue }   # cycle guard: PIDs can be reused
    $tree[$p.ProcessId] = $p
    foreach ($c in $all | Where-Object ParentProcessId -eq $p.ProcessId) { $queue.Enqueue($c) }
}

$procs = $tree.Values
$totalMB = [math]::Round(($procs | Measure-Object WorkingSetSize -Sum).Sum / 1MB, 1)

"{0}  {1,-12} {2,6} MB   {3} processes" -f (Get-Date -Format HH:mm:ss), $Label, $totalMB, $procs.Count
$procs | Group-Object Name | Sort-Object { -($_.Group | Measure-Object WorkingSetSize -Sum).Sum } | ForEach-Object {
    "    {0,-28} {1,6} MB  x{2}" -f $_.Name, [math]::Round(($_.Group | Measure-Object WorkingSetSize -Sum).Sum / 1MB, 1), $_.Count
}
