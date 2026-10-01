using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;

namespace WinUSB
{
    public class UsbDisk
    {
        public int DiskNumber;
        public string Model = "";
        public long SizeBytes;
        public bool IsUsb;
        public List<string> DriveLetters = new List<string>();
        public string SizeLabel
        {
            get { return FormatSize(SizeBytes); }
        }
        public override string ToString()
        {
            string letters = DriveLetters.Count > 0 ? " (" + string.Join("", DriveLetters.Select(l => l + ":").ToArray()) + ")" : "";
            return string.Format("Disk {0} - {1} - {2}{3}", DiskNumber, Model, SizeLabel, letters);
        }

        public static string FormatSize(long bytes)
        {
            double gb = bytes / 1073741824.0;
            if (gb >= 1.0) return gb.ToString("0.0") + " GB";
            return (bytes / 1048576.0).ToString("0") + " MB";
        }
    }

    public class ProgressEventArgs : EventArgs
    {
        public string Message = "";
        public int Percent = -1; // -1 = indeterminate
    }

    public class IsoSelection
    {
        public string IsoPath = "";
        public List<SoftwareItem> Software = new List<SoftwareItem>();
    }

    public class BuildResult
    {
        public bool Success;
        public string Error = "";
        public List<string> Warnings = new List<string>();
    }

    public static class UsbBuilder
    {
        public static event EventHandler<ProgressEventArgs> Progress;

        static void Report(string message, int percent)
        {
            EventHandler<ProgressEventArgs> h = Progress;
            if (h != null) h(null, new ProgressEventArgs { Message = message, Percent = percent });
        }

        static ProcessStartInfo MakePsi(string fileName, string arguments)
        {
            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = fileName;
            psi.Arguments = arguments;
            psi.UseShellExecute = false;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.CreateNoWindow = true;
            psi.StandardOutputEncoding = Encoding.GetEncoding(0);
            return psi;
        }

        // Throws if the process exits non-zero. NOT for robocopy.
        static void Run(string fileName, string arguments)
        {
            using (Process p = Process.Start(MakePsi(fileName, arguments)))
            {
                string stdout = p.StandardOutput.ReadToEnd();
                string stderr = p.StandardError.ReadToEnd();
                p.WaitForExit();
                if (p.ExitCode != 0)
                    throw new InvalidOperationException(string.Format(
                        "{0} {1}\nexit code {2}\n{3}\n{4}",
                        fileName, arguments, p.ExitCode, stdout.Trim(), stderr.Trim()));
            }
        }

        // robocopy exit codes 0-7 are success (bitmask: copies, extras, mismatches, failures<8).
        static void RunRobocopy(string source, string dest, string extraArgs)
        {
            using (Process p = Process.Start(MakePsi("robocopy.exe",
                "\"" + source + "\" \"" + dest + "\" " + extraArgs)))
            {
                string stdout = p.StandardOutput.ReadToEnd();
                p.StandardError.ReadToEnd();
                p.WaitForExit();
                if (p.ExitCode >= 8)
                    throw new InvalidOperationException(
                        "robocopy failed (exit code " + p.ExitCode + "):\n" + stdout.Trim());
            }
        }

        static string RunCapture(string fileName, string arguments)
        {
            using (Process p = Process.Start(MakePsi(fileName, arguments)))
            {
                string stdout = p.StandardOutput.ReadToEnd();
                p.StandardError.ReadToEnd();
                p.WaitForExit();
                return stdout;
            }
        }

        // ------------------------------------------------------------------
        // Disk discovery
        // ------------------------------------------------------------------

