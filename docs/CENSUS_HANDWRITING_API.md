# City Vet handwriting server — API for Salin

Salin reads census sheets on the phone. Tick boxes and bubbles need no server. Handwriting in the letter boxes is read on the device first. When the paravet is online, **Read on City Vet server** sends only the written letter-box rows to a stronger reader on the city's own server. Salin never sends the whole photo, the owner's tick-box answers, or anything from other documents.

The server isn't built yet. Salin shows the button disabled ("Not connected yet") until `VITE_CITY_VET_READER_URL` is set at build time.

## Endpoint

`POST {VITE_CITY_VET_READER_URL}/census/handwriting`, with `Content-Type: application/json`.

### Request

```json
{
  "form": "CVO-CENSUS",
  "rows": [
    { "id": "form:0:owner_name#0", "image": "data:image/png;base64,…", "boxes": 0, "allowed": "ABCDEFGHIJKLMNOPQRSTUVWXYZ.-' " },
    { "id": "form:0:contact#0", "image": "data:image/png;base64,…", "boxes": 11, "allowed": "0123456789" }
  ]
}
```

- `image` is one written row with the printed lines already removed: handwriting on white, at about 8 px/mm. That's an open writing line (names, address, pet name, remarks on v2 sheets), or a row of letter boxes from the first to the last written box (the contact number; every field on v1 sheets).
- `boxes` is how many letter boxes in the row hold writing. Each holds exactly one character, so the reading must have exactly this many characters, not counting spaces. It is **0 for an open line**: any length.
- `allowed` lists the characters those boxes may hold.

### Response (200)

```json
{ "rows": [{ "id": "form:0:owner_name#0", "text": "IAN CABALQUINTO", "confidence": 0.93 }] }
```

- Return one entry per row you could read, and leave out rows you couldn't.
- `confidence` is a number from 0 to 1. Below 0.75, Salin flags the value for typing instead of suggesting it.
- Salin uppercases `text` and drops any reading that uses a character outside `allowed`, or (for letter boxes) whose character count doesn't equal `boxes`. In letter boxes, spaces are re-placed from the sheet's empty boxes. On open lines they're kept as read.

## Suggested server setup

- **Reader:** PaddleOCR-VL 1.6 (Apache-2.0), or the PaddleOCR PP-OCRv5 *server* recognizer, run with the official PaddleOCR or vLLM tooling on a GPU. Constrain or validate each reading to `allowed` and `boxes`.
- **Privacy (RA 10173):** keep images only as long as it takes to read them, and log no names or numbers. Use HTTPS, and authenticate the device: the admin system issues the account keys. Record the processing in the City Vet's privacy notice.
- **Errors:** any non-200 status shows the paravet "The City Vet server couldn't read these boxes (status)". Nothing is changed in the review.

## What happens in Salin

Readings arrive as suggestions, the same as the on-device reader's. The reviewer uses, edits or dismisses each one. A pet counts as **Validated** only after every value has been checked.
