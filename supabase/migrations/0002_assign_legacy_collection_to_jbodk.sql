do $$
declare
    target_owner_id uuid;
begin
    select id
    into target_owner_id
    from auth.users
    where lower(email) = 'jbodk@hotmail.com'
    limit 1;

    if target_owner_id is null then
        raise exception 'Supabase user jbodk@hotmail.com does not exist.';
    end if;

    insert into public.species (id, slug, latin_name, common_name)
    overriding system value
    values
        (13, 'chamaecyparis-pisifera', 'Chamaecyparis pisifera', 'Sawara cypress'),
        (15, 'picea-jezoensis', 'Picea jezoensis', 'Ezo spruce')
    on conflict (id) do update
    set slug = excluded.slug,
        latin_name = excluded.latin_name,
        common_name = excluded.common_name;

    insert into public.bonsai_styles (id, slug, name)
    overriding system value
    values
        (3, 'moyogi', 'Informal upright (Moyogi)'),
        (9, 'sokan', 'Double trunk (Sokan)')
    on conflict (id) do update
    set slug = excluded.slug,
        name = excluded.name;

    perform setval('public.species_id_seq', greatest((select coalesce(max(id), 1) from public.species), 1), true);
    perform setval('public.bonsai_styles_id_seq', greatest((select coalesce(max(id), 1) from public.bonsai_styles), 1), true);

    insert into public.trees (
        id,
        owner_id,
        species_id,
        style_id,
        sequence_number,
        inventory_name,
        created_at,
        updated_at
    )
    values
        (
            'b1622536-aa3d-4b09-8e10-3436ce591bea',
            target_owner_id,
            15,
            3,
            1,
            'Ezo spruce - Informal upright (Moyogi)',
            '2026-06-02T07:18:35.194Z',
            '2026-06-02T07:18:35.194Z'
        ),
        (
            '05a5c85a-b6ce-4ca2-ac81-49cc5412206f',
            target_owner_id,
            13,
            9,
            1,
            'Sawara cypress - Double trunk (Sokan)',
            '2026-06-02T08:03:00.451Z',
            '2026-06-02T08:03:00.451Z'
        )
    on conflict (id) do update
    set owner_id = excluded.owner_id,
        species_id = excluded.species_id,
        style_id = excluded.style_id,
        sequence_number = excluded.sequence_number,
        inventory_name = excluded.inventory_name,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at;

    insert into public.capture_submissions (
        id,
        owner_id,
        storage_path,
        captured_at,
        source,
        status,
        finalized_tree_id,
        created_at,
        updated_at
    )
    values
        (
            '961fa0bf-d350-4205-beed-ea609b4d4376',
            target_owner_id,
            'captures/961fa0bf-d350-4205-beed-ea609b4d4376-front.jpg',
            '2026-06-02T07:18:35.194Z',
            'upload',
            'confirmed',
            'b1622536-aa3d-4b09-8e10-3436ce591bea',
            '2026-06-02T07:18:35.194Z',
            '2026-06-02T07:18:35.194Z'
        ),
        (
            'da47153f-ca5b-4ca9-b11d-e7a488690e4b',
            target_owner_id,
            'captures/da47153f-ca5b-4ca9-b11d-e7a488690e4b-front.jpg',
            '2026-06-02T08:03:00.451Z',
            'upload',
            'confirmed',
            '05a5c85a-b6ce-4ca2-ac81-49cc5412206f',
            '2026-06-02T08:03:00.451Z',
            '2026-06-02T08:03:00.451Z'
        )
    on conflict (id) do update
    set owner_id = excluded.owner_id,
        storage_path = excluded.storage_path,
        captured_at = excluded.captured_at,
        source = excluded.source,
        status = excluded.status,
        finalized_tree_id = excluded.finalized_tree_id,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at;

    insert into public.photos (
        id,
        tree_id,
        capture_submission_id,
        storage_path,
        captured_at,
        source,
        is_reference,
        created_at
    )
    values
        (
            '799fc84b-7ae5-4f08-8db4-f60bb3819b81',
            'b1622536-aa3d-4b09-8e10-3436ce591bea',
            '961fa0bf-d350-4205-beed-ea609b4d4376',
            'captures/961fa0bf-d350-4205-beed-ea609b4d4376-front.jpg',
            '2026-06-02T07:18:35.194Z',
            'upload',
            true,
            '2026-06-02T07:18:35.194Z'
        ),
        (
            'd19556d9-306a-40fd-8776-8fd68f422950',
            '05a5c85a-b6ce-4ca2-ac81-49cc5412206f',
            'da47153f-ca5b-4ca9-b11d-e7a488690e4b',
            'captures/da47153f-ca5b-4ca9-b11d-e7a488690e4b-front.jpg',
            '2026-06-02T08:03:00.451Z',
            'upload',
            true,
            '2026-06-02T08:03:00.451Z'
        )
    on conflict (id) do update
    set tree_id = excluded.tree_id,
        capture_submission_id = excluded.capture_submission_id,
        storage_path = excluded.storage_path,
        captured_at = excluded.captured_at,
        source = excluded.source,
        is_reference = excluded.is_reference,
        created_at = excluded.created_at;

    update public.capture_submissions
    set finalized_photo_id = case id
        when '961fa0bf-d350-4205-beed-ea609b4d4376' then '799fc84b-7ae5-4f08-8db4-f60bb3819b81'::uuid
        when 'da47153f-ca5b-4ca9-b11d-e7a488690e4b' then 'd19556d9-306a-40fd-8776-8fd68f422950'::uuid
        else finalized_photo_id
    end,
    updated_at = case id
        when '961fa0bf-d350-4205-beed-ea609b4d4376' then '2026-06-02T07:18:35.194Z'::timestamptz
        when 'da47153f-ca5b-4ca9-b11d-e7a488690e4b' then '2026-06-02T08:03:00.451Z'::timestamptz
        else updated_at
    end
    where id in (
        '961fa0bf-d350-4205-beed-ea609b4d4376',
        'da47153f-ca5b-4ca9-b11d-e7a488690e4b'
    );

    insert into public.tree_sequence_counters (owner_id, species_id, style_id, next_sequence)
    values
        (target_owner_id, 15, 3, 2),
        (target_owner_id, 13, 9, 2)
    on conflict (owner_id, species_id, style_id) do update
    set next_sequence = greatest(public.tree_sequence_counters.next_sequence, excluded.next_sequence);
end $$;