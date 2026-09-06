# Field companion

Open **Field updates** in the NWIS sidebar to receive notes. Open `/companion.html` on the phone to record them.

## Setup and offline use

Build with `npm run build`. Serve `dist` through an HTTPS server trusted by the phone (or use localhost on the laptop). A plain LAN HTTP address cannot provide camera access or service-worker installation. No external services are needed by the companion after setup. Install the companion on the phone's home screen and wait for **Ready offline** before disconnecting. The preview server on localhost is useful for laptop testing, not phone deployment.

Notes and photos are stored in IndexedDB on each device. Saving reports success only after the storage transaction completes. Browser data clearing or device loss removes local copies: export update files as backups. The app requests persistent storage, but the browser decides whether to grant it. Unsaved form input is not a saved note.

## Transfer

1. Save notes with the well name, engineer, observation time, optional MD and optional formation. Short well identifiers such as A-12 resolve to A-12 / Barail South when the match is unique.
2. Choose **Show transfer QR** on the phone and **Scan phone QR** on the laptop. Frames repeat, can arrive out of order, and are checked with SHA-256 before review. Keep both screens open until all frames are received.
3. Review the matching well and formation. Ambiguous or missing wells require a selection before acceptance. Formation is inferred only from a single known depth interval, or can be specified in review. Accepted notes appear in that well's event log, Well Dive, formation-filtered search, and Ask NWIS. Select **Update current measured depth** only when the note reports the current drilling depth; the newest accepted reading is applied and the original source depth remains available.
4. Choose **Scan confirmation** on the phone and scan the laptop's receipt QR. Phone copies remain stored. Only the last transfer's receipt is accepted.
5. Photos use **Export with photos** and **Import update file**. Export includes all saved notes so photos can still be transferred after text has been confirmed. Duplicate note IDs do not create new history entries; a subsequent file import can supply previously omitted photos. Conflicting content under the same ID is rejected atomically.

Accepted notes survive a laptop browser restart and are reapplied when the well's documents load, including previously imported notes that now resolve uniquely. The dashboard derives its events and reviewed depth readings from source reports plus the local field history. Ask NWIS and what-if requests include those observations with author, timestamp, and formation. Source documents remain unchanged. Field history is local to the laptop browser; it is not automatically replicated to Supabase or other laptops. Exported update packages can be imported on additional machines.

QR payloads are not encrypted or signed: transfer in person, review the author/content, and control who can see the screens. Checksums detect damaged transmission, not who authored an update.

## Validation

`npm run test:ocr` includes frame reconstruction with Unicode, duplicate frames, mixed transfers, corruption and invalid-package tests. Physical phone/webcam scanning and home-screen installation require verification on the intended devices.
