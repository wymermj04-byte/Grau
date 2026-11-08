-- UNTESTED. STAGING ONLY. Do not run in production.
--
-- Committed setup outside this transaction:
--   * Deploy the waiver migration to an isolated staging database.
--   * Upload an actual non-empty PDF at gym/<gym_id>/waivers/staging-source.pdf.
--   * Upload an actual non-empty SVG at the generated signature_path below.
-- The transaction rolls back all database fixtures. A successful two-session
-- retry test commits one immutable submission and its uploaded SVG. Retain it
-- as staging audit evidence or reset the dedicated staging database afterward.

begin;

create temporary table waiver_test_context (
  gym_id bigint not null,
  second_gym_id bigint not null,
  student_id bigint not null,
  cross_gym_student_id bigint not null,
  staff_user_id uuid not null,
  test_text text not null,
  test_hash char(64) not null,
  test_version_id uuid,
  idempotency_key uuid not null,
  signature_path text not null
) on commit drop;

-- Select only a staff fixture with exactly one active authorized membership.
insert into waiver_test_context (
  gym_id, second_gym_id, student_id, cross_gym_student_id, staff_user_id,
  test_text, test_hash, idempotency_key, signature_path
)
with staff_fixture as (
  select staff.gym_id, staff.user_id
  from public.gym_staff staff
  where staff.is_active = true
    and staff.role in ('admin', 'coach')
    and 1 = (
      select count(*)
      from public.gym_staff membership
      where membership.user_id = staff.user_id
        and membership.is_active = true
        and membership.role in ('admin', 'coach')
    )
  order by staff.gym_id, staff.user_id
  limit 1
), own_student as (
  select s."studentId" as student_id
  from public.students s join staff_fixture sf on sf.gym_id = s.gym_id
  order by s."studentId" limit 1
), second_gym as (
  select gs.id as gym_id
  from public.gym_settings gs join staff_fixture sf on gs.id <> sf.gym_id
  order by gs.id limit 1
), cross_student as (
  select s."studentId" as student_id
  from public.students s join second_gym sg on s.gym_id = sg.gym_id
  order by s."studentId" limit 1
), fixture as (
  select sf.gym_id, sg.gym_id as second_gym_id, own.student_id,
    cross.student_id as cross_gym_student_id, sf.user_id,
    'Staging waiver exact text'::text as test_text, gen_random_uuid() as idempotency_key
  from staff_fixture sf cross join own_student own
  cross join second_gym sg cross join cross_student cross
)
select gym_id, second_gym_id, student_id, cross_gym_student_id, user_id,
  test_text,
  encode(extensions.digest(convert_to(test_text, 'UTF8'), 'sha256'), 'hex')::char(64),
  idempotency_key,
  format('gym/%s/members/%s/waivers/%s/signature.svg', gym_id, student_id, idempotency_key)
from fixture;

do $$
begin
  if not exists (select 1 from waiver_test_context) then
    raise exception 'FAIL setup: staging needs two gyms, a student in each, and a staff fixture with exactly one active admin/coach membership.';
  end if;
  raise notice 'PASS: disposable staging fixture context selected.';
end;
$$;

-- Disposable approved version. It is rolled back at the end; its referenced
-- source PDF is one of the committed staging prerequisites above.
with inserted as (
  insert into public.waiver_versions (
    gym_id, title, exact_text, content_sha256, source_document_path,
    approval_status, created_by, approved_by, approved_at
  )
  select gym_id, 'Staging test waiver', test_text, test_hash,
    format('gym/%s/waivers/staging-source.pdf', gym_id),
    'approved', staff_user_id, staff_user_id, now()
  from waiver_test_context
  returning id
)
update waiver_test_context
set test_version_id = (select id from inserted);

grant select on waiver_test_context to authenticated;

-- Simulate the fixture user, then test permissions as the authenticated role.
select set_config(
  'request.jwt.claim.sub',
  (select staff_user_id::text from waiver_test_context),
  true
);
set local role authenticated;

