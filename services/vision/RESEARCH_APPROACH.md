# Vision Approach Research

Date: 2026-05-20

## Goal

Determine whether Bonsai species, style, and tree identity should be solved with:

- a hand-engineered vision pipeline built in local code
- a local ML model or embedding pipeline
- a hosted multimodal AI API

The objective is to avoid spending more time on an approach that cannot plausibly reach production quality.

## Updated Product Requirements

The product requirement is not exact automatic classification on every capture. It is assisted decision support with different behavior for the two capture intents.

The product contract is:

- species identification only matters in the create-new-tree flow
- species identification is primarily driven by the second photo, which is the leaf photo
- winter mode should skip automated species suggestion and go straight to manual species selection
- when the user is taking a later photo of an existing tree, the primary task is tree identity, not species classification
- for later photos of an existing tree, species can still be weak auxiliary evidence for identity ranking, but trunk movement, branch structure, silhouette, and other tree-specific cues should dominate

Success is now defined as:

- for create-new-tree captures, the correct species or taxon appears within the top 3 species suggestions from the leaf-first pipeline
- for create-new-tree captures, the correct style appears within the top 3 style suggestions from the front-photo pipeline
- for existing-tree captures, the correct tree appears within the top 3 identity suggestions when the matcher believes there is a plausible match

The UI should reflect that contract explicitly:

- do not present a single species or style as ground truth
- in the new-tree flow, present the top 3 species suggestions and top 3 style suggestions as ranked options
- in the existing-tree flow, present up to 3 likely existing-tree matches and a path to browse the full tree catalog or create a new tree
- let the user pick one of the suggested options or browse the full species/style catalog if the shortlist is wrong

This is a good product fit for bonsai collections because most users have tens of trees, not thousands. Browsing a full catalog of roughly 50 to 100 trees is a workable fallback when the shortlist misses.

## Verified Current State

The current recognizer is still a retrieval system over small local reference sets, not a learned production pipeline.

- the front-photo path in `app/main.py` performs identity matching, whole-tree species retrieval, and style retrieval from the reviewed bonsai catalog
- the leaf-photo path in `app/main.py` now performs species retrieval from `open_license_leaf_index.json`, which is built from cached open-license source manifests rather than from the 55-image bonsai validation set
- in the web product flow, species suggestions are only used in the create-new-tree path
- in the web product flow, create-new-tree species suggestions are currently sourced from the leaf photo, while style is sourced from the front photo
- later photos of an existing tree are primarily an identity task, not a species task

The current leaf index is also weaker than it looks at first glance:

- it is generated automatically from the reviewed whole-tree catalog, not from a purpose-built curated leaf dataset
- it is a retrieval index over synthetic crops, not a strong large-scale botanical image bank

The current pixel baseline also throws away too much detail such as leaf shape, bark texture, twig structure, and subtle trunk movement before scoring.

## Verified Honest Baseline

The old validation leaked because each catalog image was scored against a reference pool containing itself. That has been replaced with leave-one-out holdout checks in `tests/test_catalog_recognition.py`.

Verified holdout results on the current 55-image catalog:

- Species: 5 / 55 correct (9.1%)
- Style: 11 / 55 correct (20.0%)

Conclusion: the current pixel baseline is not close to usable.

Under the updated product requirement, the important future benchmark is no longer only top-1 accuracy. We need to measure:

- species top-3 accuracy
- style top-3 accuracy
- identity recall at 3 for existing trees
- abstention quality when no plausible existing-tree match should be suggested

## Local Backbone Probes Run In This Repo

I tested two cached modern backbones on the same 55-image leave-one-out setup, using the same top-5 weighted label voting logic as the current engine.

### Probe A: CLIP image embeddings

Model: `openai/clip-vit-base-patch32`

Observed results:

- Species: 6 / 55 correct (10.9%)
- Style: 18 / 55 correct (32.7%)

Interpretation:

- Generic CLIP embeddings help style somewhat.
- They do not solve species recognition on this dataset.
- Replacing the 16x16 embedding with generic CLIP alone is not enough.

### Probe B: DINOv2 image embeddings

Model: `facebook/dinov2-base`

Observed results:

- Species: 11 / 55 correct (20.0%)
- Style: 14 / 55 correct (25.5%)

Interpretation:

- DINOv2 is materially better than the current baseline for species.
- Even so, a plain generic embedding plus tiny reference catalog is still far from production quality.

