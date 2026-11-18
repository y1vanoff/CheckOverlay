!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "CheckOverlay"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "checkoverlay"
!macroend
