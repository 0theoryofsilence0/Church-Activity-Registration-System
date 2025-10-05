# Start both backend and frontend applications
Write-Host "Starting Camper Registration System..." -ForegroundColor Green

# Get the current script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Define paths
$backendPath = Join-Path $scriptDir "backend"
$frontendPath = Join-Path $scriptDir "frontend"

# Check if directories exist
if (-not (Test-Path $backendPath)) {
    Write-Host "Backend directory not found: $backendPath" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $frontendPath)) {
    Write-Host "Frontend directory not found: $frontendPath" -ForegroundColor Red
    exit 1
}

Write-Host "Backend path: $backendPath" -ForegroundColor Yellow
Write-Host "Frontend path: $frontendPath" -ForegroundColor Yellow

# Function to handle cleanup on exit
function Cleanup {
    Write-Host "`nShutting down applications..." -ForegroundColor Yellow
    Get-Job | Stop-Job
    Get-Job | Remove-Job
    Write-Host "Applications stopped." -ForegroundColor Green
}

# Register cleanup function for Ctrl+C
Register-EngineEvent PowerShell.Exiting -Action { Cleanup }

try {
    # Start backend server
    Write-Host "Starting backend server..." -ForegroundColor Cyan
    $backendJob = Start-Job -ScriptBlock {
        param($path)
        Set-Location $path
        node server.js
    } -ArgumentList $backendPath

    # Wait a moment for backend to start
    Start-Sleep -Seconds 2

    # Start frontend dev server
    Write-Host "Starting frontend dev server..." -ForegroundColor Cyan
    $frontendJob = Start-Job -ScriptBlock {
        param($path)
        Set-Location $path
        npm run dev -- --host
    } -ArgumentList $frontendPath

    Write-Host "`nBoth applications are starting..." -ForegroundColor Green
    Write-Host "Backend: http://localhost:3001" -ForegroundColor White
    Write-Host "Frontend: http://localhost:5173 (or check terminal output)" -ForegroundColor White
    Write-Host "`nPress Ctrl+C to stop both applications" -ForegroundColor Yellow

    # Keep the script running and show job status
    while ($true) {
        Start-Sleep -Seconds 5
        
        # Check if jobs are still running
        $backendRunning = (Get-Job -Id $backendJob.Id).State -eq "Running"
        $frontendRunning = (Get-Job -Id $frontendJob.Id).State -eq "Running"
        
        if (-not $backendRunning -or -not $frontendRunning) {
            Write-Host "`nOne or more applications have stopped unexpectedly." -ForegroundColor Red
            
            if (-not $backendRunning) {
                Write-Host "Backend output:" -ForegroundColor Yellow
                Receive-Job -Id $backendJob.Id
            }
            
            if (-not $frontendRunning) {
                Write-Host "Frontend output:" -ForegroundColor Yellow
                Receive-Job -Id $frontendJob.Id
            }
            
            break
        }
    }
}
catch {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
}
finally {
    Cleanup
}