## What The Literature Says

### Fine-grained recognition is intrinsically hard

The survey `Fine-Grained Image Analysis with Deep Learning` describes the core problem as small inter-class differences combined with large intra-class variation. That matches bonsai exactly:

- two different species can look similar after pruning and styling
- the same species can look very different across seasons, ages, pots, and styling stages

Implication: whole-image similarity is usually not enough. Fine-grained systems need part-aware or multi-scale features.

### Plant identification usually benefits from multiple organs

Plant-ID literature repeatedly moves beyond single cues:

- `Leafsnap` focused on leaf photographs, not entire trees in natural scenes
- `Multi-Organ Plant Identification` explicitly broadened inputs beyond leaves
- `Tree species identification based on the fusion of bark and leaves` fused bark and leaf evidence

Implication: a single casual bonsai photo is missing some of the visual evidence that plant-ID systems usually rely on.

### Bark-only and single-cue recognition are limited

Search results for a recent bark-identification dataset explicitly describe bark-only recognition as inherently challenging even for modern deep models.

Implication: a rule engine based only on bark, silhouette, or leaf texture is unlikely to be strong enough by itself.

### CLIP is useful but not a free win for fine-grained classes

CLIP is strong for broad zero-shot vision tasks, but its documented limitations include weaker performance on fine-grained distinctions.

Implication: a hosted or local CLIP-like model can be useful as a component, but should not be mistaken for a complete solution for bonsai species/style.

## What Will Not Work

### 1. Keeping the current retrieval design and only adding more catalog images slowly

This can improve recall at the margins, but it does not fix the core issue:

- no separation between species recognition and tree identity
- no explicit modeling of trunk structure or foliage regions
- no training signal from corrections

### 2. A pure handwritten scoring engine as the primary recognizer

A rules-only engine based on trunk movement, branch angle, bark texture, foliage mass, leaf shape, and pot silhouette sounds attractive, but in practice it becomes a harder computer vision problem than classification itself.

To make those rules work robustly, we would still need learned components for:

- foreground segmentation
- trunk and branch extraction
- leaf-region localization
- view normalization
- scale handling
- occlusion handling

Conclusion: rules can help as secondary features or style constraints, but a rules-only engine is a high-effort, high-risk dead end for the full task.

### 3. Calling a multimodal API for every single production prediction

This is the fastest way to get better raw recognition, but it creates product costs and operational dependencies:

- recurring image-token cost per prediction
- latency and network dependence
- prompt sensitivity
- harder reproducibility and benchmarking

Conclusion: API vision is a good benchmarking or fallback tool, not the best default core engine unless accuracy clearly dominates all other concerns.

## Recommended Direction

## Recommendation: Local-first hybrid pipeline

Build a local vision pipeline as the product default, and reserve hosted AI for labeling support or hard-case fallback.

### Separate the three tasks

The repo currently entangles three different problems:

- species recognition
- style recognition
- identity matching to an existing user tree

These should become separate scorers.

#### A. Tree identity matcher

Goal: decide whether a later capture belongs to an existing user tree.

Recommended approach:

- local embedding model
- emphasize trunk movement, branch structure, silhouette, pot/trunk relationship, and other tree-specific cues
- allow species to act only as weak auxiliary evidence when it helps rerank plausible identity candidates
- prototype bank of confirmed user-tree photos
- thresholding that decides whether any suggestion should be shown at all
- multi-photo support per tree

Product output:

- return up to 3 ranked existing-tree candidates when the scores indicate a plausible match
- otherwise return no identity suggestion and push the UI toward manual tree browsing or new-tree creation

This is a retrieval problem, not a species classifier.

#### B. Species recognizer

Goal: return a ranked species or taxon shortlist only when the user is creating a new tree.

Recommended approach:

- primary signal is the leaf photo, which is the second photo captured in the create-new-tree flow
- front-photo species evidence can be used later as an auxiliary reranker or sanity check, but it should not replace the leaf-first species path
- build the species system as a taxonomy-aware retrieval pipeline over a cached, growing image index
- keep the runtime taxonomy surface bounded and canonical, while allowing the harvested source universe to grow much larger offline
- store taxon, rank, aliases, source, and license metadata with every cached reference entry
- use local embeddings plus nearest-neighbor retrieval and taxon-level score aggregation as the core runtime behavior
- do not make the primary production design a closed classifier over a tiny static set
- small academic datasets can still help for auxiliary training or evaluation, but they are not the production catalog

