using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Xml;

namespace WinUSB
{
    public class OfficeProduct
    {
        public string Id;
        public string Label;
        public OfficeProduct(string id, string label) { Id = id; Label = label; }
    }

    // One optional Office ISO included in the build. The ISO's own files are
    // copied into the $OEM$ payload and installed silently on the target PC by
    // the Office Deployment Tool (setup.exe /configure configuration.xml).
    public class OfficeSetup
    {
        public string IsoPath = "";
        public string ProductId = "ProPlus2021Volume";
        public string Language = "en-us";
        public string Edition = "64";    // "64" or "32"
        public bool UseIsoConfig = true; // reuse the ISO's own configuration.xml when present
    }

    public static class OfficeSupport
    {
        public const string PayloadFolderName = "Office";

        // Where the Office payload ends up on the TARGET machine: $OEM$\$$ maps
        // to %WINDIR% during setup, so the files land here. This is also the
        // ODT SourcePath written into configuration.xml.
        public const string TargetFolder = @"C:\Windows\Setup\Scripts\Software\Office";

        // Folder on the target machine where the ODT writes its own logs.
        public const string TargetLogFolder = @"C:\Windows\Setup\Scripts";

        public static List<OfficeProduct> Products
        {
            get
            {
                List<OfficeProduct> list = new List<OfficeProduct>();
                list.Add(new OfficeProduct("ProPlus2021Volume", "Office 2021 Pro Plus (volume)"));
                list.Add(new OfficeProduct("Standard2021Volume", "Office 2021 Standard (volume)"));
                list.Add(new OfficeProduct("Professional2021Retail", "Office 2021 Professional (retail)"));
                list.Add(new OfficeProduct("HomeBusiness2021Retail", "Office 2021 Home & Business (retail)"));
                list.Add(new OfficeProduct("HomeStudent2021Retail", "Office 2021 Home & Student (retail)"));
                list.Add(new OfficeProduct("ProPlus2019Volume", "Office 2019 Pro Plus (volume)"));
                list.Add(new OfficeProduct("Standard2019Volume", "Office 2019 Standard (volume)"));
                list.Add(new OfficeProduct("Professional2019Retail", "Office 2019 Professional (retail)"));
                list.Add(new OfficeProduct("O365ProPlusRetail", "Microsoft 365 Apps for enterprise"));
                list.Add(new OfficeProduct("O365BusinessRetail", "Microsoft 365 Apps for business"));
                return list;
            }
        }

        // Volume editions use fixed perpetual channels; retail and Microsoft 365
        // use Current. A mismatched channel makes ODT report that the product
        // was not found in the local source.
        public static string ChannelFor(string productId)
        {
            string id = (productId ?? "").Trim().ToLowerInvariant();
            if (id.EndsWith("volume"))
            {
                if (id.Contains("2021")) return "PerpetualVL2021";
                if (id.Contains("2019")) return "PerpetualVL2019";
                if (id.Contains("2016")) return "PerpetualVL2016";
            }
            return "Current";
        }

        public static bool LooksLikeOfficeIso(string isoRoot)
        {
            return File.Exists(Path.Combine(isoRoot, "setup.exe"));
        }

        // ODT-based images usually ship an example configuration.xml at the root.
        public static string FindIsoConfig(string isoRoot)
        {
            string p = Path.Combine(isoRoot, "configuration.xml");
            return File.Exists(p) ? p : null;
        }

        public static string GenerateConfigurationXml(OfficeSetup office)
        {
            string product = (office.ProductId ?? "").Trim();
            string lang = (office.Language ?? "").Trim();
            if (lang.Length == 0) lang = "en-us";
            string edition = office.Edition == "32" ? "32" : "64";

            StringBuilder sb = new StringBuilder();
            sb.AppendLine("<Configuration>");
            sb.AppendLine("  <Add SourcePath=\"" + X(TargetFolder) + "\" OfficeClientEdition=\"" + edition +
                          "\" Channel=\"" + X(ChannelFor(product)) + "\">");
            sb.AppendLine("    <Product ID=\"" + X(product) + "\">");
            sb.AppendLine("      <Language ID=\"" + X(lang) + "\" />");
            sb.AppendLine("    </Product>");
            sb.AppendLine("  </Add>");
            sb.AppendLine("  <Display Level=\"None\" AcceptEula=\"TRUE\" />");
            sb.AppendLine("  <Property Name=\"AUTOACTIVATE\" Value=\"0\" />");
            sb.AppendLine("  <Property Name=\"FORCEAPPSHUTDOWN\" Value=\"TRUE\" />");
            sb.AppendLine("  <Logging Level=\"Standard\" Path=\"" + X(TargetLogFolder) + "\" />");
            sb.AppendLine("</Configuration>");
            return sb.ToString();
        }

        // Takes the configuration.xml found inside an Office ISO and makes it
        // work from the payload folder: SourcePath is repointed and the display
        // is forced fully silent. Returns null when the file has no usable
        // <Add> block (caller then falls back to a generated configuration).
        public static string RewriteIsoConfig(string xml)
        {
            try
            {
                XmlDocument doc = new XmlDocument();
                doc.LoadXml(xml);

                XmlElement add = doc.SelectSingleNode("/Configuration/Add") as XmlElement;
                if (add == null) return null;
                add.SetAttribute("SourcePath", TargetFolder);

                XmlElement display = doc.SelectSingleNode("/Configuration/Display") as XmlElement;
                if (display == null)
                {
                    display = doc.CreateElement("Display");
                    doc.DocumentElement.AppendChild(display);
                }
                display.SetAttribute("Level", "None");
                display.SetAttribute("AcceptEula", "TRUE");

                StringBuilder sb = new StringBuilder();
                XmlWriterSettings settings = new XmlWriterSettings();
                settings.Indent = true;
                using (XmlWriter w = XmlWriter.Create(sb, settings))
                    doc.Save(w);

                // XmlWriter emits encoding="utf-16" for StringBuilder output,
                // but the file is saved as UTF-8 - a mismatched declaration can
                // trip strict XML parsers, so make it match.
                return sb.ToString().Replace("encoding=\"utf-16\"", "encoding=\"utf-8\"");
            }
            catch { return null; }
        }

        static string X(string s)
        {
            if (s == null) return "";
            return s.Replace("&", "&amp;").Replace("\"", "&quot;").Replace("<", "&lt;").Replace(">", "&gt;");
        }
    }
}