        public static List<UsbDisk> ListUsbDisks()
        {
            List<UsbDisk> disks = new List<UsbDisk>();

            System.Management.ManagementScope scope = new System.Management.ManagementScope("root\\cimv2");
            scope.Connect();
            {

                // Map partition -> disk index, then logical drive -> partition,
                // so each physical disk ends up with its mounted drive letters.
                Dictionary<string, string> diskByPartition = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                using (System.Management.ManagementObjectSearcher parts = new System.Management.ManagementObjectSearcher(scope,
                    new System.Management.ObjectQuery("SELECT DeviceID, DiskIndex FROM Win32_DiskPartition")))
                {
                    foreach (System.Management.ManagementObject part in parts.Get())
                        diskByPartition[part["DeviceID"].ToString()] = part["DiskIndex"].ToString();
                }

                Dictionary<string, List<string>> lettersByDisk = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
                using (System.Management.ManagementObjectSearcher rels = new System.Management.ManagementObjectSearcher(scope,
                    new System.Management.ObjectQuery("SELECT Antecedent, Dependent FROM Win32_LogicalDiskToPartition")))
                {
                    foreach (System.Management.ManagementObject rel in rels.Get())
                    {
                        string antecedent = GetWmiRef(rel["Antecedent"]);
                        string dependent = GetWmiRef(rel["Dependent"]);
                        string diskIndex;
                        if (antecedent != null && dependent != null && diskByPartition.TryGetValue(antecedent, out diskIndex))
                        {
                            string letter = dependent.Replace(":", "");
                            List<string> list;
                            if (!lettersByDisk.TryGetValue(diskIndex, out list))
                            {
                                list = new List<string>();
                                lettersByDisk[diskIndex] = list;
                            }
                            if (!list.Contains(letter, StringComparer.OrdinalIgnoreCase)) list.Add(letter);
                        }
                    }
                }

                using (System.Management.ManagementObjectSearcher searcher = new System.Management.ManagementObjectSearcher(scope,
                    new System.Management.ObjectQuery("SELECT DeviceID, Model, Size, InterfaceType, MediaType FROM Win32_DiskDrive")))
                {
                    foreach (System.Management.ManagementObject drive in searcher.Get())
                    {
                        UsbDisk d = new UsbDisk();
                        d.DiskNumber = int.Parse(drive["DeviceID"].ToString().Replace("\\\\.\\PHYSICALDRIVE", ""));
                        d.Model = drive["Model"].ToString().Trim();
                        ulong size;
                        ulong.TryParse(drive["Size"].ToString(), out size);
                        d.SizeBytes = (long)size;
                        string iface = drive["InterfaceType"] == null ? "" : drive["InterfaceType"].ToString();
                        string media = drive["MediaType"] == null ? "" : drive["MediaType"].ToString();
                        d.IsUsb = iface.Equals("USB", StringComparison.OrdinalIgnoreCase) ||
                                  media.IndexOf("removable", StringComparison.OrdinalIgnoreCase) >= 0;

                        List<string> letters;
                        if (lettersByDisk.TryGetValue(d.DiskNumber.ToString(), out letters))
                            d.DriveLetters = letters;

                        disks.Add(d);
                    }
                }
            }

            return disks.OrderBy(d => d.DiskNumber).ToList();
        }

        static string GetWmiRef(object obj)
        {
            if (obj == null) return null;
            string s = obj.ToString();
            int i = s.IndexOf("\"");
            if (i < 0) return s;
            int j = s.IndexOf("\"", i + 1);
            return j > i ? s.Substring(i + 1, j - i - 1) : s;
        }

        // ------------------------------------------------------------------
        // ISO staging
        // ------------------------------------------------------------------

        public static string ExtractedIsoPath(string isoPath)
        {
            // Deterministic cache folder: %LOCALAPPDATA%\WinUSB\iso\<name>_<len>
            string name = Path.GetFileNameWithoutExtension(isoPath);
            long len = new FileInfo(isoPath).Length;
            return Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "WinUSB", "iso", name + "_" + len);
        }

        static void ExtractIso(string isoPath, string stageDir)
        {
            if (Directory.Exists(stageDir))
            {
                if (File.Exists(Path.Combine(stageDir, ".winusb_complete")))
                {
                    Report("Using cached ISO extraction.", 5);
                    return;
                }
                Directory.Delete(stageDir, true);
            }
            Directory.CreateDirectory(stageDir);

            Report("Mounting ISO...", 2);
            string letter = MountAndGetLetter(isoPath);
            try
            {
                Report("Copying ISO contents (robocopy)...", 4);
                RunRobocopy(letter + ":\\", stageDir, "/E /NFL /NDL /NJH /NJS /NP /R:2 /W:2");
            }
            finally
            {
                TryDismount(isoPath);
            }

            if (!File.Exists(Path.Combine(stageDir, "setup.exe")) &&
                !File.Exists(Path.Combine(stageDir, "sources", "setup.exe")))
            {
                throw new InvalidOperationException(
                    "The mounted image does not look like a Windows install ISO (no setup.exe found).");
            }

            File.WriteAllText(Path.Combine(stageDir, ".winusb_complete"), "ok");
            Report("ISO extracted.", 8);
        }

