; Inno Setup script for OESF LPR Site Agent
; Built against files staged in dist/installer-win/ (see npm run build).
; Version is substituted by scripts/build.mjs ({{VERSION}}).

#define MyAppName "OESF LPR Site Agent"
#define MyAppVersion "{{VERSION}}"
#define MyAppPublisher "Old East Safety Forum"
#define MyAppExeName "oesf-lpr-agent.exe"
#define MyAppURL "https://oldeastsafetyforum.co.za"

[Setup]
AppId={{A8E3C1F2-9B4D-4E7A-8C2F-1D5E6A9B0C3D}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
DefaultDirName={localappdata}\OESF\LPR Agent
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=..
OutputBaseFilename=oesf-lpr-agent-{#MyAppVersion}-setup-win-x64
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\{#MyAppExeName}
SetupIconFile=
InfoBeforeFile=
LicenseFile=

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "autostart"; Description: "Start the agent in the background when I log on"; GroupDescription: "Startup:"; Flags: checkedonce

[Files]
Source: "oesf-lpr-agent.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "config.example.yaml"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Open local UI"; Filename: "http://127.0.0.1:8787/"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon
Name: "{userstartup}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: autostart

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch {#MyAppName}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Leave %LOCALAPPDATA%\OESF\LPR Agent (config + state) so reinstall keeps pairing
Type: files; Name: "{app}\*.log"
