; Inno Setup 6 script shared by the four desktop versions. Called by tools\make-installer.bat with:
;   /DVariant=WPF /DSrcDir=C:\...\dist /DExeName=WorkflowErp.exe /DAppGuid=GUID /DOutDir=C:\...\installers
#ifndef Variant
  #error Run tools\make-installer.bat instead of compiling this file by hand.
#endif
#define RegKey "Software\Microsoft\Windows\CurrentVersion\Uninstall\{" + AppGuid + "}_is1"
#define AppIdStr "{{" + AppGuid + "}"
[Setup]
AppId={#AppIdStr}
AppName=Workflow ERP ({#Variant})
AppVersion=1.0
AppPublisher=Workflow Engine
DefaultDirName={autopf}\WorkflowERP-{#Variant}
DefaultGroupName=Workflow ERP ({#Variant})
OutputDir={#OutDir}
OutputBaseFilename=WorkflowERP-{#Variant}-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\{#ExeName}
DisableProgramGroupPage=yes
CloseApplications=force
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Shortcuts:"

[InstallDelete]
Type: filesandordirs; Name: "{app}\*"

[Files]
Source: "{#SrcDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\Workflow ERP"; Filename: "{app}\{#ExeName}"
Name: "{group}\Uninstall Workflow ERP"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Workflow ERP ({#Variant})"; Filename: "{app}\{#ExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#ExeName}"; Description: "Start Workflow ERP now"; Flags: nowait postinstall skipifsilent

[Code]
// An older copy of this same version is closed and uninstalled silently before the new files are copied,
// so installing again always gives a clean, current install.
procedure CurStepChanged(CurStep: TSetupStep);
var
  U: String;
  RC: Integer;
begin
  if CurStep = ssInstall then
  begin
    Exec('taskkill.exe', '/f /im {#ExeName}', '', SW_HIDE, ewWaitUntilTerminated, RC);
    U := '';
    if not RegQueryStringValue(HKCU, '{#RegKey}', 'QuietUninstallString', U) then
      RegQueryStringValue(HKLM, '{#RegKey}', 'QuietUninstallString', U);
    if U <> '' then
      Exec('cmd.exe', '/c "' + U + '"', '', SW_HIDE, ewWaitUntilTerminated, RC);
  end;
end;