        static string MountAndGetLetter(string isoPath)
        {
            string output = RunCapture("powershell.exe", "-NoProfile -ExecutionPolicy Bypass -Command " +
                "(Mount-DiskImage -ImagePath '" + isoPath.Replace("'", "''") + "' -PassThru | Get-Volume).DriveLetter");
            output = (output ?? "").Trim();
            if (output.Length < 1)
                throw new InvalidOperationException("Could not mount the ISO as a disk image.");
            return output.Substring(0, 1);
        }

        static void TryDismount(string isoPath)
        {
            try
            {
                Run("powershell.exe", "-NoProfile -ExecutionPolicy Bypass -Command " +
                    "Dismount-DiskImage -ImagePath '" + isoPath.Replace("'", "''") + "' | Out-Null");
            }
            catch { }
        }

        // ------------------------------------------------------------------
        // Build pipeline
        // ------------------------------------------------------------------

        public static BuildResult Build(IsoSelection selection, UsbDisk target, string volumeLabel,
            bool fat32, bool includeSoftware)
        {
            BuildResult result = new BuildResult();
            try
            {
                string isoPath = selection.IsoPath;
                string stage = ExtractedIsoPath(isoPath);

                ExtractIso(isoPath, stage);

                if (includeSoftware && selection.Software.Count > 0)
                {
                    Report("Staging software payload ($OEM$)...", 10);
                    WriteOemPayload(stage, selection.Software, result);
                }

                FormatUsb(target, volumeLabel, fat32, stage, result);

                string usbRoot = GetVolumeRootByLabel(SanitizeLabel(volumeLabel));
                if (usbRoot == null)
                    throw new InvalidOperationException("Could not find the newly formatted volume by label.");

                CopyBootFiles(stage, usbRoot, fat32, result);

                Report("Done! USB is ready.", 100);
                result.Success = true;
            }
            catch (Exception ex)
            {
                result.Success = false;
                result.Error = ex.Message;
                Report("FAILED: " + ex.Message, -1);
            }
            return result;
        }

        // ------------------------------------------------------------------
        // Formatting
        // ------------------------------------------------------------------

        static string SanitizeLabel(string label)
        {
            if (string.IsNullOrEmpty(label)) label = "WINUSB";
            StringBuilder sb = new StringBuilder();
            foreach (char c in label.ToUpperInvariant())
                if (char.IsLetterOrDigit(c) || c == '_' || c == '-') sb.Append(c);
            if (sb.Length == 0) sb.Append("WINUSB");
            if (sb.Length > 11) sb.Length = 11; // FAT32 label limit
            return sb.ToString();
        }

        static void FormatUsb(UsbDisk disk, string label, bool fat32, string stage, BuildResult result)
        {
            Report("Cleaning and repartitioning " + disk.Model + " (all data will be lost)...", 15);

            if (fat32 && disk.SizeBytes > 32L * 1024 * 1024 * 1024)
                throw new InvalidOperationException(
                    "FAT32 cannot be used on disks larger than 32 GB (this disk is " +
                    UsbDisk.FormatSize(disk.SizeBytes) + "). Choose NTFS instead (legacy BIOS boot only), " +
                    "or use a stick of 32 GB or less for UEFI + BIOS compatibility.");

            string safeLabel = SanitizeLabel(label);
            string script =
                "select disk " + disk.DiskNumber + "\r\n" +
                "clean\r\n" +
                "convert mbr\r\n" +
                "create partition primary\r\n" +
                "format quick fs=" + (fat32 ? "fat32" : "ntfs") + " label=" + safeLabel + "\r\n" +
                "assign\r\n" +   // auto-picks the next free letter
                "active\r\n" +
                "exit\r\n";
            RunDiskPart(script);

            Report("Writing boot sectors...", 25);
            string root = GetVolumeRootByLabel(safeLabel);
            if (root == null)
                throw new InvalidOperationException("Formatted volume not found after diskpart (looked for label " + safeLabel + ").");

            // Makes the stick bootable on both UEFI (via bootmgr/EFI folder)
            // and legacy BIOS (via MBR boot code + active partition).
            // bootsect.exe ships inside the ISO (boot\bootsect.exe), not on PATH.
            string bootsect = Path.Combine(stage, "boot", "bootsect.exe");
            if (File.Exists(bootsect))
            {
                Run(bootsect, "/nt60 " + root + ": /force /mbr");
            }
            else
            {
                result.Warnings.Add("bootsect.exe not found in the ISO - legacy BIOS boot code was not written. " +
                    "UEFI boot should still work; legacy/CSM boot may not.");
            }

            if (!fat32)
                result.Warnings.Add(
                    "NTFS was selected: the stick will boot on legacy BIOS, but most UEFI firmware cannot " +
                    "boot NTFS. Use FAT32 (with automatic WIM splitting) for the widest compatibility.");
        }

