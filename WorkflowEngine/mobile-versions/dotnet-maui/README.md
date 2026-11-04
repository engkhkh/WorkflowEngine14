# Workflow ERP - .NET MAUI

Needs the .NET 8 SDK with the `maui` workload (`dotnet workload install maui`).
Run on Android: `dotnet build -t:Run -f net8.0-android`. iOS needs a Mac with Xcode.
Android emulator reaches your computer's backend at `http://10.0.2.2:5000` (default); a real device needs your computer's LAN address.
The UI is built in C# code (no XAML), so there are no binding strings to get wrong. Texts and the module list come from `Resources/Raw/*.json`.
