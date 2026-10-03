# Family history

Static dashboard for the Valdés, Nieto, Uría, Sánchez, Menéndez and Rodríguez research (Cenero / Porceyo / Gijón) and the Havana Bermúdez line. The site reads [`data/data.json`](data/data.json) in the browser. There are no per-person pages to edit.

The site is published at <https://kyzabee-sudo.github.io/family-history/>. Pushes to `main` are deployed by [`.github/workflows/pages.yml`](.github/workflows/pages.yml) (Pages source: GitHub Actions).

The default tree is Juan Rafael Valdés Pedrayes (`juan-rafael-valdes-pedrayes`, FamilySearch GDML-8JK, 1924–2014), Kyler Rasmussen's maternal grandfather. He is a child in `fam-juan-antonio-valdes-nieto` (Juan Valdés Nieto × Elvira Rosa Pedrayes, married abt 1922 in Havana). The link comes from Kyler's FamilySearch tree. The old placeholder id `juan-valdes-grandfather` was merged into him on 1 Oct 2026. Family pages are `#/families` and `#/family/<id>`.

## Update the data

Edit `data/data.json` only. Schema: [`data/SCHEMA.md`](data/SCHEMA.md). Check with:

```bash
python3 data/validate.py
```

The command exits 0 when the structure is sound. Same-name pairs are warnings and do not fail the check. A failing check fails the Pages build.

### Add a person

1. Add an object to `people[]` with a unique `id` slug.
2. Add or extend a `families[]` entry so the person is a husband, wife, or child.
3. Point `parents`, `parentLinks`, `spouses`, and `familyIds` at ids that exist. Set each `parentLinks[].status` and `childLinks[].status` to `verified` (solid tree line), `probable` (dashed), or `proposed` (dotted).
4. Give every note an `id`. Run the validator.

### Add a note

Append to that person's `notes[]`. Do not renumber existing note ids.

```json
{
  "id": "juan-valdes-sanchez-abt1872-n3",
  "date": "2026-10-02",
  "status": "open",
  "text": "What was checked, and how certain it is.",
  "sourceIds": []
}
```

`status` is one of `verified`, `probable`, `proposed`, `open`, `excluded`.

### Add a source

Append an object to `sources[]` with a unique `id`, `title`, `date`, `place`, `repository`, `transcription`, `citationText`, and `url` when you have one. Add the id to each related person's `sourceIds` and to the source's `personIds`. `thumbUrl` and `imageUrl` are direct image links when the archive provides them.

### Human verification and FamilySearch

On the site, **Mark verified** and **Added to FamilySearch** each store `{by, date, comment?}` in the browser. **Pending** → **Submit** opens one GitHub issue titled "Human verifications" (label `verification`, once that label exists). Each item has an `action`:

```json
{
  "verifications": [
    {"noteId": "juan-valdes-sanchez-abt1872-n0", "action": "humanVerified", "by": "Ada", "date": "2026-10-02"},
    {"sourceId": "hid-1824-L36-0107v", "action": "addedToFamilySearch", "by": "Ada", "date": "2026-10-03", "comment": "Attached the padrón image"}
  ]
}
```

Use `sourceId` instead of `noteId` for a source. `action` `humanVerified` sets `humanVerified`. `action` `addedToFamilySearch` sets `addedToFamilySearch` to the same `{by, date, comment?}` shape. Create the `verification` label in the repo so the prefilled link can attach it. When `data.json` already has that field, it wins and the browser mark is dropped. The site shows an Added to FamilySearch badge.

Submit moves those marks out of the pending list into a submitted list, stamped with the submit date. The next issue contains only new marks. Resubmit opens that same batch again if the GitHub issue was never created. Clear removes the batch from this browser.

### Corrections and notes

**Suggest correction** on a source, a person's note or fact, or a family page stores the suggestion in the browser. **Pending** → **Submit** opens a GitHub issue titled "Corrections and notes" (label `correction`, once that label exists). The issue body is a short list plus a JSON block:

```json
{
  "corrections": [
    {
      "targetType": "source",
      "targetId": "hid-1824-L36-0107v",
      "kind": "Correction",
      "comment": "The page number looks wrong.",
      "suggestedValue": "0108v",
      "by": "Ada",
      "date": "2026-10-03"
    }
  ]
}
```

`targetType` is `source`, `note`, `event`, `person`, or `family`. `personId` and `field` are included when they apply (a note's person, or `birth` / `death` / an event type / `marriage`). `suggestedValue` is omitted when blank.

Apply it by hand. On a source or note, append to `corrections`:

```json
{"by":"Ada","date":"2026-10-03","kind":"Correction","comment":"The page number looks wrong.","status":"applied","resolution":"Updated the image code to 0108v."}
```

`status` is `applied` or `declined`. For a fact, event, or family, edit that record and describe the decision in `resolution` if you also log it on a related note or source. Create the `correction` label in the repo so the prefilled link can attach it.

Submit moves suggestions to a submitted list, and the next issue contains only new ones. Resubmit reopens that batch. A source or note suggestion leaves the browser list on its own when that record's `corrections` array has an entry with the same `by`, `kind`, and `comment` and a status of `applied` or `declined`. Facts, events, and families stay until you Clear them.

## Preview locally

From the repository root:

```bash
python3 data/validate.py
python3 -m http.server 8000
```

Open <http://localhost:8000/>. Deep links use the hash (`#/person/juan-valdes-sanchez-abt1872`), so they work on GitHub Pages without a server rewrite. `404.html` sends any other path back to the hash router.
