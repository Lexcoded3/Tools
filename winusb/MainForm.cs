using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Threading;
using System.Windows.Forms;

namespace WinUSB
{
    public class MainForm : Form
    {
        // ISO
        TextBox txtIso;
        Button btnBrowseIso;
        Label lblIsoInfo;

        // Target disk
        ComboBox cboDisks;
        Button btnRefreshDisks;
        RadioButton rbFat32;
        RadioButton rbNtfs;
        TextBox txtLabel;

        // Software list
        ListBox lstSoftware;
        Button btnAddSw, btnRemoveSw, btnUpSw, btnDownSw, btnPreview;
        Label lblSwKind;
        TextBox txtArgs;
        bool updatingArgs;

        // Office (optional)
        Button btnAddOffice, btnRemoveOffice;
        Label lblOfficeInfo;
        OfficeSetup office;

        // Build
        Button btnBuild;
        ProgressBar prog;
        Label lblStatus;
        TextBox txtLog;

        List<UsbDisk> disks = new List<UsbDisk>();
        List<SoftwareItem> software = new List<SoftwareItem>();
        bool building;

        public MainForm()
        {
            BuildUi();
            RefreshDisks();
        }

        void BuildUi()
        {
            Text = "ByteUSB - Windows Setup USB + Auto-Install Software";
            Font = new Font("Segoe UI", 9F);
            StartPosition = FormStartPosition.CenterScreen;
            MinimumSize = new Size(760, 720);
            Size = new Size(820, 760);

            // ---- ISO row ----
            Label l1 = new Label { Text = "1. Windows ISO", AutoSize = true, Location = new Point(12, 12), ForeColor = Color.DimGray, Font = new Font(Font, FontStyle.Bold) };

            txtIso = new TextBox { Location = new Point(16, 32), Width = 640, ReadOnly = true };
            btnBrowseIso = new Button { Text = "Browse...", Location = new Point(664, 30), Width = 90 };
            btnBrowseIso.Click += BtnBrowseIso_Click;
            lblIsoInfo = new Label { Location = new Point(16, 58), Width = 740, ForeColor = Color.DimGray };

            // ---- Disk row ----
            Label l2 = new Label { Text = "2. Target USB disk", AutoSize = true, Location = new Point(12, 86), ForeColor = Color.DimGray, Font = new Font(Font, FontStyle.Bold) };

            cboDisks = new ComboBox { Location = new Point(16, 106), Width = 520, DropDownStyle = ComboBoxStyle.DropDownList };
            btnRefreshDisks = new Button { Text = "Refresh", Location = new Point(544, 104), Width = 70 };
            btnRefreshDisks.Click += delegate { RefreshDisks(); };

            rbFat32 = new RadioButton { Text = "FAT32 (UEFI + BIOS, auto-splits >4GB WIM)", Location = new Point(16, 134), AutoSize = true, Checked = true };
            rbNtfs = new RadioButton { Text = "NTFS (legacy BIOS only, no split)", Location = new Point(300, 134), AutoSize = true };
            txtLabel = new TextBox { Location = new Point(16, 158), Width = 160, Text = "WINUSB", MaxLength = 11 };

            // ---- Software ----
            Label l3 = new Label { Text = "3. Software to auto-install after Windows setup", AutoSize = true, Location = new Point(12, 190), ForeColor = Color.DimGray, Font = new Font(Font, FontStyle.Bold) };

            lstSoftware = new ListBox { Location = new Point(16, 210), Width = 460, Height = 180, HorizontalScrollbar = true };
            lstSoftware.SelectedIndexChanged += LstSoftware_SelectedIndexChanged;

            btnAddSw = new Button { Text = "Add installers...", Location = new Point(486, 210), Width = 130 };
            btnAddSw.Click += BtnAddSw_Click;
            btnRemoveSw = new Button { Text = "Remove", Location = new Point(486, 240), Width = 130, Enabled = false };
            btnRemoveSw.Click += delegate { RemoveSelected(); };
            btnUpSw = new Button { Text = "Move up", Location = new Point(486, 270), Width = 130, Enabled = false };
            btnUpSw.Click += delegate { MoveSelected(-1); };
            btnDownSw = new Button { Text = "Move down", Location = new Point(486, 300), Width = 130, Enabled = false };
            btnDownSw.Click += delegate { MoveSelected(1); };
            btnPreview = new Button { Text = "Preview script...", Location = new Point(486, 336), Width = 130 };
            btnPreview.Click += BtnPreview_Click;

            lblSwKind = new Label { Text = "Detected type: -", Location = new Point(16, 398), AutoSize = true, ForeColor = Color.DarkSlateGray };

            Label la = new Label { Text = "Silent-install arguments:", AutoSize = true, Location = new Point(220, 398) };
            txtArgs = new TextBox { Location = new Point(350, 395), Width = 266 };
            txtArgs.TextChanged += TxtArgs_TextChanged;
            Label la2 = new Label { Text = "Edit per installer. Defaults: /S (NSIS), /VERYSILENT (Inno), /qn (MSI).", AutoSize = true, Location = new Point(16, 424), ForeColor = Color.Gray };

            // ---- Office (optional) ----
            Label l4 = new Label { Text = "4. Microsoft Office (optional) - installs from your Office ISO", AutoSize = true, Location = new Point(12, 446), ForeColor = Color.DimGray, Font = new Font(Font, FontStyle.Bold) };

            btnAddOffice = new Button { Text = "Add Office ISO...", Location = new Point(16, 466), Width = 130 };
            btnAddOffice.Click += BtnAddOffice_Click;
            lblOfficeInfo = new Label { Text = "(none - optional)", Location = new Point(156, 470), Width = 520, ForeColor = Color.Gray };
            btnRemoveOffice = new Button { Text = "Remove", Location = new Point(700, 464), Width = 90, Enabled = false };
            btnRemoveOffice.Click += delegate { office = null; UpdateOfficeInfo(); };

            // ---- Build ----
            btnBuild = new Button { Text = "BUILD USB", Location = new Point(16, 506), Width = 160, Height = 36, BackColor = Color.FromArgb(0, 120, 215), ForeColor = Color.White, FlatStyle = FlatStyle.Flat };
            btnBuild.Click += BtnBuild_Click;

            prog = new ProgressBar { Location = new Point(190, 510), Width = 400, Height = 28 };
            lblStatus = new Label { Location = new Point(600, 510), AutoSize = true, Text = "Ready." };

            txtLog = new TextBox { Location = new Point(16, 550), Width = 770, Height = 150, Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, BackColor = Color.White, Font = new Font("Consolas", 8.5F) };

            Controls.AddRange(new Control[] {
                l1, txtIso, btnBrowseIso, lblIsoInfo,
                l2, cboDisks, btnRefreshDisks, rbFat32, rbNtfs, txtLabel,
                l3, lstSoftware, btnAddSw, btnRemoveSw, btnUpSw, btnDownSw, btnPreview,
                lblSwKind, la, txtArgs, la2,
                l4, btnAddOffice, lblOfficeInfo, btnRemoveOffice,
                btnBuild, prog, lblStatus, txtLog
            });

            AcceptButton = btnBrowseIso;
        }

