# Workflow ERP - C# desktop (WPF, .NET 8)

Windows only. Needs the .NET 8 SDK.

    dotnet run

or `dotnet publish -c Release -r win-x64 --self-contained` for a single folder you can copy to another PC.
Server address is asked on the login window (default `http://localhost:63353`); the session is remembered in `%APPDATA%\WorkflowErpWpf`.
The UI is built in C# code (no XAML). Texts and the module list are read from the `data` folder next to the program.
Try without the real backend: `python3 ../tools/mock_server.py 5055`, sign in as admin / admin on `http://localhost:5055`.
