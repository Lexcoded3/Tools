@echo off
rem ---------------------------------------------------------------
rem  WinUSB build script - uses the C# compiler built into Windows
rem  (.NET Framework 4), so no SDK or Visual Studio is required.
rem ---------------------------------------------------------------
setlocal
set CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
if not exist "%CSC%" set CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe
if not exist "%CSC%" (
    echo Could not find the .NET Framework C# compiler.
    echo Enable .NET Framework 4.x in Windows Features and retry.
    exit /b 1
)

if not exist bin mkdir bin

"%CSC%" /nologo /out:bin\WinUSB.exe /target:winexe /platform:anycpu /win32manifest:app.manifest ^
    /r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll /r:System.Management.dll ^
    /r:System.Xml.dll ^
    Program.cs MainForm.cs UsbBuilder.cs InstallerDetector.cs OfficeSupport.cs OfficeDialog.cs

if errorlevel 1 (
    echo.
    echo Build FAILED.
    exit /b 1
)

echo.
echo Build OK: bin\WinUSB.exe
echo Run it as Administrator (right-click ^> Run as administrator).
endlocal
