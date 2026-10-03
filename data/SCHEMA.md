# Family-tree data schema

`data/data.json` is the only source for the site. Edit that file (directly or by pull request); do not add per-person pages. `validate.py` checks the file and exits 0 when there are no structural errors. Same-name pairs are warnings and do not fail the check.

```bash
python3 data/validate.py
```

## Sources of truth (in order of authority)

The file was assembled from, in order:

1. Image-verified crops in the Gijón registro civil actas (each filename encodes the reading).
2. Findings notes from that research.
3. The "Family History Notes" Google Sheet (`fhn_oct1.xlsx` plus the `fix_*.csv` / `fix2_*.csv` corrections of 1 Oct 2026).
4. The Havana Church Records and AI Transcription Tracking tabs. The Bermúdez descendants (Vázquez daughters and their spouses) come from the research memory notes only.
5. Kyler Rasmussen's FamilySearch Family Tree (read-only capture, 1 Oct 2026). Records attached there count as verified and carry `humanVerified` by "Kyler Rasmussen (FamilySearch tree)". Tree facts with no attached record are `probable` and cite `fs-tree-kyler-2026-10-01`. Conflicts with the image-verified data are kept as open notes; the image-verified readings still win.

Where these conflict, the image-verified readings and the 1 Oct corrections win.

People flagged `livingStatus: "possibly-living"` (born 1910–1920 with no recorded death) are included. The published site shows every person; the owner chose not to filter them.

## Top level

| key | contents |
|---|---|
| `meta` | title, generation date, schemaVersion, sourcesOfTruth, privacyWarning |
| `people[]` | one entry per individual |
| `families[]` | one entry per couple, or single parent, with children |
| `sources[]` | one entry per record (image, frame, file, tree) |
| `researchLeads[]` | open questions and next steps |
| `excluded[]` | candidates already checked and ruled out; do not re-check them |

## Controlled vocabularies

- **quality** (on birth, death, events, marriage): `verified` (read in the record), `probable` (strong inference), `proposed` (hypothesis), `estimated` (computed from an age, or an approximate date), `unknown`.
- **status** (on notes, parentLinks, childLinks, coupleStatus): `verified`, `probable`, `proposed`, `open`, `excluded`.
- Dates are ISO `YYYY-MM-DD` when exact. Otherwise they are free text such as `abt 1872`, `bef 1801`, `abt 1820–1825`, or `1914`.
- Places are written in full, e.g. `Porceyo, Gijón, Asturias, Spain`.

These status and quality values are the research assistant's assessment. They are separate from `humanVerified`, which records a person looking at the note or source.

## people[]

| field | meaning |
|---|---|
| `id` | stable slug: given-surnames-year, or a descriptive form such as `-fl1773` (floruit), `-abt1825`, `-son-of-…` |
| `given`, `surnames` | as recorded. `surnames` is `null` where the sheet does not transcribe them (the 3 Cacioya children) |
| `sex` | `M` / `F` |
| `alsoKnownAs[]` | spelling variants and index forms |
| `birth`, `death` | `{date, place, quality, sourceIds[], details?}`. Birth may be a baptism (see details) |
| `events[]` | `{type, date, place, quality, sourceIds[], details}`. Types used: residence, occupation, military, arrest, burial, office, immigration, social security application |
| `parents[]` | person ids (husband and wife of the family listing this person as a child) |
| `parentLinks[]` | `{id, status, familyId}`: how certain each parent link is. The tree draws a solid line for `verified`, dashed for `probable`, and dotted for `proposed`. |
| `spouses[]` | person ids |
| `familyIds[]` | families this person belongs to, as spouse or child |
| `notes[]` | dated research notes. See below. |
| `sourceIds[]` | every source that mentions or supports this person |
| `familySearchPid` | FamilySearch Family Tree ID where known (e.g. `GGZG-464`), or `null` |
| `line` | display group: Valdés, Sánchez, Menéndez, Nieto, Uría, Rodríguez, Bermúdez (Havana), each with optional `(collateral)` or `(in-law)` |
| `livingStatus` | `possibly-living` (born ≥1910 with no death) or `deceased-or-presumed` |

In-laws' own parents are modelled only where the line's records name them and they matter, e.g. Cecilia Pérez's parents.

### notes[]

| field | meaning |
|---|---|
| `id` | **Required.** Stable id for human verification. Use `{personId}-n{index}` when appending a note, e.g. `juan-valdes-sanchez-abt1872-n3`. Never renumber or reuse an existing note id; if you insert a note, give it a new unused suffix. |
| `date` | ISO date the note was written |
| `status` | `verified`, `probable`, `proposed`, `open`, or `excluded` |
| `text` | the note |
| `sourceIds[]` | sources the note relies on |
| `humanVerified` | optional. `{by, date, comment?}`. A person has checked this note. `by` is a non-empty string, `date` is `YYYY-MM-DD`, and `comment` is an optional string. Omit the field until then. This does not change `status`. |
| `corrections[]` | optional, backward-compatible. Each entry is `{by, date, kind, comment, status, resolution}` after a suggestion has been decided. `kind` is `Correction`, `Clarifying note`, `Wrong person linked`, or `Other`. `status` is `applied` or `declined`. `resolution` says what was done. Omit the array until then. |

