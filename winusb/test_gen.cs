using System;
using System.Collections.Generic;

// Tiny verification harness: references the real WinUSB.exe assembly and
// exercises the SetupComplete.cmd generator without needing elevation.
class TestGen
{
    static void Main()
    {
        List<WinUSB.SoftwareItem> items = new List<WinUSB.SoftwareItem>();
        items.Add(WinUSB.InstallerDetector.Detect(@"C:\dist\7z2409-x64.exe"));      // exe -> sniff fails offline -> NSIS default
        items.Add(WinUSB.InstallerDetector.Detect(@"C:\dist\SumatraPDF.msi"));     // MSI
        items.Add(WinUSB.InstallerDetector.Detect(@"C:\dist\setup.ps1"));          // PowerShell
        Console.Write(WinUSB.UsbBuilder.GenerateSetupCompleteCmd(items));
    }
}