        static void RunDiskPart(string script)
        {
            string tmp = Path.Combine(Path.GetTempPath(), "winusb_diskpart.txt");
            File.WriteAllText(tmp, script, new UTF8Encoding(false));
            Run("diskpart.exe", "/s \"" + tmp + "\"");
            try { File.Delete(tmp); } catch { }
        }

        static string GetVolumeRootByLabel(string label)
        {
            // Give the shell a moment to surface the new volume.
            for (int attempt = 0; attempt < 10; attempt++)
            {
                using (System.Management.ManagementObjectSearcher searcher = new System.Management.ManagementObjectSearcher(
                    "SELECT DeviceID, VolumeName FROM Win32_LogicalDisk"))
                {
                    foreach (System.Management.ManagementObject d in searcher.Get())
                    {
                        string vol = d["VolumeName"] == null ? "" : d["VolumeName"].ToString();
                        if (string.Equals(vol, label, StringComparison.OrdinalIgnoreCase))
                            return ((string)d["DeviceID"]).Replace(":", "");
                    }
                }
                Thread.Sleep(500);
            }
            return null;
        }

        // ------------------------------------------------------------------
        // Copy + WIM splitting
        // ------------------------------------------------------------------

        static void CopyBootFiles(string stage, string usbRoot, bool fat32, BuildResult result)
        {
            string wimFile = Path.Combine(stage, "sources", "install.wim");
            string esdFile = Path.Combine(stage, "sources", "install.esd");
            string bigImage = File.Exists(wimFile) ? wimFile : (File.Exists(esdFile) ? esdFile : null);

            if (bigImage != null)
            {
                long size = new FileInfo(bigImage).Length;
                bool tooBigForFat32 = size > 3900L * 1024 * 1024; // margin under 4 GiB

                if (tooBigForFat32 && fat32)
                {
                    Report("Splitting " + Path.GetFileName(bigImage) + " (" +
                        UsbDisk.FormatSize(size) + ") into .swm chunks for FAT32...", 35);
                    SplitWim(bigImage, Path.Combine(stage, "sources"));
                    result.Warnings.Add(
                        Path.GetFileName(bigImage) + " was larger than 4 GB and was split into install.swm chunks. " +
                        "Windows setup picks these up automatically.");
                }
                else if (tooBigForFat32 && !fat32)
                {
                    result.Warnings.Add(
                        Path.GetFileName(bigImage) + " is larger than 4 GB; NTFS was selected so no split was needed.");
                }
            }

            Report("Copying Windows setup files to USB...", 50);
            RunRobocopy(stage, usbRoot, "/E /NFL /NDL /NJH /NJS /NP /R:2 /W:2 /XF .winusb_complete");
            Report("Setup files copied.", 90);
        }

        static void SplitWim(string wimPath, string outputDir)
        {
            string baseName = Path.GetFileNameWithoutExtension(wimPath);
            string swmPath = Path.Combine(outputDir, baseName + ".swm");
            Run("dism.exe", "/Split-Image /ImageFile:\"" + wimPath + "\" /SWMFile:\"" + swmPath + "\" /FileSize:3800");
            File.Delete(wimPath); // so robocopy doesn't drag the oversized original onto the stick
        }

