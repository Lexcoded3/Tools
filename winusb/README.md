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
- **Installer detection** — sniffs MSI / NSIS / Inno Setup / WiX bundle /
  Squirrel / InstallShield / .bat / .ps1 and fills in the right silent flags
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
2. Pick your Windows ISO (files are extracted once to
   `%LOCALAPPDATA%\WinUSB\iso\...` and cached for rebuilds).
3. Plug in the USB stick (8 GB+), click **Refresh**, select it.
4. Keep **FAT32** selected (boots on both UEFI and BIOS; WIM auto-splits).
   NTFS is available but legacy-BIOS only.
5. **Add installers** — pick any `.exe/.msi/.bat/.cmd/.ps1` files on your PC.
   Check the detected type and tweak silent args if needed (defaults are
   filled in; e.g. NSIS `/S`, Inno `/VERYSILENT /NORESTART`, MSI `/qn /norestart`).
6. Click **BUILD USB**, confirm the wipe, wait for "Done!".

Then boot the target machine from the stick, install Windows normally, and
your apps install themselves at the end. Login and check the log — anything
that failed will show a non-zero exit code there.

## How it works (internals)

```
ISO ──mount──▶ stage (%LOCALAPPDATA%\WinUSB\iso\<name>_<len>)
                ├─ all ISO files
                ├─ sources\install.swm   (split via DISM, if needed)
                └─ $OEM$\$$\Setup\
                     ├─ Scripts\SetupComplete.cmd   ← generated
                     └─ Software\sw01_app.exe ...   ← your installers

diskpart:  clean → MBR → primary partition → FAT32/NTFS → active
bootsect:  /nt60 <vol>: /force /mbr
robocopy:  stage ──▶ USB
```

Windows setup copies `$OEM$\$$` into `%WINDIR%` during install, then runs
`SetupComplete.cmd` after the final reboot, before first login.

## Troubleshooting

- **"No USB disks found"** — some sticks enumerate as fixed disks; try the
  `--list-disks` CLI (`bin\WinUSB.exe --list-disks` in a terminal) to see how
  yours appears.
- **Installer skipped/failed after setup** — read
  `C:\Windows\Setup\Scripts\winusb_install.log` on the new install; adjust
  that installer's args in the GUI (e.g. some apps need `/S` capitalized,
  or a custom `-silent` flag) and rebuild.
- **ISO won't mount** — make sure the file is a real ISO (not a renamed
  archive) and no antivirus is blocking PowerShell disk image mounting.
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
├── test_gen.cs          # non-elevated harness that prints a sample SetupComplete.cmd
└── bin/WinUSB.exe       # output
```

## ⚠ Safety notes

- The selected disk is **completely erased** — double-check the disk number
  and model in the confirm dialog.
- Only use installers from trusted sources; they run with SYSTEM privileges
  during setup.
- Some installers (e.g. those needing reboots mid-install, or drivers) may
  not like running in SetupComplete — test your list once on a VM first.
