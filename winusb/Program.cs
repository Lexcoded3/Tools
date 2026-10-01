using System;
using System.Security.Principal;
using System.Windows.Forms;

namespace WinUSB
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            // Hidden helper mode used by the build smoke test:
            //   WinUSB.exe --list-disks   ->  "index|model|size|letters" per USB disk
            if (args.Length == 1 && args[0] == "--list-disks")
            {
                foreach (UsbDisk d in UsbBuilder.ListUsbDisks())
                    Console.WriteLine(d.DiskNumber + "|" + d.Model + "|" + d.SizeBytes + "|" +
                        string.Join(",", d.DriveLetters.ToArray()));
                return;
            }

            if (!IsAdmin())
            {
                MessageBox.Show(
                    "WinUSB should run as Administrator (right-click the EXE > Run as administrator).\n" +
                    "Formatting disks and writing boot sectors will fail otherwise.",
                    "WinUSB", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm());
        }

        static bool IsAdmin()
        {
            try
            {
                using (WindowsIdentity id = WindowsIdentity.GetCurrent())
                {
                    WindowsPrincipal principal = new WindowsPrincipal(id);
                    return principal.IsInRole(WindowsBuiltInRole.Administrator);
                }
            }
            catch { return false; }
        }
    }
}
