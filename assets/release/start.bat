@echo off
cd /d %~dp0

taskkill /F /IM engine-wrapper.exe >nul 2>&1
taskkill /F /IM shogihome-server.exe >nul 2>&1

echo Starting ShogiHome LAN Engine...
echo.

echo ---------------------------------------------------
echo [INFO] Local Network Addresses:
ipconfig | findstr "IPv4"
echo.
echo Please note the IP address above (e.g., 192.168.x.x).
echo You may need to add "http://(IP):8080" to shogihome/.env
echo if you want to connect from smartphones.
echo ---------------------------------------------------
echo.

if not exist "engine-wrapper\engine-wrapper.exe" (
    echo Error: engine-wrapper\engine-wrapper.exe not found.
    echo Please make sure you have extracted all files correctly.
    pause
    exit /b
)

if not exist "shogihome\shogihome-server.exe" (
    echo Error: shogihome\shogihome-server.exe not found.
    echo Please make sure you have extracted all files correctly.
    pause
    exit /b
)

echo Starting Background Services...
start "" /d "engine-wrapper" engine-wrapper.exe

echo Starting Web Server...
start "ShogiHome Web Server" /d "shogihome" shogihome-server.exe

echo.
echo Waiting for servers to initialize...
timeout /t 3 >nul

echo.
echo Done!
echo You can access the app at: http://localhost:8080
echo (Or http://(YOUR_IP):8080 from other devices)
echo.
echo ---------------------------------------------------
echo  This window will close automatically.
echo  Please KEEP the "ShogiHome Web Server" window OPEN.
echo ---------------------------------------------------
timeout /t 20