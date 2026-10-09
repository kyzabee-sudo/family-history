---
name: Corrections and notes
about: Suggestions to apply by hand in data/data.json
title: Corrections and notes
labels: correction
---

Apply each object in the JSON block to `data/data.json` by hand, then close this issue.

For a source or note, add an entry to `corrections`: `{"by","date","kind","comment","status":"applied"|"declined","resolution"}`. For a fact, event, or family, edit the record itself.

```json
{
  "corrections": []
}
```