        // ------------------------------------------------------------------

        void BtnBrowseIso_Click(object sender, EventArgs e)
        {
            using (OpenFileDialog dlg = new OpenFileDialog())
            {
                dlg.Title = "Select a Windows 10/11 ISO";
                dlg.Filter = "Windows ISO|*.iso|All files|*.*";
                if (dlg.ShowDialog() == DialogResult.OK)
                {
                    txtIso.Text = dlg.FileName;
                    ShowIsoInfo(dlg.FileName);
                }
            }
        }

        void ShowIsoInfo(string path)
        {
            try
            {
                FileInfo fi = new FileInfo(path);
                lblIsoInfo.Text = fi.Name + " - " + UsbDisk.FormatSize(fi.Length);
            }
            catch { lblIsoInfo.Text = ""; }
        }

        void RefreshDisks()
        {
            cboDisks.Items.Clear();
            try { disks = UsbBuilder.ListUsbDisks(); }
            catch (Exception ex)
            {
                Log("Disk enumeration failed: " + ex.Message);
                return;
            }

            List<UsbDisk> targets = disks.Where(d => d.IsUsb).ToList();
            foreach (UsbDisk d in targets)
                cboDisks.Items.Add(d.ToString());

            if (targets.Count == 0)
            {
                cboDisks.Items.Add("(no USB disks found)");
                cboDisks.SelectedIndex = 0;
                Log("No USB disks detected. Plug in the stick and click Refresh.");
            }
            else
            {
                cboDisks.SelectedIndex = 0;
            }
        }

        UsbDisk SelectedDisk()
        {
            int idx = cboDisks.SelectedIndex;
            if (idx < 0) return null;
            List<UsbDisk> targets = disks.Where(d => d.IsUsb).ToList();
            if (idx >= targets.Count) return null;
            return targets[idx];
        }

