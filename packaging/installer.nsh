; Installer pages and application-specific hooks for electron-builder.
!include "getProcessInfo.nsh"
Var pid

!macro customHeader
  ShowInstDetails show
  ShowUninstDetails show
!macroend

!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customInstallMode
  !ifndef BUILD_UNINSTALLER
    ; Install for the current user.
    !insertmacro setInstallModePerUser
    Abort
  !endif
!macroend

!macro customCheckAppRunning
  SetDetailsPrint both
  DetailPrint "Checking running applications..."
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro _CHECK_APP_RUNNING
  !ifndef BUILD_UNINSTALLER
    DetailPrint "Installing Wordkeep, Python runtime and HanLP models into $INSTDIR"
    DetailPrint "Extracting application files into the installation directory..."
  !endif
!macroend

!macro customFiles_x64
  DetailPrint "Application files written. Creating shortcuts and installation records..."
!macroend

!macro customInstall
  DetailPrint "Installation completed: $INSTDIR"
!macroend

; Remove the application user profile on uninstall.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    SetDetailsPrint both
    DetailPrint "Removing user settings, wordlists and caches..."
    RMDir /r "$APPDATA\Wordkeep"
  ${endif}
!macroend
