# 🛠 WinUSB — Windows Setup USB + Auto-Install Software

Build a bootable Windows 10/11 installation USB stick that **automatically
installs the software you choose** right after Windows finishes installing —
fully offline, no internet needed on the target PC.

The trick: Windows setup automatically executes
`sources\$OEM$\$$\Setup\Scripts\SetupComplete.cmd` (as SYSTEM/admin) at the
very end of installation. WinUSB generates that script for you, drops your
selected installers alongside it, and burns the whole thing to the stick.

## Features

- **Bootable USB** from any Windows 10/11 ISO (UEFI + legacy BIOS)
- **Auto WIM splitting** — Windows 11's >4 GB `install.wim` is split into
  `install.swm` chunks (setup reads them natively) so everything fits FAT32
- **EXE and MSI installers** — `.exe` files are sniffed from their binary
  signatures (NSIS, Inno Setup, InstallShield, Advanced Installer, WiX,
  Squirrel) with the right silent flags filled in; also `.msi`, `.bat`,
  `.cmd` and `.ps1`
- **Microsoft Office from an Office ISO** — the ISO's offline payload is copied
  into the `$OEM$` folder and installed silently with the Office Deployment
  Tool (`setup.exe /configure configuration.xml`), generated for your chosen
  product ID / language / bitness
- **Editable install order and arguments** — full control per installer
- **Logged** — after install, check `C:\Windows\Setup\Scripts\winusb_install.log`
  to see exactly what ran and each exit code
- **Zero dependencies** — compiles with the C# compiler built into Windows

## Build

Double-click `build.bat` (or run it in a terminal). It produces `bin\WinUSB.exe`
using `%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe` — no SDK, no
Visual Studio, nothing to install.

## Usage

1. **Run `bin\WinUSB.exe` as Administrator** (right-click → Run as administrator).
2. Pick your Windows ISO (it is mounted read-only and copied directly to the
   stick — no intermediate extraction).
3. Plug in the USB stick (8 GB+), click **Refresh**, select it.
4. Keep **FAT32** selected (boots on both UEFI and BIOS; WIM auto-splits).
   NTFS is available but legacy-BIOS only.
5. **Add installers** — pick any `.exe/.msi/.bat/.cmd/.ps1` files on your PC.
   EXEs are fine: the type is sniffed from the binary itself (NSIS, Inno
   Setup, InstallShield, Advanced Installer, WiX, Squirrel...) and silent
   args are filled in automatically. Check/adjust per installer if needed.
6. *(Optional)* **Add Office ISO...** — pick your Microsoft Office 2019/2021/
   Microsoft 365 offline ISO, choose the product ID that matches the ISO you
   own (e.g. `ProPlus2021Volume`), language and bitness. WinUSB copies the
   ISO's payload to the stick and generates the silent `configuration.xml`
   (or reuses the one inside the ISO, repointing its SourcePath).
7. Click **BUILD USB**, confirm the wipe, wait for "Done!".

Then boot the target machine from the stick, install Windows normally, and
your apps install themselves at the end. Login and check the log — anything
that failed will show a non-zero exit code there.

## How it works (internals)

```
ISO ──Mount-DiskImage──▶ mounted drive (validated: setup.exe present,
                          before ANY change to the USB disk)
       │
       ├─ diskpart:  clean → MBR → primary partition → FAT32/NTFS → active
       ├─ bootsect:  boot\bootsect.exe /nt60 <vol>: /force /mbr
       ├─ robocopy:  ISO ──▶ USB   (oversized install.wim excluded on FAT32,
       │                            split via DISM into install.swm chunks)
       ├─ Office:    Office ISO ──▶ sources\$OEM$\$$\Setup\Software\Office\
       │                            + configuration.xml (ODT silent install)
       └─ $OEM$:     sources\$OEM$\$$\Setup\Scripts\SetupComplete.cmd
                     sources\$OEM$\$$\Setup\Software\sw01_app.exe ...
```

Both ISOs (Windows + Office) are mounted and validated, and the disk space is
checked, **before the USB stick is touched at all** — a bad ISO or a stick
that is too small fails safely with the disk intact.

Windows setup copies `$OEM$\$$` into `%WINDIR%` during install, then runs
`SetupComplete.cmd` after the final reboot, before first login.
$OEM$ must sit inside `sources\` or setup ignores it.

## Troubleshooting

- **"No USB disks found"** — some sticks enumerate as fixed disks; try the
  `--list-disks` CLI (`bin\WinUSB.exe --list-disks` in a terminal) to see how
  yours appears.
- **Nothing auto-installed after setup** — diagnose on the new PC:
  1. `C:\Windows\Setup\Scripts\SetupComplete.cmd` missing? Windows never
     processed the $OEM$ folder (some Windows 11 builds/regressions skip it).
  2. Script present but no `winusb_install.log`? Setup skipped executing it.
  3. Log present with a failing exit code? The installer itself failed -
     MSIs also write a verbose log next to winusb_install.log
     (`<name>.msilog`) showing the exact error.
  Tweak that installer's args in the GUI and rebuild.
- **"Could not mount the ISO as a drive"** — check the file is a real ISO
  (not a renamed archive). If you run WinUSB through a portable-app sandbox
  or wrapper (Cameyo, Sandboxie, PortableApps, etc.), path redirection and
  service restrictions break ISO mounting — copy the plain `WinUSB.exe` out
  and run it directly as administrator instead.
- **Robocopy ERROR 123 / mangled paths** — same cause: a sandbox or wrapper
  redirecting `AppData` paths. Run the EXE directly, not through a wrapper.
- **Office didn't install** — on the new PC check the Office Deployment
  Tool's own logs (`C:\Windows\Setup\Scripts\OfficeSetup*.log`). The most
  common cause is a product ID that does not match the ISO's contents (e.g.
  `ProPlus2021Volume` for a retail ISO) — ODT reports the product was not
  found in the source. Rebuild with the matching ID. Office installs last, so
  a failing Office install never blocks the other apps.
- **"The Office ISO contains a file larger than 4 GB"** — FAT32 cannot store
  such files and the Office payload cannot be split like install.wim. Use an
  Office ISO whose largest file is under 4 GB, or choose NTFS (legacy BIOS
  boot only).
- **UEFI machine won't boot NTFS stick** — rebuild with FAT32.

## Files

```
winusb/
├── build.bat            # one-click compile with built-in csc.exe
├── app.manifest         # requires admin elevation
├── Program.cs           # entry point, admin check, --list-disks CLI
├── MainForm.cs          # GUI
├── UsbBuilder.cs        # diskpart/robocopy/DISM/bootsect engine + $OEM$ writer
├── InstallerDetector.cs # installer type sniffing + silent-arg presets
├── OfficeSupport.cs     # Office product list, ODT configuration.xml, ISO config rewrite
├── OfficeDialog.cs      # Office ISO picker dialog
├── test_gen.cs          # non-elevated harness that prints sample scripts + configs
└── bin/WinUSB.exe       # output
```

## ⚠ Safety notes

- The selected disk is **completely erased** — double-check the disk number
  and model in the confirm dialog.
- Only use installers from trusted sources; they run with SYSTEM privileges
  during setup.
- Some installers (e.g. those needing reboots mid-install, or drivers) may
  not like running in SetupComplete — test your list once on a VM first.
- Volume Office editions need volume licensing (KMS/MAK) and activate after
  installation; retail/Microsoft 365 editions prompt for sign-in at first use.