## families[]

| field | meaning |
|---|---|
| `id` | `fam-<husband>-<wife>` slug |
| `husband`, `wife` | person id or `null` (unknown) |
| `coupleStatus` | certainty that these two were a couple, or that the identification is right. Drawn as a solid, dashed, or dotted marriage line. |
| `children[]` | person ids |
| `childLinks[]` | `{id, status}`: certainty of each child link. Matches `parentLinks` on the child. |
| `marriage` | `{date, place, quality, source}`. `source` is a source id or null |
| `notes[]` | free-text explanations of the evidence |

## sources[]

| field | meaning |
|---|---|
| `id` | e.g. `rc-1844D0037v` (Registro Civil image), `hid-1801-L34-0127r` (padrón de hidalguía), `cen-1920-pinera3` (census), `ahn-…`, `fs-…`, `ssda-…` |
| `title` | FamilySearch-style title |
| `type` | civil birth / civil death / civil marriage / padrón de hidalguía / census / church register (negative search) / … |
| `date`, `place` | of the event or record |
| `repository` | Archivo Municipal de Gijón (fondos.gijon.es), FamilySearch, AHN/PARES, CDMH, … |
| `imageCode` | e.g. `RCGijón1844D0037v`, `PMFGijónL34-0127r`, FamilySearch frame `008034668_00955` |
| `url` | exact `.info` / ark / PARES link taken from the sheet |
| `urlDerived` | `true` when the URL was built from the folder pattern seen in the sheet and not copied verbatim. Check before publishing |
| `altUrls[]` | further links (e.g. a second census frame) |
| `citationText` | ready-to-paste FamilySearch citation |
| `transcription` | the key facts read from the record |
| `personIds[]` | people the record mentions or supports |
| `candidatePersonIds[]` | people for whom the record is only a candidate; NOT confirmed |
| `verifiedCrops[]` | crop filenames that confirm the reading |
| `imageUrl`, `thumbUrl` | optional direct JPEG links (fondos.gijon.es). The site shows the thumbnail and links to the full image. |
| `humanVerified` | optional, same shape as on notes: `{by, date, comment?}`. A person has checked this source. Omit the field until then. |
| `corrections[]` | optional, same entries as on notes: `{by, date, kind, comment, status, resolution}`. |
| `imageVerified`, `frames`, `localImages` | optional extras |

## researchLeads[] / excluded[]

- `researchLeads[]`: `{id, title, status:"open", detail, personIds[]}`
- `excluded[]`: `{id, candidate, record, reason, relatedPersonIds[]}`

## Human verification

`humanVerified` is optional on every note and every source. The site can also store a mark in the browser before it is committed. Submit files the pending marks as an issue and keeps them in a separate submitted list so the next issue does not repeat them. When `data.json` contains `humanVerified` for that id, the committed value wins and the browser mark is dropped.

Applying a mark from a GitHub issue means adding the object and nothing else:

```json
"humanVerified": {"by": "Ada", "date": "2026-10-02", "comment": "Compared with the padrón image"}
```

`comment` may be omitted.

## Corrections

`corrections` is an optional array on a note or a source. Older files without it are still valid. The site does not write this array. A suggestion is queued in the browser and submitted as a GitHub issue titled "Corrections and notes" (label `correction`). The maintainer applies or declines it by hand, then adds:

```json
"corrections": [
  {
    "by": "Ada",
    "date": "2026-10-03",
    "kind": "Correction",
    "comment": "The page number looks wrong.",
    "status": "applied",
    "resolution": "Updated the image code to 0108v."
  }
]
```

`kind` is one of `Correction`, `Clarifying note`, `Wrong person linked`, `Other`. `status` is `applied` or `declined`. When an `applied` entry is present, the site shows a Corrected badge and the history. A browser suggestion for that source or note is dropped when an entry matches its `by`, `kind`, and `comment`.

## Validation

`validate.py` checks:

- Every id referenced anywhere exists: parents, spouses, parentLinks, familyIds, family members, sourceIds, marriage sources, source personIds and candidatePersonIds, lead and excluded personIds.
- No duplicate ids, including note ids.
- Every note has a stable `id`.
- `humanVerified`, when present, has `by`, a real `YYYY-MM-DD` `date`, and an optional string `comment`.
- `corrections`, when present on a note or source, is an array of `{by, date, kind, comment, status, resolution}` with an allowed `kind` and `status` of `applied` or `declined`.
- No orphan people: every person belongs to a family or a source.
- No orphan sources.
- Parents are at least 14 years older than their children.
- Same-name report (warning only): the remaining pairs are deliberate (reused sibling names after an infant death, or uncle/nephew namesakes in different families).
