---
name: Human verifications
about: Marks to write onto notes and sources in data/data.json
title: Human verifications
labels: verification
---

Apply each object in the JSON block to `data/data.json`, then close this issue.

Set `humanVerified` to `{"by","date","comment?"}` on the matching note (`noteId`) or source (`sourceId`). A value in data.json overrides a browser-only mark.

```json
{
  "verifications": []
}
```
