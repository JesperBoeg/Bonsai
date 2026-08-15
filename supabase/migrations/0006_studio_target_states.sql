-- AI Design Studio: target states designed for a tree (analysis plan + optional
-- photoreal render), plus an atomic sequence allocator the app actually calls.

create table if not exists public.tree_target_states (
    id uuid primary key default gen_random_uuid(),
    tree_id uuid not null references public.trees(id) on delete cascade,
    owner_id uuid not null references auth.users(id) on delete cascade,
    mode text not null check (mode in ('auto', 'directed')),
    brief text,
    status text not null default 'pending'
        check (status in ('pending', 'analyzing', 'rendering', 'ready', 'failed')),
    plan jsonb,
    edit_instruction text,
    source_photo_id uuid references public.photos(id) on delete set null,
    image_path text,
    render_provider text,
    model_versions jsonb,
    is_active boolean not null default false,
    error_message text,
    created_at timestamptz not null default timezone('utc', now())
);

create index if not exists tree_target_states_tree_idx
    on public.tree_target_states (tree_id, created_at desc);

alter table public.tree_target_states enable row level security;

drop policy if exists "tree_target_states_owner_all" on public.tree_target_states;
create policy "tree_target_states_owner_all"
    on public.tree_target_states
    for all
    to authenticated
    using (auth.uid() = owner_id)
    with check (auth.uid() = owner_id);

-- Atomic per-owner sequence allocation for new trees. Replaces the racy
-- count(*) + 1 the app used before (which collided after deletions).
create or replace function public.allocate_tree_sequence(
    p_species_id bigint,
    p_style_id bigint
)
returns integer
language plpgsql
security invoker
as $$
declare
    allocated integer;
    highest_existing integer;
begin
    select coalesce(max(sequence_number), 0)
    into highest_existing
    from public.trees
    where owner_id = auth.uid()
        and species_id = p_species_id
        and style_id = p_style_id;

    insert into public.tree_sequence_counters (owner_id, species_id, style_id, next_sequence)
    values (auth.uid(), p_species_id, p_style_id, greatest(highest_existing, 1) + 1)
    on conflict (owner_id, species_id, style_id)
    do update
        set next_sequence = greatest(public.tree_sequence_counters.next_sequence, highest_existing + 1) + 1
    returning next_sequence - 1
    into allocated;

    return allocated;
end;
$$;

grant execute on function public.allocate_tree_sequence(bigint, bigint) to authenticated;