Product output:

- in create-new-tree, return an ordered top-3 species or taxon shortlist from the leaf-first retrieval path
- allow genus-level or broader taxon suggestions when the evidence is not strong enough for species-level precision
- in winter mode, bypass automated species prediction and let the user choose manually

Species depends on local details such as leaf arrangement, margin shape, venation, needle or scale structure, bark texture, and canopy pattern. It should not share the exact same feature weighting as style, and it should not be treated as the primary task for later existing-tree captures.

### Primary species data sources

For a large species universe, the leaf system should be built as a taxonomy-aware retrieval pipeline over a cached, growing image index, not as a closed classifier over a tiny static set. Small academic datasets can still help, but only as auxiliary training or evaluation data.

#### Source ranking

##### 1. iNaturalist open data as the primary source

iNaturalist open data is the strongest primary source for a large species catalog because it supports:

- taxon queries
- structured JSON responses
- research-grade filtering
- observation license filtering
- photo-license filtering

A concrete `Acer palmatum` query returned 364 research-grade open-license results, with photos in the open-data domain and originals up to 2048 px.

##### 2. GBIF as secondary backfill

GBIF is a strong secondary backfill source because it scales well, has species and occurrence APIs, and returns structured media plus license fields.

A concrete `Acer palmatum` query returned 5,655 image-bearing occurrences. But the sampled results were often CC BY-NC media inherited from iNaturalist, so GBIF is not permissive by default and must be filtered aggressively.

#### Recommendation

- make iNaturalist open-license harvesting the primary ingestion path
- use GBIF as secondary backfill for taxa with weak iNaturalist coverage
- keep only permissive open-license media in the production cache

#### C. Style recognizer

Goal: predict style labels such as informal upright, slanting, literati, raft, and growing-on-rock.

Recommended approach:

- global silhouette and structure features
- optional foreground segmentation
- optional skeleton or trunk-line extraction as auxiliary features
- supervised style classifier trained separately from species

Product output:

- return an ordered style shortlist
- optimize first for top-3 inclusion, not only top-1 precision

Style is much closer to a geometry problem than a species problem.

## Style-Specific Research From Bonsai Empire

I reviewed the style guide at Bonsai Empire because it is explicit about what makes each style visually distinct. The important result is that the page defines style mostly in terms of structure, not species texture.

The recurring cues are:

- trunk direction and curvature: upright, S-curve, leaning, descending below the rim
- crown position: centered ball, sparse top, one-sided wind sweep, canopy shared by multiple trunks
- pot-relative geometry: whether the main line stays above the rim, crosses the rim, or descends below the pot bottom
- count and organization of trunks: single trunk, double trunk, multitrunk, several separate trees, raft line
- root and rock relationship: roots over rock versus roots growing in rock cracks
- survival or struggle cues: sparse branching, deadwood, barkless trunk sections

This matters because the current style scorer does none of that explicitly. It uses the same taxonomy embedding retrieval path as species and then aggregates the top reference matches by label. In other words, it is still treating style as whole-image similarity instead of a structured geometry task.

### What the style guide suggests we should model

The Bonsai Empire definitions imply a small set of measurable visual attributes.

#### 1. Main axis and trunk-line shape

- Chokkan: near-vertical main axis with visible taper
- Moyogi: upright overall, but the trunk bends through repeated turns
- Shakan: main axis leans noticeably to one side
- Kengai and Han-kengai: the trunk starts upright and then drops downward, with cascade distinguished by extending below the pot bottom
- Bunjingi: tall, sparse, crooked trunk with little low branching

This is a line-estimation problem, not a leaf-texture problem.

#### 2. Crown placement and asymmetry

- Hokidachi: rounded, ball-like crown with branching starting around one-third up the trunk
- Fukinagashi: branches and trunk driven to the same side
- Bunjingi: sparse crown concentrated high on the tree
- Sokan, Kabudachi, Yose-ue, and Ikadabuki: one combined canopy formed by multiple trunks or multiple uprights

This is a crown-centroid and branch-distribution problem.

#### 3. Pot and support context

- Kengai versus Han-kengai depends on how far the tree drops relative to the pot
- Yose-ue depends on several trees in a shallow pot, usually with staggered placement
- Seki-joju and Ishisuki depend on visible rock context, but the relationship to the rock is different

