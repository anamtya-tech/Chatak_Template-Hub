# Fieldnotes wildlife dictionary builder

This subproject helps browse wildlife species around a selected place and build or review a sound dictionary.

## Run locally

From this directory, start the local server:

```powershell
python server.py
```

Then open <http://127.0.0.1:8765/index.html>. Set `FIELDNOTES_PORT` to use another port.

The browser app uses external GBIF, Xeno-canto, place-search, and map services. A Xeno-canto API key is needed for recording availability and dictionary downloads.

## Dictionary recovery

When a downloaded dictionary ZIP is opened, Fieldnotes stores it in IndexedDB for this browser and origin. Use **Resume saved dictionary** after reloading the app; the viewer also remembers the last species and recording. **Forget saved ZIP** removes the local copy. Generated ZIP archives are excluded from Git.

The `test-raven/` files provide the standalone reference viewer's sample deck. `species.csv` and `annotations.csv` are included as project data.
