; Custom NSIS installer hooks for Halo
; This ensures that \Halo is appended to any selected installation directory

; Define a custom function to handle directory page leave event
Function HaloDirectoryLeave
  ; Append \Halo to the selected directory
  StrLen $0 $INSTDIR
  ${If} $0 > 5
    IntOp $1 $0 - 5
    StrCpy $2 $INSTDIR 5 $1
    ${StrCase} $3 $2 "L"
    ${If} $3 != "\halo"
      ; Append \Halo if not already present
      StrCpy $INSTDIR "$INSTDIR\Halo"
    ${EndIf}
  ${Else}
    ; Directory path is short, append \Halo
    StrCpy $INSTDIR "$INSTDIR\Halo"
  ${EndIf}
FunctionEnd

; Set this function to be called when leaving the directory page
; This must be defined BEFORE MUI_PAGE_DIRECTORY is called
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE HaloDirectoryLeave

!macro NSIS_HOOK_PREINSTALL
  ; Double-check that \Halo is appended before installation
  StrLen $0 $INSTDIR
  ${If} $0 > 5
    IntOp $1 $0 - 5
    StrCpy $2 $INSTDIR 5 $1
    ${StrCase} $3 $2 "L"
    ${If} $3 != "\halo"
      StrCpy $INSTDIR "$INSTDIR\Halo"
    ${EndIf}
  ${Else}
    StrCpy $INSTDIR "$INSTDIR\Halo"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
!macroend