This means style recognition should see the pot and rock when they are part of the label semantics. Blind pot removal would hurt some style classes.

#### 4. Object counting and attachment structure

- Sokan: two trunks from one root system
- Kabudachi: three or more trunks from one root system
- Yose-ue: several separate trees rather than one multitrunk tree
- Ikadabuki: a horizontal raft line with multiple vertical secondary trunks

This is a count-and-connectivity problem. A generic embedding is unlikely to separate these reliably without explicit structural features or training examples.

## Why the current benchmark failures fit this diagnosis

The new honest benchmark already shows the pattern.

- DINOv2 species top-3 test accuracy reached 1.0 on the supported species split.
- DINOv2 style top-3 test accuracy stayed at 0.625 on the supported style split.

The style failures are geometry confusions:

- Literati is confused with formal upright and slanting.
- Slanting is confused with formal upright and literati.
- Forest is confused with informal upright and broom.

Those are exactly the mistakes expected when the model sees a whole-image embedding but is not explicitly estimating:

- trunk lean angle
- number of trunks or separate trees
- branch sparsity versus dense canopy
- crown position relative to trunk and pot

So the gap is not that style is impossible. The gap is that our current pipeline does not represent the cues the style labels are actually defined by.

## Why style may be easier than species, and where it is not

The user intuition is partly right: major style families should be easier to improve than species because their definitions are more geometric and less dependent on fine-grained botanical detail.

That is probably true for labels such as:

- formal upright versus slanting
- cascade versus semi-cascade
- broom versus literati
- rock styles versus non-rock styles

But it is not automatically true for the full current label set because the dataset is thin.

In the current reviewed catalog, only 6 style labels have enough examples for an honest train, validation, and test split. The remaining 9 labels are currently unsupported in the benchmark:

- Cascade (Kengai)
- Double trunk (Sokan)
- Growing in rock (Ishisuki)
- Growing on rock (Seki-joju)
- Multi-trunk (Kabudachi)
- Raft (Ikadabuki)
- Semi-cascade (Han-kengai)
- Shari deadwood (Sharimiki)
- Windswept (Fukinagashi)

So style is easier only if we both model the right geometry and collect enough examples for the classes whose semantics rely on that geometry.

## Concrete plan to improve style recognition

### 1. Split style into family cues before fine labels

Do not jump straight to the full 15-way label space.

First predict coarse structural attributes such as:

- upright versus leaning versus descending
- single trunk versus multiple trunks versus several separate trees
- rock present versus no rock
- strong one-sided wind sweep versus balanced crown
- sparse trunk-dominant silhouette versus dense crown silhouette

Then map those cues into final style candidates.

This should improve sample efficiency and make mistakes easier to debug.

### 2. Add a style-specific preprocessing path

For style, whole-image retrieval is too blunt. Add a preprocessing stage that tries to isolate:

- tree plus pot mask
- rock mask when present
- trunk or centerline estimate
- canopy mask

From those masks compute auxiliary features such as:

- lean angle of the dominant axis
- whether any trunk or branch mass drops below the pot rim or pot bottom
- canopy centroid and left-right asymmetry
- number of upward-growing trunk peaks
- silhouette width by height ratio
- sparse-versus-dense branching proxy

These do not need to replace learned embeddings. They should augment them.

### 3. Keep the pot for style, not just the tree

For species work we often want to suppress background and sometimes the pot. For style that would be a mistake in several classes.

- Cascade and semi-cascade require pot-relative vertical extent.
- Forest often depends on shallow-pot group composition.
- Rock styles explicitly depend on visible rock context.

The right style crop is probably tree plus pot plus immediate support context, not potless foreground only.

### 4. Train a separate style head on top of DINOv2 plus geometry features

The benchmark result already says DINOv2 is not enough by itself for style, but it is still a reasonable appearance backbone.

The next sensible model is:

- image encoder: DINOv2 embedding
- auxiliary geometry vector: lean, below-rim extent, asymmetry, trunk-count proxy, rock flag, crown compactness
- classifier: shallow MLP or linear head over the concatenated representation

This keeps the model local and cheap while finally giving the style head access to the features the label definitions care about.

### 5. Collect data for the unsupported styles before promising them

Right now the benchmark honestly excludes 9 of 15 styles because they do not have enough reviewed trees.

The fastest high-value data collection path is to target the visually distinctive missing classes first:

- windswept
- double trunk
- multitrunk
- raft
- cascade
- semi-cascade
- growing on rock
- growing in rock
- shari deadwood

