# Architecture

## Product shape

The first release should be a responsive web app that behaves well on a phone and desktop browser. That gives one codebase, immediate shareability, and camera access through the browser. We should not start with separate native apps because the product risk is in identity recognition and longitudinal tracking, not native device integrations.

If the product later needs offline-heavy workflows, push notifications, or app store distribution, we can add a native client against the same API surface. The first version should optimize for speed of iteration around the recognition loop.

## Recommended stack

### Client

- Next.js App Router
- TypeScript
- CSS modules or global CSS variables for a branded, mobile-first UI
- Browser camera capture using `<input type="file" accept="image/*" capture="environment">`

### Backend platform

- Supabase for auth, Postgres, storage, and row-level security
- Postgres `pgvector` for image embeddings and nearest-neighbor search
- Background job orchestration in the app layer or queue layer once uploads become asynchronous

### Vision service

- FastAPI
- Python for access to mature computer vision tooling
- Embedding generation for tree re-identification
- Species and style suggestion models behind the same service boundary

## Why not native-first

- A web-first PWA covers phone and desktop immediately.
- The first technical uncertainty is recognition quality, not the shell.
- A native-first start would increase delivery cost without reducing the core product risk.

## Recognition strategy

We should not promise fully automatic tree recognition from day one. Individual bonsai identification is closer to visual re-identification than ordinary image classification. The correct MVP pattern is:

1. User captures or uploads a photo.
2. The app stores the original photo and metadata.
3. The vision service generates an embedding and retrieves the nearest existing tree candidates from the stored front reference photo for each tree.
4. The vision service returns three separate suggestion streams: identity candidates, a species shortlist, and a bonsai style shortlist.
5. The app asks the user to confirm one of three outcomes:
   - this is an existing tree
   - this is a new tree
   - the species or style suggestion should be corrected
6. Once confirmed as a new tree, the uploaded front photo becomes the single identity reference for that tree and the backend allocates the next sequence number for the `species + style` combination.

This keeps the product honest and still makes the workflow fast.

### MVP success definition

The recognition UX is suggestion-driven, not auto-classification driven.

For the MVP, success means:

- the true species is inside the top 3 species suggestions
- the true style is inside the top 3 style suggestions
- when the photo belongs to an existing tree, that tree is inside the top 3 identity suggestions if the matcher decides there is a plausible match

This deliberately relaxes the product requirement. We do not need the system to assert one perfect answer. We need it to narrow the decision to a small, useful shortlist.

### Capture-review UX contract

The review screen should always behave like this:

1. Show up to 3 likely existing-tree matches when the identity scorer has plausible candidates.
2. Let the user attach the capture to one of those suggestions.
3. Let the user browse the full existing-tree list if the shortlist is wrong.
4. Let the user create a new tree if there is no valid existing match.
5. Show the top 3 species suggestions and top 3 style suggestions as ranked options, never as final truth.
6. Let the user browse the full species list or full style list when the shortlist misses.

This is a reasonable workflow because most bonsai growers manage dozens of trees, not massive catalogs. Manual browsing of roughly 50 to 100 trees is acceptable as a fallback.

## Naming model

Each tree gets:

- a canonical species
- a canonical bonsai style
- a sequence number unique within `owner + species + style`
- a generated inventory name rendered from those values

Example:

- `Juniperus procumbens / Informal upright (Moyogi) / 03`

The generated name is a business rule, not user-entered free text.

## Data model

Core entities:

- `species`
- `bonsai_styles`
- `trees`
- `photos`
- `recognition_jobs`

Photos are the historical record. Trees are the long-lived identity layer. Recognition jobs capture what the model suggested so we can improve the system later.

## Future-proofing for later phases

The same architecture supports the next features you mentioned:

- fertilizer and care guidance can be generated from tree metadata, season, and user region
- disease detection can become another model endpoint in the vision service
- reminders can be added in the web app and background jobs without changing the core tree/photo schema

## Delivery plan

### Phase 1

- responsive web app
- auth
- tree registration
- photo upload and storage
- photo timeline per tree
- assisted tree matching with human confirmation
- top 3 species and style suggestions with manual selection
- full-list fallback for species, styles, and existing trees

### Phase 2

- better species and style suggestions
- care plans and reminders
- disease detection
- richer timeline annotations
