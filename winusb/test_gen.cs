using System;
using System.Collections.Generic;

// Tiny verification harness: references the real WinUSB.exe assembly and
// exercises the SetupComplete.cmd / fallback / configuration generators
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
        office.Language = "en-us";
        office.Edition = "64";

        Console.WriteLine("===== SetupComplete.cmd =====");
        Console.Write(WinUSB.UsbBuilder.GenerateSetupCompleteCmd(items, office));
        Console.WriteLine();
        Console.WriteLine("===== fallback WinUSB-Install.cmd =====");
        Console.Write(WinUSB.UsbBuilder.GenerateFallbackCmd(items, office));
        Console.WriteLine();
        Console.WriteLine("===== candidate config (first, as generated) =====");
        List<WinUSB.OfficeProduct> def = WinUSB.OfficeSupport.OrderedCandidates(null);
        Console.Write(WinUSB.OfficeSupport.GenerateConfigurationXml(def[0].Id, office.Language, office.Edition));
        Console.WriteLine();
        Console.WriteLine("===== candidate order for ISO label 'O21_PROPLUS_VOLUME_EN-US' =====");
        foreach (WinUSB.OfficeProduct p in WinUSB.OfficeSupport.OrderedCandidates("O21_PROPLUS_VOLUME_EN-US"))
            Console.WriteLine("  " + p.Id + "   [" + WinUSB.OfficeSupport.ChannelFor(p.Id) + "]");
        Console.WriteLine("===== candidate order for ISO label 'O24_HOMEBUSINESS_RETAIL_EN-US' =====");
        foreach (WinUSB.OfficeProduct p in WinUSB.OfficeSupport.OrderedCandidates("O24_HOMEBUSINESS_RETAIL_EN-US"))
            Console.WriteLine("  " + p.Id);
        Console.WriteLine();
        Console.WriteLine("===== configuration.xml (rewritten from an ISO's own config) =====");
        string isoConfig = "<Configuration><Add SourcePath=\"D:\\\" OfficeClientEdition=\"64\">" +
            "<Product ID=\"ProPlus2021Volume\"><Language ID=\"en-us\"/></Product></Add>" +
            "<Display Level=\"Full\" AcceptEula=\"TRUE\"/></Configuration>";
        string rewritten = WinUSB.OfficeSupport.RewriteIsoConfig(isoConfig);
        Console.Write(rewritten ?? "(null - rewrite failed)");
        Console.WriteLine();
        Console.WriteLine("product detected in rewritten config: " + (WinUSB.OfficeSupport.FindProductId(rewritten) ?? "(none)"));
    }
}
