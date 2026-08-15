-- Capture submissions become the single source of truth for in-flight captures
-- (previously split between the database and a per-user JSON file on disk).
-- These columns persist the full wizard state so review works from the DB alone.

alter table public.capture_submissions
    add column if not exists capture_intent text,
    add column if not exists tree_resolution_mode text,
    add column if not exists species_selection_mode text,
    add column if not exists style_selection_mode text,
    add column if not exists leaf_storage_path text,
    add column if not exists leaf_captured_at timestamptz,
    add column if not exists leaf_source text,
    add column if not exists winter_mode boolean not null default false,
    add column if not exists species_prediction_source text,
    add column if not exists leaf_reference_count integer,
    add column if not exists hosted_fallback_recommended boolean not null default false,
    add column if not exists fallback_reason text,
    add column if not exists embedding_model text;

alter table public.capture_submissions
    drop constraint if exists capture_submissions_capture_intent_check;
alter table public.capture_submissions
    add constraint capture_submissions_capture_intent_check
    check (capture_intent is null or capture_intent in ('existing-tree', 'new-tree'));

-- Photos gain their kind (front photos are the timeline; leaf close-ups and
-- studio renders are auxiliary) and the embedding model that produced their
-- identity embedding, so encoders can be upgraded without corrupting matching.
alter table public.photos
    add column if not exists kind text not null default 'front',
    add column if not exists embedding_model text;

alter table public.photos
    drop constraint if exists photos_kind_check;
alter table public.photos
    add constraint photos_kind_check
    check (kind in ('front', 'leaf', 'studio-render'));
