; NSIS installer hooks (tauri.conf.json bundle.windows.nsis.installerHooks).
; Puts the install folder on the user's PATH, so agents can be set up with just
; `zynlex-mcp` (e.g. `claude mcp add zynlex zynlex-mcp`), and takes it off on
; uninstall.
;
; PowerShell edits HKCU\Environment directly: the other entries keep their
; %VARIABLES% unexpanded and the value stays REG_EXPAND_SZ (Environment.
; SetEnvironmentVariable would expand them). The folder reaches PowerShell
; through an environment variable, so a path with quotes can't break the script.
; ponytail: MSI installs don't touch PATH; the Settings snippet's full path works there.

!macro ZYNLEX_PATH KEEP_SELF
  System::Call 'Kernel32::SetEnvironmentVariable(t "ZYNLEX_DIR", t "$INSTDIR")'
  nsExec::Exec `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$k = 'HKCU:\Environment'; $$d = $$env:ZYNLEX_DIR; $$p = (Get-Item $$k).GetValue('Path', '', 'DoNotExpandEnvironmentNames'); $$keep = @($$p -split ';' | Where-Object { $$_ -and $$_.TrimEnd('\') -ne $$d.TrimEnd('\') }); if (${KEEP_SELF}) { $$keep += $$d }; Set-ItemProperty -Path $$k -Name Path -Value ($$keep -join ';') -Type ExpandString"`
  Pop $0
  ; Tell open programs (Explorer, new terminals) that the environment changed.
  SendMessage 0xFFFF 0x1A 0 "STR:Environment" /TIMEOUT=5000
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro ZYNLEX_PATH "$$true"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro ZYNLEX_PATH "$$false"
!macroend