        void BtnAddSw_Click(object sender, EventArgs e)
        {
            using (OpenFileDialog dlg = new OpenFileDialog())
            {
                dlg.Title = "Select installers (EXE / MSI / BAT / PS1)";
                dlg.Filter = "Installers|*.exe;*.msi;*.bat;*.cmd;*.ps1|All files|*.*";
                dlg.Multiselect = true;
                if (dlg.ShowDialog() != DialogResult.OK) return;

                foreach (string path in dlg.FileNames)
                {
                    if (software.Any(s => string.Equals(s.FilePath, path, StringComparison.OrdinalIgnoreCase)))
                        continue;
                    software.Add(InstallerDetector.Detect(path));
                }
                ReloadSoftwareList();
            }
        }

        void ReloadSoftwareList()
        {
            updatingArgs = true;
            lstSoftware.BeginUpdate();
            lstSoftware.Items.Clear();
            foreach (SoftwareItem s in software)
                lstSoftware.Items.Add(s.FileName);
            lstSoftware.EndUpdate();
            updatingArgs = false;

            btnRemoveSw.Enabled = btnUpSw.Enabled = btnDownSw.Enabled = false;
            lblSwKind.Text = "Detected type: -";
            txtArgs.Text = "";
        }

        void LstSoftware_SelectedIndexChanged(object sender, EventArgs e)
        {
            if (updatingArgs) return;
            int idx = lstSoftware.SelectedIndex;
            bool has = idx >= 0;
            btnRemoveSw.Enabled = btnUpSw.Enabled = btnDownSw.Enabled = has;
            if (!has)
            {
                lblSwKind.Text = "Detected type: -";
                txtArgs.Text = "";
                return;
            }
            SoftwareItem item = software[idx];
            lblSwKind.Text = "Detected type: " + InstallerDetector.KindLabel(item.Kind);
            updatingArgs = true;
            txtArgs.Text = item.Args;
            updatingArgs = false;
        }

        void TxtArgs_TextChanged(object sender, EventArgs e)
        {
            if (updatingArgs) return;
            int idx = lstSoftware.SelectedIndex;
            if (idx >= 0) software[idx].Args = txtArgs.Text;
        }

        void RemoveSelected()
        {
            int idx = lstSoftware.SelectedIndex;
            if (idx < 0) return;
            software.RemoveAt(idx);
            ReloadSoftwareList();
        }

        void MoveSelected(int delta)
        {
            int idx = lstSoftware.SelectedIndex;
            int next = idx + delta;
            if (idx < 0 || next < 0 || next >= software.Count) return;
            SoftwareItem item = software[idx];
            software.RemoveAt(idx);
            software.Insert(next, item);
            ReloadSoftwareList();
            lstSoftware.SelectedIndex = next;
        }

        // ------------------------------------------------------------------

        void BtnAddOffice_Click(object sender, EventArgs e)
        {
            using (OfficeDialog dlg = new OfficeDialog(office))
            {
                if (dlg.ShowDialog(this) == DialogResult.OK)
                {
                    office = dlg.Result;
                    UpdateOfficeInfo();
                }
            }
        }

        void UpdateOfficeInfo()
        {
            if (office == null)
            {
                lblOfficeInfo.Text = "(none - optional)";
                lblOfficeInfo.ForeColor = Color.Gray;
                btnRemoveOffice.Enabled = false;
            }
            else
            {
                lblOfficeInfo.Text = Path.GetFileName(office.IsoPath) + "  -  " + office.Language + ", " +
                    office.Edition + "-bit  (product auto-detected at install)";
                lblOfficeInfo.ForeColor = Color.DarkSlateGray;
                btnRemoveOffice.Enabled = true;
            }
        }

        // ------------------------------------------------------------------

