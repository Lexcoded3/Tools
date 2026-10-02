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
        public OfficeSetup Office; // optional - null when no Office ISO was picked
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

        // Quote a path for a child-process command line ONLY if it contains a
        // space - and never quote a path ending in '\'. A trailing backslash
        // before a closing quote is parsed as an escaped quote (\"), which
        // mangles the argument (the classic robocopy ERROR 123 source).
        static string Q(string path)
        {
            if (path.IndexOf(' ') < 0 || path.EndsWith("\\")) return path;
            return "\"" + path + "\"";
        }

        // robocopy exit codes 0-7 are success (bit flags; >=8 means failures).
        static void RunRobocopy(string source, string dest)
        {
            string args = Q(source) + " " + Q(dest) + " /E /R:2 /W:2 /NFL /NDL /NJH /NJS /NP";
            using (Process p = Process.Start(MakePsi("robocopy.exe", args)))
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
        // ISO mounting
        // ------------------------------------------------------------------

        // Mounts the ISO and returns the volume root like "E:\".
        // Strict validation: accepts exactly one letter A-Z and nothing else,
        // so wrapper/AV noise can never be mistaken for a drive letter (the
        // bug behind robocopy ERROR 123 with a mangled source path).
        static string MountIso(string isoPath)
        {
            string output = RunCapture("powershell.exe",
                "-NoProfile -ExecutionPolicy Bypass -Command " +
                "\"(Mount-DiskImage -ImagePath '" + isoPath.Replace("'", "''") +
                "' -PassThru | Get-Volume).DriveLetter\"");

            output = output == null ? "" : output.Trim().ToUpperInvariant();

            if (output.Length == 1 && output[0] >= 'A' && output[0] <= 'Z')
                return output + ":\\";

            throw new InvalidOperationException(
                "Could not mount the ISO as a drive. Mount-DiskImage returned unexpected output:\n" +
                (output.Length == 0
                    ? "(no output at all - the PowerShell disk-image service may be blocked by a sandbox or security software)"
                    : output));
        }

        static void TryDismount(string isoPath)
        {
            try
            {
                Run("powershell.exe", "-NoProfile -ExecutionPolicy Bypass -Command " +
                    "\"Dismount-DiskImage -ImagePath '" + isoPath.Replace("'", "''") + "' | Out-Null\"");
            }
            catch { }
        }

        // ------------------------------------------------------------------
        // Build pipeline
        // ------------------------------------------------------------------

        public static BuildResult Build(IsoSelection selection, UsbDisk target, string volumeLabel, bool fat32)
        {
            BuildResult result = new BuildResult();
            bool mounted = false;
            bool officeMounted = false;
            string officeRoot = null;
            OfficeSetup office = selection.Office;
            try
            {
                string isoPath = Path.GetFullPath(selection.IsoPath);
                if (!File.Exists(isoPath))
                    throw new InvalidOperationException("ISO file not found: " + isoPath);

                // Validate BEFORE touching the USB stick. If the ISO can't be
                // mounted or isn't a Windows ISO, we fail with the disk intact.
                Report("Mounting ISO (validating before any disk changes)...", 0);
                string isoRoot = MountIso(isoPath);
                mounted = true;
                Report("ISO mounted at " + isoRoot, 5);

                if (!File.Exists(Path.Combine(isoRoot, "setup.exe")) &&
                    !File.Exists(Path.Combine(isoRoot, "sources", "setup.exe")))
                {
                    throw new InvalidOperationException(
                        isoRoot + " does not look like a Windows install ISO (no setup.exe found). " +
                        "Nothing has been written to the USB disk.");
                }

                // Optional Office ISO: mounted and validated the same way,
                // still before ANY change to the USB disk.
                if (office != null)
                {
                    string officeIso = Path.GetFullPath(office.IsoPath);
                    if (!File.Exists(officeIso))
                        throw new InvalidOperationException("Office ISO file not found: " + officeIso);

                    Report("Mounting Office ISO (validating before any disk changes)...", 2);
                    officeRoot = MountIso(officeIso);
                    officeMounted = true;

                    if (!OfficeSupport.LooksLikeOfficeIso(officeRoot))
                        throw new InvalidOperationException(
                            officeRoot + " does not look like an Office ISO (no setup.exe at its root). " +
                            "Nothing has been written to the USB disk.");

                    if (fat32) EnsureFat32Compatible(officeRoot, "The Office ISO");
                }

                if (fat32 && target.SizeBytes > 32L * 1024 * 1024 * 1024)
                    throw new InvalidOperationException(
                        "FAT32 cannot be used on disks larger than 32 GB (this disk is " +
                        UsbDisk.FormatSize(target.SizeBytes) + "). Choose NTFS instead (legacy BIOS boot only), " +
                        "or use a stick of 32 GB or less for UEFI + BIOS compatibility.");

                // Fails BEFORE formatting if Windows ISO + Office + installers
                // cannot possibly fit on the stick.
                EnsureSpace(isoRoot, officeRoot, selection.Software, target);

                FormatUsb(target, volumeLabel, fat32, isoRoot, result);

                string usbRoot = GetVolumeRootByLabel(SanitizeLabel(volumeLabel));
                if (usbRoot == null)
                    throw new InvalidOperationException("Formatted volume not found after diskpart (looked for label " + SanitizeLabel(volumeLabel) + ").");

                CopyFiles(isoRoot, usbRoot, fat32, result);

                if (officeRoot != null)
                {
                    Report("Copying Office installation files to USB (this takes a few minutes)...", 91);
                    CopyOfficePayload(officeRoot, usbRoot, office, result);
                }

                if (selection.Software.Count > 0 || office != null)
                {
                    Report("Writing software payload ($OEM$)...", 97);
                    WriteOemPayload(usbRoot, selection.Software, office, result);
                }

                Report("Done! USB is ready.", 100);
                result.Success = true;
            }
            catch (Exception ex)
            {
                result.Success = false;
                result.Error = ex.Message;
                Report("FAILED: " + ex.Message, -1);
            }
            finally
            {
                if (mounted) TryDismount(selection.IsoPath);
                if (officeMounted && office != null) TryDismount(office.IsoPath);
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

        static void FormatUsb(UsbDisk disk, string label, bool fat32, string isoRoot, BuildResult result)
        {
            Report("Cleaning and repartitioning " + disk.Model + " (all data will be lost)...", 15);

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
            string bootsect = Path.Combine(isoRoot, "boot", "bootsect.exe");
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

        // Volume label of a mounted drive (VLSC Office media labels look like
        // "O21_PROPLUS_VOLUME_EN-US"). Used only as a hint for ordering the
        // candidate product configurations.
        static string GetVolumeLabel(string root)
        {
            try
            {
                string letter = root.Substring(0, 1);
                using (System.Management.ManagementObjectSearcher searcher = new System.Management.ManagementObjectSearcher(
                    "SELECT VolumeName FROM Win32_LogicalDisk WHERE DeviceID='" + letter + ":'"))
                {
                    foreach (System.Management.ManagementObject d in searcher.Get())
                        return d["VolumeName"] == null ? "" : d["VolumeName"].ToString();
                }
            }
            catch { }
            return "";
        }

        // ------------------------------------------------------------------
        // Copy + WIM handling
        // ------------------------------------------------------------------

        static void CopyFiles(string isoRoot, string usbRoot, bool fat32, BuildResult result)
        {
            string usbDest = usbRoot + ":\\";   // drive root, no spaces -> passed unquoted

            string bigImage = FindBigImage(isoRoot);
            long bigSize = 0;
            bool tooBig = false;
            if (bigImage != null)
            {
                bigSize = new FileInfo(bigImage).Length;
                tooBig = bigSize > 3900L * 1024 * 1024;
            }

            // On FAT32 an oversized WIM must never reach the normal copy pass -
            // it cannot exist on FAT32 at all, so exclude it and copy .swm
            // chunks instead. On NTFS the regular copy handles it fine.
            bool excludeBig = tooBig && fat32;

            Report("Copying Windows setup files to USB...", 40);
            string excludeArgs = excludeBig ? " /XF " + bigImage : "";
            RunRobocopyArgs(isoRoot, usbDest, excludeArgs);

            if (excludeBig)
            {
                Report("Splitting " + Path.GetFileName(bigImage) + " (" +
                    UsbDisk.FormatSize(bigSize) + ") into .swm chunks for FAT32...", 70);

                string swmStaging = Path.Combine(Path.GetTempPath(), "winusb_split");
                if (Directory.Exists(swmStaging)) Directory.Delete(swmStaging, true);
                Directory.CreateDirectory(swmStaging);

                try
                {
                    Run("dism.exe", "/Split-Image /ImageFile:" + Q(bigImage) +
                        " /SWMFile:" + Q(Path.Combine(swmStaging, "install.swm")) + " /FileSize:3800");

                    Report("Copying split image chunks...", 85);
                    RunRobocopy(swmStaging, Path.Combine(usbDest, "sources"));

                    result.Warnings.Add(
                        Path.GetFileName(bigImage) + " was larger than 4 GB and was written as install.swm chunks " +
                        "in sources\\ (Windows setup reads these automatically).");
                }
                finally
                {
                    try { Directory.Delete(swmStaging, true); } catch { }
                }
            }
            else if (tooBig)
            {
                result.Warnings.Add(
                    Path.GetFileName(bigImage) + " is larger than 4 GB; NTFS was selected so no split was needed.");
            }

            Report("Setup files copied.", 95);
        }

        static void RunRobocopyArgs(string source, string dest, string extraArgs)
        {
            string args = Q(source) + " " + Q(dest) + " /E /R:2 /W:2 /NFL /NDL /NJH /NJS /NP" + extraArgs;
            using (Process p = Process.Start(MakePsi("robocopy.exe", args)))
            {
                string stdout = p.StandardOutput.ReadToEnd();
                p.StandardError.ReadToEnd();
                p.WaitForExit();
                if (p.ExitCode >= 8)
                    throw new InvalidOperationException(
                        "robocopy failed (exit code " + p.ExitCode + "):\n" + stdout.Trim());
            }
        }

        static string FindBigImage(string isoRoot)
        {
            string wim = Path.Combine(isoRoot, "sources", "install.wim");
            if (File.Exists(wim)) return wim;
            string esd = Path.Combine(isoRoot, "sources", "install.esd");
            if (File.Exists(esd)) return esd;
            return null;
        }

        // ------------------------------------------------------------------
        // Office payload
        // ------------------------------------------------------------------

        // Rejects anything FAT32 cannot store (max file size 4 GB - 1). Called
        // BEFORE the stick is formatted so we fail safely. The Windows ISO's
        // oversized WIM is handled by splitting; the Office payload cannot be.
        static void EnsureFat32Compatible(string root, string what)
        {
            try
            {
                foreach (string file in Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories))
                {
                    long len;
                    try { len = new FileInfo(file).Length; }
                    catch { continue; }
                    if (len > 4L * 1024 * 1024 * 1024 - 1)
                        throw new InvalidOperationException(string.Format(
                            "{0} contains a file larger than 4 GB ({1}) which FAT32 cannot store. " +
                            "Nothing has been written to the USB disk. Use an Office ISO whose largest file is " +
                            "under 4 GB, or choose NTFS (legacy BIOS boot only).", what, Path.GetFileName(file)));
                }
            }
            catch (InvalidOperationException) { throw; }
            catch { }
        }

        // Fails before formatting when the payload simply cannot fit, instead
        // of dying halfway through a 10 GB copy.
        static void EnsureSpace(string isoRoot, string officeRoot, List<SoftwareItem> software, UsbDisk target)
        {
            long needed = DirSize(isoRoot);
            if (officeRoot != null) needed += DirSize(officeRoot);
            foreach (SoftwareItem item in software)
            {
                try { needed += new FileInfo(item.FilePath).Length; }
                catch { }
            }

            long usable = (long)(target.SizeBytes * 0.97); // filesystem overhead
            if (needed > usable)
                throw new InvalidOperationException(string.Format(
                    "Not enough room on the USB disk: the payload needs about {0} but the disk holds {1}. " +
                    "Nothing has been written to the USB disk.",
                    UsbDisk.FormatSize(needed), UsbDisk.FormatSize(target.SizeBytes)));
        }

        static long DirSize(string root)
        {
            long total = 0;
            try
            {
                foreach (string file in Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories))
                {
                    try { total += new FileInfo(file).Length; }
                    catch { }
                }
            }
            catch { }
            return total;
        }

        // Copies the Office ISO's payload into the $OEM$ folder and writes the
        // ODT configurations that install it silently on the target PC.
        //
        // There is deliberately no product ID to configure: one configuration
        // is written per known Office edition and the install script tries
        // them in order until the one matching the ISO's contents succeeds.
        static void CopyOfficePayload(string officeRoot, string usbRoot, OfficeSetup office, BuildResult result)
        {
            string dest = Path.Combine(usbRoot + ":\\", "sources", "$OEM$", "$$", "Setup",
                "Software", OfficeSupport.PayloadFolderName);
            Directory.CreateDirectory(dest);

            RunRobocopy(officeRoot, dest);

            // 1) The ISO's own configuration.xml (when it has one) is tried
            //    first - its product ID is authoritative for that media.
            if (office.UseIsoConfig)
            {
                string isoConfig = OfficeSupport.FindIsoConfig(officeRoot);
                if (isoConfig != null)
                {
                    string rewritten = OfficeSupport.RewriteIsoConfig(File.ReadAllText(isoConfig));
                    if (rewritten != null)
                    {
                        File.WriteAllText(Path.Combine(dest, OfficeSupport.IsoConfigFileName), rewritten, new UTF8Encoding(false));
                        string isoProduct = OfficeSupport.FindProductId(rewritten);
                        result.Warnings.Add("Office: the ISO ships its own configuration.xml - it is tried first" +
                            (string.IsNullOrEmpty(isoProduct) ? "." : " (" + isoProduct + ")."));
                    }
                }
            }

            // 2) Candidate configurations, one per known Office edition, most
            //    likely first (the ISO's volume label is used as a hint).
            string volumeLabel = GetVolumeLabel(officeRoot);
            List<OfficeProduct> candidates = OfficeSupport.OrderedCandidates(volumeLabel);
            for (int i = 0; i < candidates.Count; i++)
            {
                string xml = OfficeSupport.GenerateConfigurationXml(candidates[i].Id, office.Language, office.Edition);
                File.WriteAllText(Path.Combine(dest, OfficeSupport.CandidateConfigName(i + 1, candidates[i].Id)),
                    xml, new UTF8Encoding(false));
            }

            result.Warnings.Add("Queued: Microsoft Office from " + Path.GetFileName(office.IsoPath) +
                " - the product is detected automatically at install time (" + candidates.Count +
                " known editions" + (volumeLabel.Length > 0 ? ", ISO label \"" + volumeLabel + "\"" : "") + ").");

            result.Warnings.Add("Office: the Language setting must exist in your ISO (currently " + office.Language +
                "); volume editions need KMS/MAK activation after install.");
        }

        // ------------------------------------------------------------------
        // $OEM$ payload
        // ------------------------------------------------------------------

        static string PayloadSafeName(SoftwareItem item, int index)
        {
            string ext = Path.GetExtension(item.FilePath).ToLowerInvariant();
            return "sw" + index.ToString("00") + "_" + SanitizeFileName(Path.GetFileNameWithoutExtension(item.FilePath)) + ext;
        }

        // Writes sources\$OEM$\$$\Setup\{Scripts,Software} into the USB root.
        // Windows setup only processes $OEM$ when it sits INSIDE sources\.
        static void WriteOemPayload(string usbRoot, List<SoftwareItem> software, OfficeSetup office, BuildResult result)
        {
            string usbDest = usbRoot + ":\\";
            string scriptsDir = Path.Combine(usbDest, "sources", "$OEM$", "$$", "Setup", "Scripts");
            string softwareDir = Path.Combine(usbDest, "sources", "$OEM$", "$$", "Setup", "Software");
            Directory.CreateDirectory(scriptsDir);
            Directory.CreateDirectory(softwareDir);

            for (int i = 0; i < software.Count; i++)
            {
                SoftwareItem item = software[i];
                File.Copy(item.FilePath, Path.Combine(softwareDir, PayloadSafeName(item, i + 1)), true);
                result.Warnings.Add("Queued: " + item.FileName + " [" + InstallerDetector.KindLabel(item.Kind) + "]");
            }

            File.WriteAllText(Path.Combine(scriptsDir, "SetupComplete.cmd"),
                GenerateSetupCompleteCmd(software, office), new UTF8Encoding(false));

            // Fallback hook: some Windows 11 builds skip SetupComplete.cmd. This
            // copy lands in the Default profile's Startup folder, so it runs at
            // first logon IF (and only if) SetupComplete never ran - the flag
            // file it checks is only written by SetupComplete itself.
            string startupDir = Path.Combine(usbDest, "$OEM$", "$1", "Users", "Default",
                "AppData", "Roaming", "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
            Directory.CreateDirectory(startupDir);
            File.WriteAllText(Path.Combine(startupDir, "WinUSB-Install.cmd"),
                GenerateFallbackCmd(software, office), new UTF8Encoding(false));
        }

        // The Office install block shared by SetupComplete.cmd and the fallback
        // script. The product is auto-detected at install time: every
        // configuration_*.xml written at build time is tried in name order and
        // the first one that actually installs wins. Wrong products fail fast
        // against the local source (nothing is installed), and a success only
        // counts when the ClickToRun engine is really present afterwards - so
        // a misleading exit code cannot stop the search early. Runs last so a
        // stalled Office install cannot block the smaller apps.
        static void AppendOfficeBlock(StringBuilder sb, OfficeSetup office)
        {
            if (office == null) return;
            sb.AppendLine("echo [%TIME%] Installing Microsoft Office (product auto-detected) >> \"%LOG%\"");
            sb.AppendLine("pushd \"" + OfficeSupport.PayloadFolderName + "\"");
            sb.AppendLine("setlocal enabledelayedexpansion");
            sb.AppendLine("set \"PF86=%ProgramFiles(x86)%\"");
            sb.AppendLine("set OFFICE_OK=0");
            sb.AppendLine("for %%C in (\"configuration_*.xml\") do (");
            sb.AppendLine("    if !OFFICE_OK!==0 (");
            sb.AppendLine("        echo [!TIME!] Office: trying %%~nxC >> \"%LOG%\"");
            sb.AppendLine("        start /wait \"\" setup.exe /configure \"%%~C\"");
            sb.AppendLine("        set RC=!ERRORLEVEL!");
            sb.AppendLine("        echo [!TIME!] Office: %%~nxC exit code !RC! >> \"%LOG%\"");
            sb.AppendLine("        if !RC!==0 if exist \"%ProgramFiles%\\Common Files\\Microsoft Shared\\ClickToRun\\OfficeClickToRun.exe\" set OFFICE_OK=1");
            sb.AppendLine("        if !RC!==0 if exist \"%PF86%\\Common Files\\Microsoft Shared\\ClickToRun\\OfficeClickToRun.exe\" set OFFICE_OK=1");
            sb.AppendLine("        if !RC!==3010 set OFFICE_OK=1");
            sb.AppendLine("    )");
            sb.AppendLine(")");
            sb.AppendLine("if !OFFICE_OK!==1 (");
            sb.AppendLine("    echo [!TIME!] Office installed successfully. >> \"%LOG%\"");
            sb.AppendLine(") else (");
            sb.AppendLine("    echo [!TIME!] Office: no known product ID matched this ISO - check the OfficeSetup logs in %WINDIR%\\Setup\\Scripts >> \"%LOG%\"");
            sb.AppendLine(")");
            sb.AppendLine("endlocal");
            sb.AppendLine("popd");
            sb.AppendLine();
        }

        public static string GenerateSetupCompleteCmd(List<SoftwareItem> software, OfficeSetup office)
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
                        sb.AppendLine("msiexec /i \"" + safeName + "\" " + item.Args +
                            " /L*v \"%WINDIR%\\Setup\\Scripts\\" + safeName + ".msilog\" >> \"%LOG%\" 2>&1");
                        break;
                    default:
                        sb.AppendLine("\"" + safeName + "\" " + item.Args + " >> \"%LOG%\" 2>&1");
                        break;
                }
                sb.AppendLine("echo [%TIME%] " + label + " exit code %ERRORLEVEL% >> \"%LOG%\"");
                sb.AppendLine();
            }

            AppendOfficeBlock(sb, office);

            sb.AppendLine("popd");
            sb.AppendLine("echo WinUSB software install finished %DATE% %TIME% >> \"%LOG%\"");
            // Marker for the first-logon fallback: its presence means this
            // script DID run, so the fallback can remove itself silently.
            sb.AppendLine("echo done > \"%WINDIR%\\Setup\\Scripts\\winusb_done.flag\"");
            return sb.ToString();
        }

        // First-logon fallback version of the install script. Placed in the
        // Default profile Startup folder via $OEM$\$1. Runs only if
        // SetupComplete.cmd was never executed (no flag file), then deletes
        // itself. Runs as the logged-on user; machine-wide MSIs will pop ONE
        // UAC consent prompt the first time.
        public static string GenerateFallbackCmd(List<SoftwareItem> software, OfficeSetup office)
        {
            StringBuilder sb = new StringBuilder();
            sb.AppendLine("@echo off");
            sb.AppendLine("rem WinUSB first-logon fallback - only acts if SetupComplete.cmd never ran.");
            sb.AppendLine("if exist \"%WINDIR%\\Setup\\Scripts\\winusb_done.flag\" goto cleanup");
            sb.AppendLine("set LOG=%WINDIR%\\Setup\\Scripts\\winusb_install.log");
            sb.AppendLine("echo WinUSB fallback install started %DATE% %TIME% >> \"%LOG%\"");
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
                        sb.AppendLine("msiexec /i \"" + safeName + "\" " + item.Args +
                            " /L*v \"%WINDIR%\\Setup\\Scripts\\" + safeName + ".msilog\" >> \"%LOG%\" 2>&1");
                        break;
                    default:
                        sb.AppendLine("\"" + safeName + "\" " + item.Args + " >> \"%LOG%\" 2>&1");
                        break;
                }
                sb.AppendLine("echo [%TIME%] " + label + " exit code %ERRORLEVEL% >> \"%LOG%\"");
                sb.AppendLine();
            }

            AppendOfficeBlock(sb, office);

            sb.AppendLine("popd");
            sb.AppendLine("echo WinUSB fallback install finished %DATE% %TIME% >> \"%LOG%\"");
            sb.AppendLine(":cleanup");
            sb.AppendLine("del \"%~f0\"");
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
