using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
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
    // the Office Deployment Tool.
    //
    // The product ID is deliberately NOT part of this model: ODT requires one
    // in configuration.xml, but the user should never have to know theirs.
    // WinUSB writes one configuration per known Office edition and the install
    // script tries them in order until the one matching the ISO's contents
    // succeeds - wrong guesses fail fast against the local source and install
    // nothing.
    public class OfficeSetup
    {
        public string IsoPath = "";
        public string Language = "en-us";
        public string Edition = "64";    // "64" or "32"
        public bool UseIsoConfig = true; // try the ISO's own configuration.xml first
    }

    public static class OfficeSupport
    {
        public const string PayloadFolderName = "Office";

        // Where the Office payload ends up on the TARGET machine: $OEM$\$$ maps
        // to %WINDIR% during setup, so the files land here. This is also the
        // ODT SourcePath written into every configuration.
        public const string TargetFolder = @"C:\Windows\Setup\Scripts\Software\Office";

        // Folder on the target machine where the ODT writes its own logs.
        public const string TargetLogFolder = @"C:\Windows\Setup\Scripts";

        // The install script iterates configuration_*.xml in name order, so the
        // numeric prefix defines the try order (00 is the ISO's own config).
        public const string IsoConfigFileName = "configuration_00_iso.xml";

        public static List<OfficeProduct> Products
        {
            get
            {
                List<OfficeProduct> list = new List<OfficeProduct>();
                // Most common first: volume editions from VLSC media.
                list.Add(new OfficeProduct("ProPlus2021Volume", "Office 2021 Pro Plus (volume)"));
                list.Add(new OfficeProduct("Standard2021Volume", "Office 2021 Standard (volume)"));
                list.Add(new OfficeProduct("ProPlus2024Volume", "Office LTSC 2024 Pro Plus (volume)"));
                list.Add(new OfficeProduct("Standard2024Volume", "Office LTSC 2024 Standard (volume)"));
                list.Add(new OfficeProduct("ProPlus2019Volume", "Office 2019 Pro Plus (volume)"));
                list.Add(new OfficeProduct("Standard2019Volume", "Office 2019 Standard (volume)"));
                // Retail media.
                list.Add(new OfficeProduct("HomeBusiness2021Retail", "Office 2021 Home & Business (retail)"));
                list.Add(new OfficeProduct("HomeStudent2021Retail", "Office 2021 Home & Student (retail)"));
                list.Add(new OfficeProduct("Professional2021Retail", "Office 2021 Professional (retail)"));
                list.Add(new OfficeProduct("HomeBusiness2024Retail", "Office 2024 Home & Business (retail)"));
                list.Add(new OfficeProduct("Home2024Retail", "Office 2024 Home (retail)"));
                // Subscriptions.
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
                if (id.Contains("2024")) return "PerpetualVL2024";
                if (id.Contains("2021")) return "PerpetualVL2021";
                if (id.Contains("2019")) return "PerpetualVL2019";
                if (id.Contains("2016")) return "PerpetualVL2016";
            }
            return "Current";
        }

        // Orders the candidates by hints in the ISO's volume label (VLSC media
        // labels look like "O21_PROPLUS_VOLUME_EN-US"). The label is only a
        // hint - a wrong guess costs one quick failed attempt, and the cascade
        // still finds the right product.
        public static List<OfficeProduct> OrderedCandidates(string volumeLabel)
        {
            List<OfficeProduct> list = Products;
            if (string.IsNullOrEmpty(volumeLabel)) return list;

            string label = volumeLabel.ToUpperInvariant();
            // OrderByDescending is stable, so equal scores keep the default order.
            return list.OrderByDescending(p => ScoreProduct(p.Id, label)).ToList();
        }

        static int ScoreProduct(string productId, string label)
        {
            string id = productId.ToUpperInvariant();
            int score = 0;

            if (label.Contains("PROPLUS") && id.StartsWith("PROPLUS")) score += 3;
            if (label.Contains("STANDARD") && id.StartsWith("STANDARD")) score += 3;
            if ((label.Contains("HOMEBUSINESS") || label.Contains("H&B")) && id.StartsWith("HOMEBUSINESS")) score += 3;
            if ((label.Contains("HOMESTUDENT") || label.Contains("H&S")) && id.StartsWith("HOMESTUDENT")) score += 3;
            if (label.Contains("PROFESSIONAL") && id.StartsWith("PROFESSIONAL")) score += 3;
            if ((label.Contains("O365") || label.Contains("365")) && id.StartsWith("O365")) score += 3;

            if (label.Contains("2024") && id.Contains("2024")) score += 2;
            if (label.Contains("2021") && id.Contains("2021")) score += 2;
            if (label.Contains("2019") && id.Contains("2019")) score += 2;

            if (label.Contains("VOLUME") && id.EndsWith("VOLUME")) score += 1;
            if (label.Contains("RETAIL") && id.EndsWith("RETAIL")) score += 1;

            return score;
        }

        public static string CandidateConfigName(int index, string productId)
        {
            return "configuration_" + index.ToString("00") + "_" + productId + ".xml";
        }

        public static string GenerateConfigurationXml(string productId, string language, string edition)
        {
            string product = (productId ?? "").Trim();
            string lang = (language ?? "").Trim();
            if (lang.Length == 0) lang = "en-us";
            string ed = edition == "32" ? "32" : "64";

            StringBuilder sb = new StringBuilder();
            sb.AppendLine("<Configuration>");
            sb.AppendLine("  <Add SourcePath=\"" + X(TargetFolder) + "\" OfficeClientEdition=\"" + ed +
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

        // Best-effort read of the <Product ID="..."> inside a config, for logs.
        public static string FindProductId(string xml)
        {
            try
            {
                XmlDocument doc = new XmlDocument();
                doc.LoadXml(xml);
                XmlElement product = doc.SelectSingleNode("/Configuration/Add/Product") as XmlElement;
                return product == null ? null : product.GetAttribute("ID");
            }
            catch { return null; }
        }

        // Takes the configuration.xml found inside an Office ISO and makes it
        // work from the payload folder: SourcePath is repointed and the display
        // is forced fully silent. Returns null when the file has no usable
        // <Add> block (caller then relies on the generated candidates alone).
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