do $$
begin
  begin
    insert into public.waiver_versions (
      gym_id, title, exact_text, content_sha256, source_document_path, created_by
    )
    select gym_id, 'Denied', test_text, test_hash,
      format('gym/%s/waivers/denied.pdf', gym_id), staff_user_id
    from waiver_test_context;
    raise exception 'FAIL: authenticated direct waiver_versions INSERT was allowed.';
  exception when insufficient_privilege then
    raise notice 'PASS: authenticated direct waiver_versions INSERT denied.';
  end;

  begin
    insert into public.member_waiver_submissions (
      gym_id, student_id, waiver_version_id, participant_name, signer_name,
      signer_role, emergency_contact_name, emergency_contact_phone,
      signature_object_path, recorded_by, idempotency_key
    )
    select gym_id, student_id, test_version_id, 'Participant', 'Signer',
      'participant', 'Contact', '5550100', signature_path, staff_user_id,
      gen_random_uuid()
    from waiver_test_context;
    raise exception 'FAIL: authenticated direct member_waiver_submissions INSERT was allowed.';
  exception when insufficient_privilege then
    raise notice 'PASS: authenticated direct member_waiver_submissions INSERT denied.';
  end;
end;
$$;

reset role;

-- Trigger test under a privileged role; the trigger must still reject mutation.
do $$
begin
  begin
    update public.waiver_versions
    set exact_text = exact_text || ' altered'
    where id = (select test_version_id from waiver_test_context);
    raise exception 'FAIL: waiver version text was mutable.';
  exception when others then
    if sqlerrm not like '%Waiver version content and identity are immutable%' then raise; end if;
    raise notice 'PASS: waiver version content is immutable.';
  end;
end;
$$;

set local role authenticated;

-- Cross-gym rejection, missing-file rejection, and no waiver status mutation.
do $$
declare
  c waiver_test_context%rowtype;
  v_before boolean;
  v_after boolean;
  v_missing_key uuid := gen_random_uuid();
begin
  select * into c from waiver_test_context;
  select waiver_signed into v_before from public.students
  where "studentId" = c.student_id and gym_id = c.gym_id;

  begin
    perform public.finalize_member_waiver_submission(
      c.cross_gym_student_id, c.test_version_id, 'Participant', 'Signer',
      'participant', 'Contact', '5550100', c.signature_path, gen_random_uuid()
    );
    raise exception 'FAIL: cross-gym finalization was allowed.';
  exception when others then
    if sqlerrm not like '%does not belong to this gym%' then raise; end if;
    raise notice 'PASS: cross-gym finalization denied.';
  end;

  begin
    perform public.finalize_member_waiver_submission(
      c.student_id, c.test_version_id, 'Participant', 'Signer',
      'participant', 'Contact', '5550100',
      format('gym/%s/members/%s/waivers/%s/signature.svg', c.gym_id, c.student_id, v_missing_key),
      v_missing_key
    );
    raise exception 'FAIL: finalization without a signature file was allowed.';
  exception when others then
    if sqlerrm not like '%signature file is missing or invalid%' then raise; end if;
    raise notice 'PASS: missing signature file denied.';
  end;

  select waiver_signed into v_after from public.students
  where "studentId" = c.student_id and gym_id = c.gym_id;
  if v_after is distinct from v_before then
    raise exception 'FAIL: waiver_signed changed after failed finalization.';
  end if;
  raise notice 'PASS: waiver_signed unchanged after failed finalization.';
end;
$$;

-- Add a disposable second membership, then ensure finalization fails closed.
reset role;
insert into public.gym_staff (gym_id, user_id, role, is_active)
select second_gym_id, staff_user_id, 'coach', true
from waiver_test_context;
set local role authenticated;

do $$
declare c waiver_test_context%rowtype;
begin
  select * into c from waiver_test_context;
  begin
    perform public.finalize_member_waiver_submission(
      c.student_id, c.test_version_id, 'Participant', 'Signer',
      'participant', 'Contact', '5550100', c.signature_path, gen_random_uuid()
    );
    raise exception 'FAIL: multiple active memberships were allowed.';
  exception when others then
    if sqlerrm not like '%Exactly one active gym staff membership is required%' then raise; end if;
    raise notice 'PASS: multiple active memberships denied.';
  end;
end;
$$;

rollback;

-- CONCURRENT RETRY TEST — committed TEST-only records, separate from the
-- rollback test above. The source PDF must be uploaded first at:
--   gym/1/waivers/concurrency-test-source.pdf
-- The signature SVG must be uploaded before either concurrent session at:
--   gym/1/members/4/waivers/22222222-3333-4444-8555-666666666666/signature.svg
-- Use only TEST gym 1, TEST member 4, and TEST admin
-- bd8ccab2-c004-4d81-9967-71dc370c8ccd. The setup commits an approved test
-- version; finalization commits one immutable submission and sets member 4's
-- TEST waiver_signed value true. Reset the isolated TEST database afterward
-- if those records should be removed.