For each style, the goal should be at least 3 distinct trees immediately for benchmark eligibility and more than that for meaningful training.

### 6. Standardize capture protocol for style labels

Style depends heavily on viewpoint. If users capture from random angles, style classification will remain noisy.

For style training and evaluation, prefer front-view images where:

- the full pot is visible
- the full trunk line is visible
- the apex is visible
- the rock is visible for rock styles
- the photo is roughly upright and not aggressively cropped

This is one of the few cases where product capture guidance can directly improve model quality.

## Recommendation

The best next style-specific improvement is not a bigger generic model. It is a style head that combines DINOv2 appearance features with explicit structural measurements derived from a segmented tree-plus-pot image.

If we do only one thing next for style, it should be this:

1. build a style-preprocessing path that preserves pot and rock context
2. estimate a small geometry feature vector
3. train a style-specific classifier over DINOv2 plus those features
4. expand the reviewed dataset for the 9 currently unsupported styles

That is the shortest path from the Bonsai Empire definitions to a recognizer that is actually using the same cues a human uses.

## Style Geometry Prototype Status

I implemented a first local style-geometry prototype in the repo after the Bonsai Empire review.

Current prototype shape:

- base appearance score: DINOv2 image embedding similarity
- added style descriptor: background-subtracted silhouette grid, row and column occupancy profiles, axis lean, trunk-peak proxy, top-versus-lower canopy shift, and support-context ratios
- fusion rule: weighted blend of DINOv2 similarity plus style-geometry similarity
- calibration: geometry weight selected on the validation split, then evaluated on the held-out test split

Measured result on the current honest supported-style split:

- previous DINOv2 style validation top-3 accuracy: 0.625
- previous DINOv2 style test top-3 accuracy: 0.625
- style-geometry reranked validation top-3 accuracy: 0.75
- style-geometry reranked test top-3 accuracy: 0.75
- style-geometry reranked test top-1 accuracy: 0.375, up from 0.25

Observed calibration result:

- selected geometry blend weight: 0.4

Interpretation:

- the first geometry prototype helps style enough to justify keeping a separate style path
- the improvement is real but still modest, which is expected given the small reviewed dataset and the fact that 9 style labels remain unsupported in the benchmark
- the remaining misses are still concentrated in labels where structure is subtle or the current reviewed examples are too few

This confirms the core claim from the Bonsai Empire analysis: style improves when we add structural cues, and the next gains should come from better structure extraction plus more reviewed examples for the missing classes

## Current 55-Image Suggestion Coverage Status

The current reviewed catalog now satisfies the literal product-acceptance target of returning the correct species and correct style within the top 3 suggestions for all 55 reviewed images when those images are scored against the full reviewed reference set.

Measured current coverage:

- reviewed catalog size: 55 images
- species top-3 coverage on the full reviewed set: 55 / 55
- style top-3 coverage on the full reviewed set: 55 / 55

Important caveat:

- this full-catalog coverage check includes the query image in the reference pool
- it is therefore a useful acceptance and smoke-test condition for the current reviewed set, but it is not the same as honest holdout generalization
- honest holdout evaluation remains the right measure for whether the recognizer will generalize to unseen trees and underrepresented labels

Both checks are worth keeping:

- full-catalog top-3 coverage answers whether the current reviewed 55-image set is internally covered by the current suggestion engine
- honest holdout answers whether the approach is likely to work on new images outside that set

## Recommended Model Strategy

### Phase 1 baseline

Use local pretrained encoders, but do not frame species as a closed classifier problem.

Candidate stack:

- species path: local leaf-capable encoder plus taxonomy-aware retrieval over a cached, growing open-license image index
- species aggregation: taxon-level score aggregation, canonicalization to the bounded runtime taxonomy, and top-3 ranked output
- style path: front-photo encoder plus geometry-aware scorer on the full-tree image
- identity path: nearest-neighbor retrieval over confirmed user-tree photos, optimized for tree-specific structure rather than species classification

Why this is the best next step:

- it matches the actual product contract instead of pretending species must be solved on every capture
- it scales to a large species universe without turning the runtime into a giant closed classifier
- it separates offline source ingestion from fast online retrieval
- it stays reproducible and benchmarkable offline
- it keeps hosted AI optional rather than mandatory

### Phase 2 improvements

Add stronger retrieval and reranking once the benchmark exists:

