---
name: Human verifications
about: Marks to write onto notes and sources in data/data.json
title: Human verifications
labels: verification
---

Apply each object in the JSON block to `data/data.json`, then close this issue.

Each item has an `action`. On the matching note (`noteId`) or source (`sourceId`), set that field to `{"by","date","comment?"}`:

- `humanVerified` when action is `humanVerified`
- `addedToFamilySearch` when action is `addedToFamilySearch`

A value in data.json overrides a browser-only mark.

```json
{
  "verifications": []
}
```
