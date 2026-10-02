using System;
using System.Drawing;
using System.IO;
using System.Windows.Forms;

namespace WinUSB
{
    // Small dialog for choosing the optional Office ISO and how it installs.
    public class OfficeDialog : Form
    {
        TextBox txtIso;
        Label lblIsoInfo;
        ComboBox cboProduct;
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
            ClientSize = new Size(560, 296);

            Label l1 = new Label { Text = "Office ISO file (2019 / 2021 / Microsoft 365 offline image):", AutoSize = true, Location = new Point(12, 10) };
            txtIso = new TextBox { Location = new Point(12, 30), Width = 420 };
            Button btnBrowse = new Button { Text = "Browse...", Location = new Point(440, 28), Width = 100 };
            btnBrowse.Click += BtnBrowse_Click;
            lblIsoInfo = new Label { Location = new Point(12, 56), Width = 528, ForeColor = Color.Gray, Text = "" };

            Label l2 = new Label { Text = "Product ID (must match the ISO you own):", AutoSize = true, Location = new Point(12, 84) };
            cboProduct = new ComboBox { Location = new Point(12, 104), Width = 528, DropDownStyle = ComboBoxStyle.DropDown };
            foreach (OfficeProduct p in OfficeSupport.Products)
                cboProduct.Items.Add(p.Id + " - " + p.Label);

            Label l2b = new Label { Text = "Tip: any ODT product ID works - type it directly, e.g. ProPlus2021Volume, O365ProPlusRetail.", AutoSize = true, Location = new Point(12, 132), ForeColor = Color.Gray };

            Label l3 = new Label { Text = "Language:", AutoSize = true, Location = new Point(12, 156) };
            txtLang = new TextBox { Location = new Point(12, 176), Width = 120 };
            Label l4 = new Label { Text = "Edition:", AutoSize = true, Location = new Point(150, 156) };
            cboEdition = new ComboBox { Location = new Point(150, 176), Width = 120, DropDownStyle = ComboBoxStyle.DropDownList };
            cboEdition.Items.AddRange(new object[] { "64-bit", "32-bit" });

            chkUseConfig = new CheckBox { Location = new Point(12, 208), Width = 528, Text = "Use the configuration.xml inside the ISO if it has one (SourcePath is fixed up)", Checked = true };

            btnOk = new Button { Text = "OK", Location = new Point(356, 254), Width = 90 };
            btnOk.Click += BtnOk_Click;
            btnCancel = new Button { Text = "Cancel", Location = new Point(456, 254), Width = 90, DialogResult = DialogResult.Cancel };

            AcceptButton = btnOk;
            CancelButton = btnCancel;

            Controls.AddRange(new Control[] {
                l1, txtIso, btnBrowse, lblIsoInfo,
                l2, cboProduct, l2b,
                l3, txtLang, l4, cboEdition,
                chkUseConfig, btnOk, btnCancel
            });

            if (existing != null)
            {
                txtIso.Text = existing.IsoPath;
                txtLang.Text = existing.Language;
                cboEdition.SelectedIndex = existing.Edition == "32" ? 1 : 0;
                chkUseConfig.Checked = existing.UseIsoConfig;
                SelectProduct(existing.ProductId);
                ShowIsoSize(existing.IsoPath);
            }
            else
            {
                txtLang.Text = "en-us";
                cboEdition.SelectedIndex = 0;
                SelectProduct("ProPlus2021Volume");
            }
        }

        void SelectProduct(string id)
        {
            foreach (object item in cboProduct.Items)
            {
                string s = item.ToString();
                if (s.StartsWith(id + " - ", StringComparison.OrdinalIgnoreCase))
                {
                    cboProduct.SelectedItem = item;
                    return;
                }
            }
            cboProduct.Text = id;
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

            string text = cboProduct.Text.Trim();
            int sep = text.IndexOf(" - ");
            string product = sep > 0 ? text.Substring(0, sep).Trim() : text;
            if (product.Length == 0)
            {
                MessageBox.Show(this, "Enter the Office product ID (e.g. ProPlus2021Volume).", "WinUSB",
                    MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }

            string lang = txtLang.Text.Trim();
            if (lang.Length == 0) lang = "en-us";

            Result = new OfficeSetup();
            Result.IsoPath = iso;
            Result.ProductId = product;
            Result.Language = lang;
            Result.Edition = cboEdition.SelectedIndex == 1 ? "32" : "64";
            Result.UseIsoConfig = chkUseConfig.Checked;

            DialogResult = DialogResult.OK;
            Close();
        }
    }
}
