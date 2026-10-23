# Legal Jarvis — a private chamber assistant for Android

A 24/7, on-device legal assistant for the chamber: it files your PDF and Word papers by court, case and type; keeps the case register; watches your diary, procedural steps and limitation dates; and speaks to you in a calm British voice, in English with Hindi where the papers call for it.

**No account. No cloud. No subscription. Nothing leaves the tablet.**

## Install the APK

1. On the Lenovo Yoga tablet, open **[the latest release](https://github.com/yashasvamoond-commits/jarvis-/releases/latest)**.
2. Download **`Legal-Jarvis.apk`**.
3. Open the downloaded file. Android will ask permission to install from this source — allow it, then tap **Install**.
4. On first launch, grant **microphone** and **notification** permission when asked. Both are used only by Jarvis itself.

> The APK is rebuilt automatically by GitHub Actions on every push. The download link never changes, and each build is signed with the same chamber key and a higher version code, so a new download installs straight over the previous one without touching your records.

## The chamber at a glance

- **Command** — speak or type. Jarvis answers aloud and on screen.
- **Overview** — the next two days' cause list, chamber agenda, deadlines and drafts.
- **Matters** — the master register. Add or edit any matter; e-Courts imports merge into the same register.
- **Diary** — cause list, calendar and reminders, with manual dates for revenue, SDM, police and pre-litigation work.
- **Documents** — reads PDF/DOCX/TXT, classifies by court, case and document type, and files copies in a private archive.
- **Setup** — voice, briefing times, linked folders, e-Courts/Drive import, backup and restore.

## Language rule

The working language is English. Hindi is used to describe a document whose name or contents are in Hindi, and Jarvis replies in Hindi when you speak to it in Hindi. The **EN / AUTO / हिं** control is in the header; use **हिं** to keep the whole conversation in Hindi.

## Voice

Jarvis uses the Android Text-to-Speech engine. For the most convincing British timbre, install the **Google Text-to-Speech** engine and add the **English (United Kingdom)** voice pack in Android settings, then choose the voice in Setup. Pitch and pace are calibrated for a composed, formal aide.

## Privacy and storage

- All records live in the app's local database (IndexedDB).
- Imported papers are copied into `Android/data/com.legaljarvis.chamber/files/LegalJarvis/Archive/<court>/<case>/<type>/`.
- Backups are written only where you choose.
- Speech recognition is provided by the Android service on the tablet; the archive itself is never transmitted.

## Signing

The build uses the chamber's own signing key (`android/keystore/legaljarvis.p12`, password `legaljarvis`). The key is committed deliberately so that successive sideloaded builds remain installable as updates. It is not a Play Store key; treat it as a local convenience key rather than a secret.

## Build locally

```bash
cd android
gradle assembleDebug
# APK: app/build/outputs/apk/debug/app-debug.apk
```

Requirements: JDK 17, Android SDK 35, Gradle 8.9+.

## Notes

- The sample chamber included on first launch is demonstration data. Say “clear sample data”, or use Setup → Backup & data → Clear samples, to remove it.
- e-Courts does not offer a public API; Jarvis imports the CSV/JSON export from your e-Courts app (through Google Drive if you wish) and merges it into the register by CNR and case number.
- Android's scoped storage means an app cannot silently read every folder on the tablet. Two routes are provided: **link a chamber folder** once in Setup (it is rescanned each time the app opens), or tap **Scan tablet** in Documents and grant Android's one-time *All files access*. The second route sweeps Downloads, Documents and every visible folder for PDF and Word papers, ignores the app's own archive, and files what it finds. Nothing is uploaded.
- The archive lives in the app's private external files directory. **Setup → Documents & folders → Open archive folder** copies that exact path to the clipboard so you can reach it with a file manager.
