using System;
using System.Drawing;
using System.IO;
using System.Windows.Forms;

namespace WinUSB
{
    // Small dialog for choosing the optional Office ISO and how it installs.
    // There is no product ID field on purpose - the product is auto-detected
    // at install time (see OfficeSupport).
    public class OfficeDialog : Form
    {
        TextBox txtIso;
        Label lblIsoInfo;
        TextBox txtLang;
        ComboBox cboEdition;
        CheckBox chkUseConfig;
        Button btnOk, btnCancel;

        public OfficeSetup Result;

        public OfficeDialog(OfficeSetup existing)
        {
            Text = "Microsoft Office from ISO (optional)";
            Font = new Font("Segoe UI", 9F);
            StartPosition = FormStartPosition.CenterParent;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MinimizeBox = false;
            MaximizeBox = false;
            ShowInTaskbar = false;
            ClientSize = new Size(560, 286);

            Label l1 = new Label { Text = "Office ISO file (2019 / 2021 / 2024 / Microsoft 365 offline image):", AutoSize = true, Location = new Point(12, 10) };
            txtIso = new TextBox { Location = new Point(12, 30), Width = 420 };
            Button btnBrowse = new Button { Text = "Browse...", Location = new Point(440, 28), Width = 100 };
            btnBrowse.Click += BtnBrowse_Click;
            lblIsoInfo = new Label { Location = new Point(12, 56), Width = 528, ForeColor = Color.Gray, Text = "" };

            Label lblNote = new Label
            {
                Location = new Point(12, 84),
                Size = new Size(528, 32),
                Text = "No product ID needed: WinUSB tries every known Office edition in order at install time " +
                       "and keeps the one that matches this ISO's contents."
            };

            Label l3 = new Label { Text = "Language:", AutoSize = true, Location = new Point(12, 126) };
            txtLang = new TextBox { Location = new Point(12, 146), Width = 120 };
            Label l4 = new Label { Text = "Edition:", AutoSize = true, Location = new Point(150, 126) };
            cboEdition = new ComboBox { Location = new Point(150, 146), Width = 120, DropDownStyle = ComboBoxStyle.DropDownList };
            cboEdition.Items.AddRange(new object[] { "64-bit", "32-bit" });

            Label lblLangNote = new Label
            {
                Location = new Point(12, 176),
                AutoSize = true,
                ForeColor = Color.Gray,
                Text = "The language must match your ISO (use en-us for English media)."
            };

            chkUseConfig = new CheckBox { Location = new Point(12, 202), Width = 528, Text = "Also try the configuration.xml inside the ISO first, if it has one", Checked = true };

            btnOk = new Button { Text = "OK", Location = new Point(356, 244), Width = 90 };
            btnOk.Click += BtnOk_Click;
            btnCancel = new Button { Text = "Cancel", Location = new Point(456, 244), Width = 90, DialogResult = DialogResult.Cancel };

            AcceptButton = btnOk;
            CancelButton = btnCancel;

            Controls.AddRange(new Control[] {
                l1, txtIso, btnBrowse, lblIsoInfo,
                lblNote,
                l3, txtLang, l4, cboEdition, lblLangNote,
                chkUseConfig, btnOk, btnCancel
            });

            if (existing != null)
            {
                txtIso.Text = existing.IsoPath;
                txtLang.Text = existing.Language;
                cboEdition.SelectedIndex = existing.Edition == "32" ? 1 : 0;
                chkUseConfig.Checked = existing.UseIsoConfig;
                ShowIsoSize(existing.IsoPath);
            }
            else
            {
                txtLang.Text = "en-us";
                cboEdition.SelectedIndex = 0;
            }
        }

        void BtnBrowse_Click(object sender, EventArgs e)
        {
            using (OpenFileDialog dlg = new OpenFileDialog())
            {
                dlg.Title = "Select your Microsoft Office ISO";
                dlg.Filter = "ISO images|*.iso|All files|*.*";
                if (dlg.ShowDialog(this) != DialogResult.OK) return;
                txtIso.Text = dlg.FileName;
                ShowIsoSize(dlg.FileName);
            }
        }

        void ShowIsoSize(string path)
        {
            try
            {
                FileInfo fi = new FileInfo(path);
                lblIsoInfo.Text = fi.Exists ? fi.Name + " - " + UsbDisk.FormatSize(fi.Length) : "";
            }
            catch { lblIsoInfo.Text = ""; }
        }

        void BtnOk_Click(object sender, EventArgs e)
        {
            string iso = txtIso.Text.Trim();
            if (iso.Length == 0 || !File.Exists(iso))
            {
                MessageBox.Show(this, "Pick the Office ISO file first.", "WinUSB",
                    MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }

            string lang = txtLang.Text.Trim();
            if (lang.Length == 0) lang = "en-us";

            Result = new OfficeSetup();
            Result.IsoPath = iso;
            Result.Language = lang;
            Result.Edition = cboEdition.SelectedIndex == 1 ? "32" : "64";
            Result.UseIsoConfig = chkUseConfig.Checked;

            DialogResult = DialogResult.OK;
            Close();
        }
    }
}
