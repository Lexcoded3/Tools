using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace WinUSB
{
    public enum InstallerKind
    {
        Msi,
        Nsis,
        Inno,
        WixBurn,
        Squirrel,
        InstallShield,
        AdvancedInstaller,
        Batch,
        PowerShell,
        Unknown
    }

    public class SoftwareItem
    {
        public string FilePath = "";
        public InstallerKind Kind;
        public string Args = "";

        public string FileName
        {
            get { return Path.GetFileName(FilePath); }
        }
    }

    public static class InstallerDetector
    {
        public static SoftwareItem Detect(string path)
        {
            SoftwareItem item = new SoftwareItem();
            item.FilePath = path;
            item.Kind = DetectKind(path);
            item.Args = DefaultArgs(item.Kind);
            return item;
        }

        public static string KindLabel(InstallerKind kind)
        {
            switch (kind)
            {
                case InstallerKind.Msi: return "MSI";
                case InstallerKind.Nsis: return "NSIS";
                case InstallerKind.Inno: return "Inno Setup";
                case InstallerKind.WixBurn: return "WiX Bundle";
                case InstallerKind.Squirrel: return "Squirrel";
                case InstallerKind.InstallShield: return "InstallShield";
                case InstallerKind.AdvancedInstaller: return "Advanced Installer";
                case InstallerKind.Batch: return "Batch";
                case InstallerKind.PowerShell: return "PowerShell";
                default: return "Unknown";
            }
        }

        static InstallerKind DetectKind(string path)
        {
            string ext = Path.GetExtension(path).ToLowerInvariant();
            if (ext == ".msi") return InstallerKind.Msi;
            if (ext == ".bat" || ext == ".cmd") return InstallerKind.Batch;
            if (ext == ".ps1") return InstallerKind.PowerShell;
            if (ext != ".exe") return InstallerKind.Unknown;

            // .exe files: sniff known installer signatures from the binary
            // (version resources / strings embedded near the header).
            string probe = ProbeText(path);
            if (probe.IndexOf("nullsoft", StringComparison.OrdinalIgnoreCase) >= 0) return InstallerKind.Nsis;
            if (probe.IndexOf("inno setup", StringComparison.OrdinalIgnoreCase) >= 0) return InstallerKind.Inno;
            if (probe.IndexOf("windows installer xml", StringComparison.OrdinalIgnoreCase) >= 0 ||
                probe.IndexOf("wixbootstrapper", StringComparison.OrdinalIgnoreCase) >= 0 ||
                probe.IndexOf("burn engine", StringComparison.OrdinalIgnoreCase) >= 0) return InstallerKind.WixBurn;
            if (probe.IndexOf("squirrel", StringComparison.OrdinalIgnoreCase) >= 0) return InstallerKind.Squirrel;
            if (probe.IndexOf("installshield", StringComparison.OrdinalIgnoreCase) >= 0) return InstallerKind.InstallShield;
            if (probe.IndexOf("advanced installer", StringComparison.OrdinalIgnoreCase) >= 0) return InstallerKind.AdvancedInstaller;
            return InstallerKind.Unknown;
        }

        // Read the first 256 KB and keep printable character runs. Signature
        // strings live in the PE header / UTF-16 version resources, which are
        // always near the start of the file - no need to scan the whole EXE.
        static string ProbeText(string path)
        {
            try
            {
                using (FileStream fs = File.OpenRead(path))
                {
                    int len = (int)Math.Min(256 * 1024, fs.Length);
                    byte[] buf = new byte[len];
                    int read = 0;
                    while (read < len)
                    {
                        int n = fs.Read(buf, read, len - read);
                        if (n <= 0) break;
                        read += n;
                    }

                    // ASCII view
                    StringBuilder ascii = new StringBuilder(read);
                    for (int i = 0; i < read; i++)
                    {
                        byte b = buf[i];
                        ascii.Append(b >= 0x20 && b < 0x7F ? (char)b : ' ');
                    }

                    // UTF-16LE view (version resources)
                    StringBuilder wide = new StringBuilder(read / 2);
                    for (int i = 0; i + 1 < read; i += 2)
                    {
                        if (buf[i] >= 0x20 && buf[i] < 0x7F && buf[i + 1] == 0) wide.Append((char)buf[i]);
                        else wide.Append(' ');
                    }

                    return ascii.ToString() + "\n" + wide.ToString();
                }
            }
            catch
            {
                return "";
            }
        }

        public static string DefaultArgs(InstallerKind kind)
        {
            switch (kind)
            {
                case InstallerKind.Msi: return "/qn /norestart";
                case InstallerKind.Nsis: return "/S";
                case InstallerKind.Inno: return "/VERYSILENT /NORESTART /SUPPRESSMSGBOXES";
                case InstallerKind.WixBurn: return "/quiet /norestart";
                case InstallerKind.Squirrel: return "--silent";
                // Silent only works if a setup.iss response file sits next to it.
                case InstallerKind.InstallShield: return "-s";
                // Advanced Installer bootstrappers wrap an MSI: no UI, silent MSI.
                case InstallerKind.AdvancedInstaller: return "/exenoui /qn";
                case InstallerKind.Batch: return "";
                case InstallerKind.PowerShell: return "";
                // Most unknown EXEs are NSIS-style; user can edit the column.
                default: return "/S";
            }
        }

        public static string[] SupportedExtensions
        {
            get { return new string[] { ".exe", ".msi", ".bat", ".cmd", ".ps1" }; }
        }

        public static bool IsSupported(string path)
        {
            string ext = Path.GetExtension(path).ToLowerInvariant();
            return Array.IndexOf(SupportedExtensions, ext) >= 0;
        }
    }
}