        // ------------------------------------------------------------------
        // $OEM$ payload
        // ------------------------------------------------------------------

        static string PayloadSafeName(SoftwareItem item, int index)
        {
            string ext = Path.GetExtension(item.FilePath).ToLowerInvariant();
            return "sw" + index.ToString("00") + "_" + SanitizeFileName(Path.GetFileNameWithoutExtension(item.FilePath)) + ext;
        }

        static void WriteOemPayload(string stage, List<SoftwareItem> software, BuildResult result)
        {
            // Windows setup only processes $OEM$ when it sits INSIDE the sources
            // folder: sources\$OEM$\$$\Setup\Scripts\SetupComplete.cmd gets
            // copied to C:\Windows\Setup\Scripts\SetupComplete.cmd during setup.
            // At the USB root it is silently ignored.
            string scriptsDir = Path.Combine(stage, "sources", "$OEM$", "$$", "Setup", "Scripts");
            string softwareDir = Path.Combine(stage, "sources", "$OEM$", "$$", "Setup", "Software");

            // The stage folder is cached between builds - clear stale payload
            // files so installers from a previous selection don't linger.
            if (Directory.Exists(softwareDir)) Directory.Delete(softwareDir, true);
            Directory.CreateDirectory(scriptsDir);
            Directory.CreateDirectory(softwareDir);
            string oldCmd = Path.Combine(scriptsDir, "SetupComplete.cmd");
            if (File.Exists(oldCmd)) File.Delete(oldCmd);

            for (int i = 0; i < software.Count; i++)
            {
                SoftwareItem item = software[i];
                File.Copy(item.FilePath, Path.Combine(softwareDir, PayloadSafeName(item, i + 1)), true);
                result.Warnings.Add("Queued: " + item.FileName + " [" + InstallerDetector.KindLabel(item.Kind) + "]");
            }

            File.WriteAllText(Path.Combine(scriptsDir, "SetupComplete.cmd"),
                GenerateSetupCompleteCmd(software), new UTF8Encoding(false));
        }

        public static string GenerateSetupCompleteCmd(List<SoftwareItem> software)
        {
            StringBuilder sb = new StringBuilder();
            sb.AppendLine("@echo off");
            sb.AppendLine("rem Generated by WinUSB - runs once, as admin, at the end of Windows Setup.");
            sb.AppendLine("set LOG=%WINDIR%\\Setup\\Scripts\\winusb_install.log");
            sb.AppendLine("echo WinUSB software install started %DATE% %TIME% >> \"%LOG%\"");
            sb.AppendLine("pushd \"%WINDIR%\\Setup\\Scripts\\Software\"");
            sb.AppendLine();

            for (int i = 0; i < software.Count; i++)
            {
                SoftwareItem item = software[i];
                string safeName = PayloadSafeName(item, i + 1);
                string label = item.FileName;

                sb.AppendLine("echo [%TIME%] Installing " + label + " >> \"%LOG%\"");
                switch (item.Kind)
                {
                    case InstallerKind.PowerShell:
                        sb.AppendLine("powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"" + safeName + "\" " + item.Args + " >> \"%LOG%\" 2>&1");
                        break;
                    case InstallerKind.Msi:
                        sb.AppendLine("msiexec /i \"" + safeName + "\" " + item.Args + " >> \"%LOG%\" 2>&1");
                        break;
                    default:
                        sb.AppendLine("\"" + safeName + "\" " + item.Args + " >> \"%LOG%\" 2>&1");
                        break;
                }
                sb.AppendLine("echo [%TIME%] " + label + " exit code %ERRORLEVEL% >> \"%LOG%\"");
                sb.AppendLine();
            }

            sb.AppendLine("popd");
            sb.AppendLine("echo WinUSB software install finished %DATE% %TIME% >> \"%LOG%\"");
            return sb.ToString();
        }

        static string SanitizeFileName(string name)
        {
            StringBuilder sb = new StringBuilder();
            foreach (char c in name)
            {
                if (char.IsLetterOrDigit(c) || c == '-' || c == '_' || c == '.') sb.Append(c);
                else sb.Append('_');
            }
            if (sb.Length > 40) sb.Length = 40;
            return sb.ToString();
        }
    }
}
