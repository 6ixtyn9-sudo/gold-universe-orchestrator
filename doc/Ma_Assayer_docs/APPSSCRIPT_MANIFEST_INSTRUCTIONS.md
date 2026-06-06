# Apps Script Manifest — Manual Update Required

## Why this file exists

No `appsscript.json` file was found in this repository.

The Ma_Assayer project is an **Apps Script project** whose canonical manifest
lives inside the Google Apps Script IDE, not in this repo.  
This means the `drive.readonly` OAuth scope **must be added manually** inside
the live project.

---

## What needs to be added

Open the live Apps Script project (Ma_Assayer) and go to:

**Project Settings → Show "appsscript.json" manifest file in editor**

Then add `https://www.googleapis.com/auth/drive.readonly` to the `oauthScopes`
array **without removing any existing scope**.

Example manifest after the change:

```json
{
  "timeZone": "America/New_York",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "oauthScopes": [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/script.container.ui",
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/script.scriptapp",
    "https://www.googleapis.com/auth/script.external_request"
  ]
}
```

> **Do not replace your existing scopes** — only add the `drive.readonly` entry
> if it is not already present.

---

## Why `drive.readonly` is needed

`FleetImport_.discoverSatellites_()` now always attempts Drive folder discovery
(in addition to the GitHub registry fetch) to pick up any satellites not yet
committed to `registry.json`.

The relevant call is:

```javascript
DriveApp.getFolderById(this.FOLDER_ID)          // requires drive.readonly
  .getFilesByType(MimeType.GOOGLE_SHEETS);
```

Without the `drive.readonly` scope in the manifest the Apps Script runtime will
throw:

> `Drive folder discovery failed: Permission denied while enabling APIs: drive for project …`

---

## After editing the manifest

1. Save the manifest (`Ctrl+S`).
2. Click **Run → runFleetImportTest** (or any function) to trigger the
   **re-authorization dialog**.
3. Accept all requested permissions.
4. Then run the full fleet import again.

---

## Reference

- Apps Script OAuth scopes: <https://developers.google.com/apps-script/concepts/scopes>
- Drive readonly scope: `https://www.googleapis.com/auth/drive.readonly`
