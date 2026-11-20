@echo off
echo ========================================================
echo         DogRemote Local - Windows Native Build            
echo ========================================================

where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Python 3 is not found in PATH!
    echo Please install Python 3.10+ from https://www.python.org/
    pause
    exit /b 1
)

echo [1/3] Installing dependencies...
python -m pip install --upgrade pip
python -m pip install -r requirements.txt

echo [2/3] Building standalone Windows executable...
rmdir /s /q build 2>nul
rmdir /s /q dist\DogRemote 2>nul
pyinstaller --noconfirm --clean --windowed --name "DogRemote" --icon "public/icon.png" --add-data "public;public" main.py

echo [3/3] Creating single-file portable executable...
pyinstaller --noconfirm --clean --windowed --onefile --name "DogRemote-Portable" --icon "public/icon.png" --add-data "public;public" main.py

echo.
echo ========================================================
echo  Build Complete! Executables located in dist\:
echo   - dist\DogRemote-Portable.exe (Single file portable)
echo   - dist\DogRemote\DogRemote.exe  (Folder distribution)
echo ========================================================
pause
