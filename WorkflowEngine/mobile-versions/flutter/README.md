# Workflow ERP - Flutter

Run: `flutter create . --platforms=android,ios` (once, to generate the android/ and ios/ folders), then `flutter pub get` and `flutter run`.
On an Android emulator the server is `http://10.0.2.2:5000`; on a real device use your computer's LAN address.
Android over plain http: add `android:usesCleartextTraffic="true"` to the `<application>` tag in `android/app/src/main/AndroidManifest.xml`.