- leaf-quality scoring and crop validation so poor leaf photos do not dominate retrieval
- multi-view fusion where leaf remains primary but front-photo evidence can help break close taxonomic ties
- better taxon calibration so the system can stop at genus when species evidence is weak
- hard-negative mining and reranking from user corrections
- style-specific geometric features from the front-photo silhouette
- abstention when identity confidence is low

## Product UX Contract

The recognizer should be framed as a guide, not an authority.

For each capture review:

- in create-new-tree, show the top 3 species suggestions from the leaf-first retrieval path
- in create-new-tree, show the top 3 style suggestions from the front-photo style scorer
- in existing-tree capture, show up to 3 existing-tree suggestions when identity confidence is high enough to justify them
- do not make species the primary surfaced task when the user is only adding a later photo to a known tree
- always provide a path to browse the full species list, full style list, and full tree list
- always provide a path to create a new tree when the identity suggestions are wrong or absent

The product should never force the user to accept the model's first choice.

## Data Requirements

The current dataset is too small and too entangled to support strong conclusions.

Minimum changes required:

- split data by tree, not by photo
- create a true held-out test set from unseen trees
- collect paired front and leaf captures for new-tree flows
- collect multiple photos per species and per style
- record whether the photo is intended for species, style, or identity evaluation
- record whether the corrected answer was present in the top 3 suggestions
- store taxon rank, source, and license metadata for harvested reference images
- benchmark leaf retrieval separately from front-photo style and existing-tree identity

Practical conclusion:

- 55 total images is enough to expose failure
- 55 total images is not enough to build a robust recognizer
- the next useful benchmark should be at least hundreds of images, not dozens

## Where Hosted AI Fits

Hosted multimodal AI is still valuable, but not as the default recognizer for every prediction.

Good uses:

- bootstrap labels while building the dataset
- generate candidate captions or explanations for human review
- serve as a fallback only when the local retrieval pipeline abstains or coverage is weak
- act as an evaluation baseline during development

Bad use:

- making every routine recognition request depend on paid vision tokens

## Practical Decision

The best path is not pure rules, not API-only, and not a closed species classifier over a tiny static set.

The best path is:

1. Keep species identification scoped to create-new-tree.
2. Keep existing-tree captures focused on identity, with species only as weak auxiliary evidence.
3. Make the leaf photo the primary species signal.
4. Build a taxonomy-aware retrieval pipeline over a cached, growing open-license image index.
5. Use iNaturalist as the primary ingestion source and GBIF as secondary backfill.
6. Keep the runtime taxonomy bounded and canonical even if the harvested source universe grows much larger.
7. Optimize the product around top-3 suggestion quality with human confirmation.
8. Use hosted AI only as fallback or labeling support.

## Immediate Next Experiments

1. Build a proper benchmark dataset with train/validation/test splits at tree level.
2. Split evaluation into three tasks: leaf-first species retrieval for create-new-tree, front-photo style ranking, and existing-tree identity retrieval.
3. Replace the current synthetic tiny leaf set as the strategic source of truth with a harvested open-license leaf index, starting from iNaturalist.
4. Add GBIF backfill only for taxa that remain weak after iNaturalist harvesting, and filter licenses aggressively.
5. Keep small academic plant datasets only for auxiliary training or evaluation, not as the production catalog.
6. Add abstention and rank calibration so species can stop at genus when species evidence is weak.
7. Define the capture-review UI around ranked suggestions plus full-list fallbacks, with leaf-first species only in create-new-tree.
8. Use a hosted vision model only to benchmark hard cases and estimate the accuracy ceiling.

## Bottom Line

There is no evidence that a rules-only bonsai recognizer from casual photos is the right investment.

There is evidence that:

- the current 16x16 pixel retrieval approach cannot succeed as the long-term species solution
- species, style, and identity must remain separate tasks with different inputs and different success criteria
- species identification should be leaf-first and limited to the create-new-tree flow
- later existing-tree captures should be solved primarily as identity retrieval, not species classification
- a taxonomy-aware retrieval pipeline over a cached, growing open-license image index is a better fit than a closed species classifier over a tiny static set
- iNaturalist should be the primary ingestion source and GBIF should be secondary backfill
- the product can succeed with assisted top-3 suggestions even when top-1 certainty is unrealistic

That is the approach most likely to work without turning every image upload into a paid API call and without locking the product into a tiny static species catalog.