        void BtnPreview_Click(object sender, EventArgs e)
        {
            if (software.Count == 0 && office == null)
            {
                MessageBox.Show("Add at least one installer (or an Office ISO) first - the preview\n" +
                    "shows how everything will be installed after Windows setup.",
                    "WinUSB", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }

            string script = UsbBuilder.GenerateSetupCompleteCmd(software, office);

            Form dlg = new Form();
            dlg.Text = "SetupComplete.cmd - preview (reflects the current list and arguments)";
            dlg.Font = new Font("Segoe UI", 9F);
            dlg.StartPosition = FormStartPosition.CenterParent;
            dlg.Size = new Size(760, 560);
            dlg.MinimizeBox = false;
            dlg.MaximizeBox = false;
            dlg.ShowInTaskbar = false;

            TextBox txt = new TextBox
            {
                Multiline = true,
                ReadOnly = true,
                ScrollBars = ScrollBars.Both,
                WordWrap = false,
                Dock = DockStyle.Fill,
                BackColor = Color.White,
                Font = new Font("Consolas", 9F),
                Text = script
            };

            Panel bottom = new Panel { Dock = DockStyle.Bottom, Height = 40 };
            Button btnCopy = new Button { Text = "Copy", Location = new Point(552, 8), Width = 84 };
            btnCopy.Click += delegate
            {
                try { Clipboard.SetText(script); }
                catch (Exception) { MessageBox.Show(dlg, "Clipboard is busy - try again.", "WinUSB"); }
            };
            Button btnClose = new Button { Text = "Close", Location = new Point(644, 8), Width = 84 };
            btnClose.Click += delegate { dlg.Close(); };
            bottom.Controls.Add(btnCopy);
            bottom.Controls.Add(btnClose);

            dlg.Controls.Add(txt);
            dlg.Controls.Add(bottom);
            dlg.ShowDialog(this);
        }

        // ------------------------------------------------------------------

        void BtnBuild_Click(object sender, EventArgs e)
        {
            if (building) return;

            string iso = txtIso.Text;
            if (string.IsNullOrEmpty(iso) || !File.Exists(iso))
            {
                MessageBox.Show("Select a Windows ISO first.", "ByteUSB", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }

            UsbDisk target = SelectedDisk();
            if (target == null)
            {
                MessageBox.Show("Select a target USB disk (or plug in the stick and Refresh).", "ByteUSB", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }

            string extraItems = "";
            if (software.Count > 0)
                extraItems += " plus " + software.Count + " selected installer" + (software.Count == 1 ? "" : "s");
            if (office != null)
                extraItems += extraItems.Length > 0 ? " and Microsoft Office" : " plus Microsoft Office";

            string warning =
                "This will ERASE EVERYTHING on:\n\n  " + target.ToString() + "\n\n" +
                "The whole disk will be repartitioned and written with Windows setup files" +
                extraItems + ".\n\nContinue?";
            if (MessageBox.Show(warning, "Confirm - All data will be destroyed",
                MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) != DialogResult.Yes)
                return;

            IsoSelection sel = new IsoSelection();
            sel.IsoPath = iso;
            sel.Software = software;
            sel.Office = office;

            bool fat32 = rbFat32.Checked;
            string label = string.IsNullOrWhiteSpace(txtLabel.Text) ? "WINUSB" : txtLabel.Text.Trim();

            building = true;
            btnBuild.Enabled = false;
            prog.Value = 0;

            ThreadPool.QueueUserWorkItem(delegate
            {
                BuildResult result = UsbBuilder.Build(sel, target, label, fat32);
                BeginInvoke((MethodInvoker)delegate
                {
                    building = false;
                    btnBuild.Enabled = true;

                    if (result.Success)
                    {
                        string extras = result.Warnings.Count > 0
                            ? "\n\nNotes:\n  - " + string.Join("\n  - ", result.Warnings.ToArray())
                            : "";
                        MessageBox.Show("USB drive is ready. Boot the target PC from it, install Windows, " +
                            "and your software installs automatically at the end of setup." + extras,
                            "WinUSB", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    }
                    else
                    {
                        MessageBox.Show("Build failed:\n\n" + result.Error, "WinUSB",
                            MessageBoxButtons.OK, MessageBoxIcon.Error);
                    }
                });
            });
        }

        // Progress + log marshaled to the UI thread.

        protected override void OnLoad(EventArgs e)
        {
            base.OnLoad(e);
            UsbBuilder.Progress += UsbBuilder_Progress;
            Log("WinUSB ready. 1) pick ISO  2) pick USB  3) add installers  4) BUILD.");
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            UsbBuilder.Progress -= UsbBuilder_Progress;
            base.OnFormClosed(e);
        }

        void UsbBuilder_Progress(object sender, ProgressEventArgs ev)
        {
            if (InvokeRequired)
            {
                try { BeginInvoke((MethodInvoker)delegate { ApplyProgress(ev); }); }
                catch (ObjectDisposedException) { }
                return;
            }
            ApplyProgress(ev);
        }

        void ApplyProgress(ProgressEventArgs ev)
        {
            if (ev.Percent >= 0)
            {
                prog.Style = ProgressBarStyle.Blocks;
                prog.Value = Math.Min(100, Math.Max(prog.Minimum, ev.Percent));
            }
            else
            {
                prog.Style = ProgressBarStyle.Marquee;
            }
            lblStatus.Text = ev.Message;
            Log(ev.Message);
        }

        void Log(string line)
        {
            if (txtLog.IsDisposed) return;
            txtLog.AppendText("[" + DateTime.Now.ToString("HH:mm:ss") + "] " + line + Environment.NewLine);
        }
    }
}
