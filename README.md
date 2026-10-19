# Magic Picker

A classroom student picker and star-and-card collection for children aged 5–6. It needs no server: data is stored in the browser (IndexedDB).

**Live site:** https://nazrin-teacher.github.io/magic-picker/

## Opening it

- **Online:** open the live site above (Chrome or Edge recommended).
- **Offline:** download this folder and double-click `index.html`. Without internet the title fonts fall back to built-in fonts.
- Do not use a private/incognito window: the data is deleted when it closes.

## Flow

Class → tap a name or **Pick a Student** → the teacher gives stars → **Choose a Card** → **My Collection**

- Teacher tools: **Teacher** at the top right. While the panel is unlocked, `+1 +2 +3 / Other` star buttons appear on the student screens; **Lock** hides them.
- First step: Teacher → Students → add names one at a time or many at once (one name per line). To try the app first, use Backup & Data → **Load demo data** (a separate “DEMO” class that one click removes).

## Rules

- Default: 5 stars = 1 card (change it in Settings; the past is not recalculated).
- “Total earned” and “stars to spend” are kept separately; the balance never goes below zero.
- Choosing a card is one database step: the stars are taken and the card is added to the album together, or nothing happens. The same confirmation can never be applied twice.
- All cards are worth the same; Surprise Me picks among the cards the student does not have yet, each with the same chance.
- “Undo last action” undoes the latest star or card action in the selected class (a card leaves the album and its stars come back).

## Printing

Student Details → Print: **Filled album**, **Blank album**, **Earned card sheets**; also “All 40 cards”, and a whole class from the Classes tab.

The album (cover + 10 album pages + back cover = 12 pages) has two layouts, chosen with **Layout** on the print screen:

| Layout | Paper | Print settings | Result |
|---|---|---|---|
| **Separate A5 pages** (default) | A5 | A5, 100% | 12 separate A5 sheets |
| **A4 folded booklet** | A4 | A4 landscape, 100%, no margins, two-sided **flip on short edge** | 3 A4 sheets (6 sides); stack, fold in the middle, staple along the fold |

In both layouts the A5 page size and the card slots are the same. In the booklet the page order is arranged automatically (sheet 1: 12|1 and 2|11 …).
Always turn on “Background graphics”. For a PDF, choose “Save as PDF”.
Card sheets are always A5; printed cards are the same size as the album slots: 57 × 47.5 mm.

## Data and safety

- Data stays only in this browser on this device; it does **not sync** between devices and there is no cloud copy. Download a backup regularly from Backup & Data → **Download backup (JSON)**.
- Restoring checks the file first; a broken file does not change the current data.
- The PIN only hides the teacher tools on this screen; it is **not real authentication** and it does not encrypt the data.
- Student names are never part of this repository or the website. Class lists are loaded on the classroom device from a backup file.

## Files

- `index.html`, `css/`, `js/` – the app (`js/store.js` is the data layer)
- `assets/cards/adv-01…20.jpg` (Adventure) and `won-01…20.jpg` (Wonder) – the 40 cards, 264×220 px
- `assets/card-back.jpg`, `assets/stage.jpg`, `assets/source/` – card back, stage background and the original sheets
- `tools/crop-cards.sh` – re-cuts the cards from the original sheets (macOS `sips`)
- `tests.html` – data-layer scenario tests (uses its own test database, never the real data)
