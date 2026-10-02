using System;
using System.Collections.Generic;

// Tiny verification harness: references the real WinUSB.exe assembly and
// exercises the SetupComplete.cmd / fallback / configuration.xml generators
// without needing elevation.
class TestGen
{
    static void Main()
    {
        List<WinUSB.SoftwareItem> items = new List<WinUSB.SoftwareItem>();
        items.Add(WinUSB.InstallerDetector.Detect(@"C:\dist\7z2409-x64.exe"));      // exe -> sniff fails offline -> NSIS default
        items.Add(WinUSB.InstallerDetector.Detect(@"C:\dist\SumatraPDF.msi"));     // MSI
        items.Add(WinUSB.InstallerDetector.Detect(@"C:\dist\setup.ps1"));          // PowerShell

        WinUSB.OfficeSetup office = new WinUSB.OfficeSetup();
        office.IsoPath = @"C:\dist\Office2021.iso";
        office.ProductId = "ProPlus2021Volume";
        office.Language = "en-us";
        office.Edition = "64";

        Console.WriteLine("===== SetupComplete.cmd =====");
        Console.Write(WinUSB.UsbBuilder.GenerateSetupCompleteCmd(items, office));
        Console.WriteLine();
        Console.WriteLine("===== configuration.xml (generated) =====");
        Console.Write(WinUSB.OfficeSupport.GenerateConfigurationXml(office));
        Console.WriteLine();
        Console.WriteLine("===== configuration.xml (rewritten from an ISO's own config) =====");
        string isoConfig = "<Configuration><Add SourcePath=\"D:\\\" OfficeClientEdition=\"64\">" +
            "<Product ID=\"ProPlus2021Volume\"><Language ID=\"en-us\"/></Product></Add>" +
            "<Display Level=\"Full\" AcceptEula=\"TRUE\"/></Configuration>";
        Console.Write(WinUSB.OfficeSupport.RewriteIsoConfig(isoConfig) ?? "(null - rewrite failed)");
        Console.WriteLine();
        Console.WriteLine("===== fallback WinUSB-Install.cmd =====");
        Console.Write(WinUSB.UsbBuilder.GenerateFallbackCmd(items, office));
    }
}
