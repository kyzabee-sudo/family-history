# Family history

Static dashboard for the Valdés, Nieto, Uría, Sánchez, Menéndez and Rodríguez research (Cenero / Porceyo / Gijón) and the Havana Bermúdez line. The site reads [`data/data.json`](data/data.json) in the browser. There are no per-person pages to edit.

After GitHub Pages is enabled, the site is published at <https://kyzabee-sudo.github.io/family-history/>.

**Pages setting:** Settings → Pages → Build and deployment → Source: **GitHub Actions**. The workflow [`.github/workflows/pages.yml`](.github/workflows/pages.yml) validates the data, then deploys on every push to `main`.

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

### Human verification

On the site, **Mark verified** stores `{by, date, comment?}` in the browser. **Pending verifications** opens a GitHub issue titled "Human verifications" (label `verification`, once that label exists) with a JSON block:

```json
{"verifications":[{"noteId":"juan-valdes-sanchez-abt1872-n0","by":"Ada","date":"2026-10-02"}]}
```

Use `sourceId` instead of `noteId` for a source. Applying it means setting `humanVerified` on that note or source. Create the `verification` label in the repo so the prefilled link can attach it. When `data.json` already has `humanVerified`, it wins and the browser mark is dropped.

## Preview locally

From the repository root:

```bash
python3 data/validate.py
python3 -m http.server 8000
```

Open <http://localhost:8000/>. Deep links use the hash (`#/person/juan-valdes-sanchez-abt1872`), so they work on GitHub Pages without a server rewrite. `404.html` sends any other path back to the hash router.
