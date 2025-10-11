# Simple script to start both applications
Write-Host "Starting Camper Registration System..." -ForegroundColor Green

# Start backend in new PowerShell window
Write-Host "Starting backend server..." -ForegroundColor Cyan
$backendCommand = "cd backend; Write-Host 'Backend Server - http://localhost:3001' -ForegroundColor Green; node server.js"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendCommand

# Wait 2 seconds
Start-Sleep 2

# Start frontend in new PowerShell window  
Write-Host "Starting frontend dev server..." -ForegroundColor Magenta
$frontendCommand = "cd frontend; Write-Host 'Frontend Dev Server' -ForegroundColor Green; npm run dev -- --host"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $frontendCommand

Write-Host ""
Write-Host "Both applications are starting in separate windows!" -ForegroundColor Green
Write-Host "Backend: http://localhost:3001" -ForegroundColor White
Write-Host "Frontend: http://localhost:5173" -ForegroundColor White
Write-Host ""
Write-Host "Close the individual PowerShell windows to stop each application." -ForegroundColor Yellow