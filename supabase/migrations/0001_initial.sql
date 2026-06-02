create extension if not exists pgcrypto;
create extension if not exists vector;

create table if not exists public.species (
    id bigint generated always as identity primary key,
    slug text not null unique,
    latin_name text not null,
    common_name text,
    created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.bonsai_styles (
    id bigint generated always as identity primary key,
    slug text not null unique,
    name text not null,
    created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.tree_sequence_counters (
    owner_id uuid not null references auth.users (id) on delete cascade,
    species_id bigint not null references public.species (id) on delete cascade,
    style_id bigint not null references public.bonsai_styles (id) on delete cascade,
    next_sequence integer not null default 1 check (next_sequence > 0),
    primary key (owner_id, species_id, style_id)
);

create table if not exists public.trees (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users (id) on delete cascade,
    species_id bigint not null references public.species (id),
    style_id bigint not null references public.bonsai_styles (id),
    sequence_number integer not null check (sequence_number > 0),
    inventory_name text not null,
    acquired_on date,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    unique (owner_id, species_id, style_id, sequence_number),
    unique (owner_id, inventory_name)
);

create table if not exists public.capture_submissions (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users (id) on delete cascade,
    storage_path text not null,
    thumbnail_path text,
    captured_at timestamptz not null,
    source text not null check (source in ('camera', 'upload')),
    notes text,
    embedding vector(768),
    status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
    matched_tree_id uuid references public.trees (id) on delete set null,
    match_score double precision,
    candidate_matches jsonb not null default '[]'::jsonb,
    species_prediction jsonb,
    style_prediction jsonb,
    finalized_tree_id uuid references public.trees (id) on delete set null,
    finalized_photo_id uuid,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.photos (
    id uuid primary key default gen_random_uuid(),
    tree_id uuid not null references public.trees (id) on delete cascade,
    capture_submission_id uuid unique references public.capture_submissions (id) on delete set null,
    storage_path text not null,
    thumbnail_path text,
    captured_at timestamptz not null,
    source text not null check (source in ('camera', 'upload')),
    is_reference boolean not null default false,
    notes text,
    embedding vector(768),
    created_at timestamptz not null default timezone('utc', now())
);

alter table public.capture_submissions
    add constraint capture_submissions_finalized_photo_id_fkey
    foreign key (finalized_photo_id)
    references public.photos (id)
    on delete set null;

create table if not exists public.recognition_jobs (
    id uuid primary key default gen_random_uuid(),
    capture_submission_id uuid not null references public.capture_submissions (id) on delete cascade,
    status text not null check (status in ('pending', 'running', 'succeeded', 'failed')),
    matched_tree_id uuid references public.trees (id) on delete set null,
    match_score double precision,
    species_prediction jsonb,
    style_prediction jsonb,
    error_message text,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists photos_tree_id_captured_at_idx
    on public.photos (tree_id, captured_at desc);

create index if not exists capture_submissions_owner_status_idx
    on public.capture_submissions (owner_id, status, captured_at desc);

create index if not exists recognition_jobs_status_idx
    on public.recognition_jobs (status, created_at desc);

create index if not exists photos_embedding_idx
    on public.photos
    using ivfflat (embedding vector_cosine_ops)
    with (lists = 100);

create index if not exists capture_submissions_embedding_idx
    on public.capture_submissions
    using ivfflat (embedding vector_cosine_ops)
    with (lists = 100);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := timezone('utc', now());
    return new;
end;
$$;

create trigger touch_trees_updated_at
before update on public.trees
for each row
execute function public.touch_updated_at();

create trigger touch_capture_submissions_updated_at
before update on public.capture_submissions
for each row
execute function public.touch_updated_at();

create trigger touch_recognition_jobs_updated_at
before update on public.recognition_jobs
for each row
execute function public.touch_updated_at();

alter table public.species enable row level security;
alter table public.bonsai_styles enable row level security;
alter table public.tree_sequence_counters enable row level security;
alter table public.trees enable row level security;
alter table public.capture_submissions enable row level security;
alter table public.photos enable row level security;
alter table public.recognition_jobs enable row level security;

create policy "Authenticated users can read species catalog"
    on public.species
    for select
    to authenticated
    using (true);

create policy "Authenticated users can read bonsai styles catalog"
    on public.bonsai_styles
    for select
    to authenticated
    using (true);

create policy "Users can manage their own counters"
    on public.tree_sequence_counters
    for all
    to authenticated
    using (auth.uid() = owner_id)
    with check (auth.uid() = owner_id);

create policy "Users can manage their own trees"
    on public.trees
    for all
    to authenticated
    using (auth.uid() = owner_id)
    with check (auth.uid() = owner_id);

create policy "Users can manage their own capture submissions"
    on public.capture_submissions
    for all
    to authenticated
    using (auth.uid() = owner_id)
    with check (auth.uid() = owner_id);

create policy "Users can read their own photos"
    on public.photos
    for select
    to authenticated
    using (
        exists (
            select 1
            from public.trees
            where public.trees.id = photos.tree_id
                and public.trees.owner_id = auth.uid()
        )
    );

create policy "Users can insert photos for their own trees"
    on public.photos
    for insert
    to authenticated
    with check (
        exists (
            select 1
            from public.trees
            where public.trees.id = photos.tree_id
                and public.trees.owner_id = auth.uid()
        )
    );

create policy "Users can update their own photos"
    on public.photos
    for update
    to authenticated
    using (
        exists (
            select 1
            from public.trees
            where public.trees.id = photos.tree_id
                and public.trees.owner_id = auth.uid()
        )
    )
    with check (
        exists (
            select 1
            from public.trees
            where public.trees.id = photos.tree_id
                and public.trees.owner_id = auth.uid()
        )
    );

create policy "Users can delete their own photos"
    on public.photos
    for delete
    to authenticated
    using (
        exists (
            select 1
            from public.trees
            where public.trees.id = photos.tree_id
                and public.trees.owner_id = auth.uid()
        )
    );

create policy "Users can manage recognition jobs for their submissions"
    on public.recognition_jobs
    for all
    to authenticated
    using (
        exists (
            select 1
            from public.capture_submissions
            where public.capture_submissions.id = recognition_jobs.capture_submission_id
                and public.capture_submissions.owner_id = auth.uid()
        )
    )
    with check (
        exists (
            select 1
            from public.capture_submissions
            where public.capture_submissions.id = recognition_jobs.capture_submission_id
                and public.capture_submissions.owner_id = auth.uid()
        )
    );

insert into storage.buckets (id, name, public)
values ('bonsai-photos', 'bonsai-photos', false)
on conflict (id) do nothing;

create policy "Users can upload bonsai photos"
    on storage.objects
    for insert
    to authenticated
    with check (
        bucket_id = 'bonsai-photos'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

create policy "Users can read their bonsai photos"
    on storage.objects
    for select
    to authenticated
    using (
        bucket_id = 'bonsai-photos'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

create policy "Users can update their bonsai photos"
    on storage.objects
    for update
    to authenticated
    using (
        bucket_id = 'bonsai-photos'
        and (storage.foldername(name))[1] = auth.uid()::text
    )
    with check (
        bucket_id = 'bonsai-photos'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

create policy "Users can delete their bonsai photos"
    on storage.objects
    for delete
    to authenticated
    using (
        bucket_id = 'bonsai-photos'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

create or replace function public.finalize_capture_as_existing(
    p_capture_submission_id uuid,
    p_tree_id uuid
)
returns jsonb
language plpgsql
as $$
declare
    submission_record public.capture_submissions;
    tree_record public.trees;
    should_be_reference boolean;
    new_photo_id uuid;
begin
    select *
    into submission_record
    from public.capture_submissions
    where id = p_capture_submission_id
        and owner_id = auth.uid()
    for update;

    if submission_record.id is null then
        raise exception 'Capture submission not found.';
    end if;

    if submission_record.status <> 'pending' then
        raise exception 'Capture submission has already been finalized.';
    end if;

    select *
    into tree_record
    from public.trees
    where id = p_tree_id
        and owner_id = auth.uid();

    if tree_record.id is null then
        raise exception 'Target tree not found.';
    end if;

    select not exists (
        select 1
        from public.photos
        where tree_id = tree_record.id
    )
    into should_be_reference;

    insert into public.photos (
        tree_id,
        capture_submission_id,
        storage_path,
        thumbnail_path,
        captured_at,
        source,
        is_reference,
        notes,
        embedding
    ) values (
        tree_record.id,
        submission_record.id,
        submission_record.storage_path,
        submission_record.thumbnail_path,
        submission_record.captured_at,
        submission_record.source,
        should_be_reference,
        submission_record.notes,
        submission_record.embedding
    )
    returning id into new_photo_id;

    update public.capture_submissions
    set status = 'confirmed',
        finalized_tree_id = tree_record.id,
        finalized_photo_id = new_photo_id,
        updated_at = timezone('utc', now())
    where id = submission_record.id;

    return jsonb_build_object(
        'tree_id', tree_record.id,
        'photo_id', new_photo_id,
        'inventory_name', tree_record.inventory_name
    );
end;
$$;

create or replace function public.finalize_capture_as_new_tree(
    p_capture_submission_id uuid,
    p_species_id bigint,
    p_style_id bigint
)
returns jsonb
language plpgsql
as $$
declare
    submission_record public.capture_submissions;
    species_record public.species;
    style_record public.bonsai_styles;
    allocated_sequence integer;
    new_tree_id uuid;
    new_photo_id uuid;
    generated_inventory_name text;
begin
    select *
    into submission_record
    from public.capture_submissions
    where id = p_capture_submission_id
        and owner_id = auth.uid()
    for update;

    if submission_record.id is null then
        raise exception 'Capture submission not found.';
    end if;

    if submission_record.status <> 'pending' then
        raise exception 'Capture submission has already been finalized.';
    end if;

    select *
    into species_record
    from public.species
    where id = p_species_id;

    if species_record.id is null then
        raise exception 'Species not found.';
    end if;

    select *
    into style_record
    from public.bonsai_styles
    where id = p_style_id;

    if style_record.id is null then
        raise exception 'Bonsai style not found.';
    end if;

    with allocated_counter as (
        insert into public.tree_sequence_counters (
            owner_id,
            species_id,
            style_id,
            next_sequence
        ) values (
            auth.uid(),
            species_record.id,
            style_record.id,
            2
        )
        on conflict (owner_id, species_id, style_id)
        do update
            set next_sequence = public.tree_sequence_counters.next_sequence + 1
        returning next_sequence - 1 as sequence_number
    )
    select sequence_number
    into allocated_sequence
    from allocated_counter;

    generated_inventory_name := species_record.latin_name || ' / ' || style_record.name || ' / ' || lpad(allocated_sequence::text, 2, '0');

    insert into public.trees (
        owner_id,
        species_id,
        style_id,
        sequence_number,
        inventory_name
    ) values (
        auth.uid(),
        species_record.id,
        style_record.id,
        allocated_sequence,
        generated_inventory_name
    )
    returning id into new_tree_id;

    insert into public.photos (
        tree_id,
        capture_submission_id,
        storage_path,
        thumbnail_path,
        captured_at,
        source,
        is_reference,
        notes,
        embedding
    ) values (
        new_tree_id,
        submission_record.id,
        submission_record.storage_path,
        submission_record.thumbnail_path,
        submission_record.captured_at,
        submission_record.source,
        true,
        submission_record.notes,
        submission_record.embedding
    )
    returning id into new_photo_id;

    update public.capture_submissions
    set status = 'confirmed',
        finalized_tree_id = new_tree_id,
        finalized_photo_id = new_photo_id,
        updated_at = timezone('utc', now())
    where id = submission_record.id;

    return jsonb_build_object(
        'tree_id', new_tree_id,
        'photo_id', new_photo_id,
        'inventory_name', generated_inventory_name
    );
end;
$$;

grant execute on function public.finalize_capture_as_existing(uuid, uuid) to authenticated;
grant execute on function public.finalize_capture_as_new_tree(uuid, bigint, bigint) to authenticated;

insert into public.species (slug, latin_name, common_name)
values
    ('juniperus-procumbens', 'Juniperus procumbens', 'Japanese garden juniper'),
    ('ficus-retusa', 'Ficus retusa', 'Banyan fig'),
    ('acer-palmatum', 'Acer palmatum', 'Japanese maple'),
    ('pinus-thunbergii', 'Pinus thunbergii', 'Japanese black pine'),
    ('ulmus-parvifolia', 'Ulmus parvifolia', 'Chinese elm')
on conflict (slug) do nothing;

insert into public.bonsai_styles (slug, name)
values
    ('hokidachi', 'Broom (Hokidachi)'),
    ('chokkan', 'Formal upright (Chokkan)'),
    ('moyogi', 'Informal upright (Moyogi)'),
    ('shakan', 'Slanting (Shakan)'),
    ('kengai', 'Cascade (Kengai)'),
    ('han-kengai', 'Semi-cascade (Han-kengai)'),
    ('bunjingi', 'Literati (Bunjingi)'),
    ('fukinagashi', 'Windswept (Fukinagashi)'),
    ('sokan', 'Double trunk (Sokan)'),
    ('kabudachi', 'Multi-trunk (Kabudachi)'),
    ('yose-ue', 'Forest (Yose-ue)'),
    ('seki-joju', 'Growing on rock (Seki-joju)'),
    ('ishisuki', 'Growing in rock (Ishisuki)'),
    ('ikadabuki', 'Raft (Ikadabuki)'),
    ('sharimiki', 'Shari deadwood (Sharimiki)')
on conflict (slug) do nothing;
