param(
    [string]$InputPptx,
    [string]$OutputDir
)

if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
}

$fullPptx = (Resolve-Path $InputPptx).Path
$fullOut = (Resolve-Path $OutputDir).Path

Write-Host "Opening PPT: $fullPptx"
Write-Host "Output to: $fullOut"

$ppt = New-Object -ComObject PowerPoint.Application
try {
    # Open(FileName, ReadOnly, Untitled, WithWindow)
    # WithWindow = msoFalse (0) to run silently in background without showing PPT UI!
    $pres = $ppt.Presentations.Open($fullPptx, 1, 0, 0)
    
    # ppSaveAsPNG = 18
    # When saving presentation as PNG, PPT creates Slide1.PNG, Slide2.PNG... in OutputDir
    $pres.SaveAs($fullOut, 18)
    $pres.Close()
    Write-Host "Export completed successfully!"
} catch {
    Write-Host "Error during export: $($_.Exception.Message)"
} finally {
    $ppt.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($ppt) | Out-Null
}
