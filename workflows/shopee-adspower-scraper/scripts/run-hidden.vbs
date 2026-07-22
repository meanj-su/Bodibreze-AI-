Option Explicit
Dim shell, fso, scriptDir, root, logs, stamp, logFile, cmd, i
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
root = fso.GetParentFolderName(scriptDir)
logs = root & "\exports\ads-autopilot\logs"
CreateFolderRecursive logs
stamp = Replace(Replace(Replace(CStr(Year(Now()) & Right("0" & Month(Now()),2) & Right("0" & Day(Now()),2) & "_" & Right("0" & Hour(Now()),2) & Right("0" & Minute(Now()),2) & Right("0" & Second(Now()),2)), ":", ""), "/", ""), " ", "_")
logFile = logs & "\hidden-runner_" & stamp & ".log"
If WScript.Arguments.Count = 0 Then WScript.Quit 2
cmd = "cmd.exe /d /s /c " & Chr(34) & "cd /d " & Q(root) & " && "
For i = 0 To WScript.Arguments.Count - 1
  If i > 0 Then cmd = cmd & " "
  cmd = cmd & Q(WScript.Arguments(i))
Next
cmd = cmd & " >> " & Q(logFile) & " 2>>&1" & Chr(34)
shell.CurrentDirectory = root
WScript.Quit shell.Run(cmd, 0, True)

Function Q(s)
  Q = Chr(34) & Replace(CStr(s), Chr(34), Chr(34) & Chr(34)) & Chr(34)
End Function

Sub CreateFolderRecursive(p)
  If fso.FolderExists(p) Then Exit Sub
  Dim parent
  parent = fso.GetParentFolderName(p)
  If Len(parent) > 0 And Not fso.FolderExists(parent) Then CreateFolderRecursive parent
  If Not fso.FolderExists(p) Then fso.CreateFolder p
End Sub