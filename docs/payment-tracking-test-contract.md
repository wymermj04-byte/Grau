# GRAU Payment Tracking — TEST Contract Bundle

REFERENCE MATERIAL ONLY. Do not run this Markdown file in Supabase.
Prepared 2026-10-19 from the TEST exports Melissa supplied in this conversation.
This bundle consolidates existing evidence; it is not approval to deploy to Live.
No database connection or database execution was performed to create this file.

## Instructions for the Draftbit agent

Read this entire file from the workspace, in chunks if necessary. Persist it as
`docs/payment-tracking-test-contract.md` so it survives loss of chat context.
Use it to assemble a faithful initial migration in `docs/payment-tracking-live-migration.sql`.
Do not redesign function bodies, combine triggers, change advisory-lock strings,
change SQLSTATE values, or substitute the previous reconstructed migration.

Sources and fidelity:
- Eight public functions below are decoded directly from the uploaded catalog CSV
  `Pasted text(20261018-233527).txt`; CSV escaping is decoded and line endings are normalized.
  A terminating statement semicolon is added after pg_get_functiondef output if absent.
- Ten helper definitions below are transcribed from the user's missing_migration_definitions
  TEST export, preserving their bodies; formatting/line endings are normalized.
- Reference table DDL is transcribed from the supplied TEST columns, identities,
  constraints and original table definitions, preserving names and semantics.
- Trigger DDL is the exported set, qualified with public for assembly clarity.
- RLS and ACL reproduction below is based on the supplied policy/security/privilege exports.
  It is expressed as SQL, not represented as an original pg_dump.
- This is NOT a new database export, and it has not been executed or compared by running PostgreSQL.

The prior Live draft was NOT the tested implementation. Its guard_lifecycle,
guard_snapshot, guard_month, and prevent_mutation functions are not TEST functions.
Do not carry those four substitutions or their new month_write/snapshot_write flags forward.

The corrected end_enrollment function is already included below: after truncating
the segment covering the departure month, it deletes later segments for that
account/student, retaining the frozen-snapshot guard and exact retry behavior.
The user reported the regression test passed, including identical retry and
preserved departure-month exemption. The broad rollback-contained TEST script
also passed before that focused fix. These tests do not certify all possible
concurrency, deployment, or UI behaviors.

Do not execute SQL, change credentials, create fixtures, or publish the app.
Prepare one transaction with dependency preflight checks and the seven tracking
tables only. Do not recreate or modify payments, students, gym_staff or gym_settings.
TEST has older billing-related columns/constraints on payments which are NOT
requirements to copy into Live. The tracking record_payment function uses only
student_id, gym_id, amount, payment_method, payment_status, payment_type and notes,
with an automatically generated payment id. Its student_id is NULL for a family payment.

Required existing dependencies to preflight in Live:
- public.payments: bigint IDENTITY id with unique/primary key; bigint gym_id and
  nullable bigint student_id; numeric amount; text payment_method, payment_status,
  payment_type, notes. Additional required columns without defaults or incompatible
  triggers/constraints must be reported rather than patched blindly.
- public.students: bigint "studentId", bigint gym_id, valid unique/primary key on
  ("studentId", gym_id). Preserve exact quoted spelling.
- public.gym_settings: bigint id unique/primary key, text time_zone. The report needs
  a valid nonblank timezone for the selected gym; Live gym 4 was previously confirmed
  America/New_York. This bundle does not freshly query Live.
- public.gym_staff: bigint gym_id, uuid user_id, text role, boolean is_active.
- auth.uid(), roles postgres, anon, authenticated and service_role.

Check that none of the seven tracking tables or any of the 18 exact function
signatures below already exists before the initial deployment; do not overwrite
unknown deployed objects. Create under owner postgres, as in TEST.

## Seven-table and six-trigger contract

The trigger statements at the end of this section must be emitted AFTER their
function definitions in the final migration. This section is reference ordering,
not execution ordering. Identity mode is ALWAYS for every tracking id.

```sql
-- Reference DDL transcribed from the supplied TEST column/identity/constraint inventories.
-- This is source material for assembling a migration, not a deployment script.
create table public.payment_tracking_accounts (
  id bigint generated always as identity primary key,
  gym_id bigint not null references public.gym_settings(id) on delete restrict,
  account_kind text not null check (account_kind in ('individual', 'family')),
  account_label text not null check (length(btrim(account_label)) > 0),
  effective_start_month date not null check (
    effective_start_month = date_trunc('month', effective_start_month)::date
    and effective_start_month >= date '2026-10-01'
  ),
  effective_end_month date check (
    effective_end_month = date_trunc('month', effective_end_month)::date
    and effective_end_month >= effective_start_month
  ),
  initial_member_ids bigint[] not null default '{}',
  initial_coverage_status text not null
    check (initial_coverage_status in ('active', 'exempt', 'inactive')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  idempotency_key uuid not null,
  constraint payment_tracking_accounts_scope_key unique (id, gym_id),
  constraint payment_tracking_accounts_retry_key unique (gym_id, created_by, idempotency_key)
);

create table public.payment_tracking_account_members (
  id bigint generated always as identity primary key,
  account_id bigint not null,
  gym_id bigint not null,
  student_id bigint not null,
  coverage_status text not null
    check (coverage_status in ('active', 'exempt', 'inactive')),
  effective_start_month date not null check (
    effective_start_month = date_trunc('month', effective_start_month)::date
    and effective_start_month >= date '2026-10-01'
  ),
  effective_end_month date check (
    effective_end_month = date_trunc('month', effective_end_month)::date
    and effective_end_month >= effective_start_month
  ),
  enrolled_by uuid not null,
  enrolled_at timestamptz not null default now(),
  constraint payment_tracking_account_members_account_fkey
    foreign key (account_id, gym_id)
    references public.payment_tracking_accounts(id, gym_id) on delete restrict,
  constraint payment_tracking_account_members_student_fkey
    foreign key (student_id, gym_id)
    references public.students("studentId", gym_id) on delete restrict,
  constraint payment_tracking_account_members_start_key
    unique (account_id, gym_id, student_id, effective_start_month)
);

create table public.payment_tracking_enrollment_requests (
  id bigint generated always as identity primary key,
  gym_id bigint not null references public.gym_settings(id) on delete restrict,
  operation text not null check (
    operation in ('enroll', 'end_enrollment', 'transfer', 'set_tracking_status')
  ),
  account_id bigint not null,
  related_account_id bigint,
  member_ids bigint[] not null check (cardinality(member_ids) > 0),
  coverage_status text check (
    coverage_status is null or coverage_status in ('active', 'exempt', 'inactive')
  ),
  effective_start_month date,
  effective_end_month date,
  reason text,
  payload jsonb not null,
  requested_by uuid not null,
  requested_at timestamptz not null default now(),
  idempotency_key uuid not null,
  constraint payment_tracking_enrollment_requests_account_fkey
    foreign key (account_id, gym_id)
    references public.payment_tracking_accounts(id, gym_id) on delete restrict,
  constraint payment_tracking_enrollment_requests_related_account_fkey
    foreign key (related_account_id, gym_id)
    references public.payment_tracking_accounts(id, gym_id) on delete restrict,
  constraint payment_tracking_enrollment_requests_retry_key
    unique (gym_id, requested_by, idempotency_key)
);

create table public.payment_tracking_months (
  id bigint generated always as identity primary key,
  account_id bigint not null,
  gym_id bigint not null,
  month_start date not null check (
    month_start = date_trunc('month', month_start)::date
    and month_start >= date '2026-10-01'
  ),
  manual_status text not null default 'no_payment_recorded'
    check (manual_status in ('no_payment_recorded', 'partial', 'paid')),
  status_changed_by uuid,
  status_changed_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint payment_tracking_months_account_fkey
    foreign key (account_id, gym_id)
    references public.payment_tracking_accounts(id, gym_id) on delete restrict,
  constraint payment_tracking_months_account_month_key
    unique (account_id, gym_id, month_start),
  constraint payment_tracking_months_scope_key
    unique (id, gym_id, account_id, month_start)
);

create table public.payment_tracking_month_members (
  id bigint generated always as identity primary key,
  account_month_id bigint not null,
  account_id bigint not null,
  gym_id bigint not null,
  student_id bigint not null,
  coverage_status text not null
    check (coverage_status in ('active', 'exempt', 'inactive')),
  month_start date not null,
  snapped_at timestamptz not null default now(),
  constraint payment_tracking_month_members_month_fkey
    foreign key (account_month_id, gym_id, account_id, month_start)
    references public.payment_tracking_months(id, gym_id, account_id, month_start)
    on delete restrict,
  constraint payment_tracking_month_members_student_fkey
    foreign key (student_id, gym_id)
    references public.students("studentId", gym_id) on delete restrict,
  constraint payment_tracking_month_members_account_student_key
    unique (account_month_id, student_id),
  constraint payment_tracking_month_members_member_month_key
    unique (gym_id, student_id, month_start)
);

create table public.payment_tracking_payment_links (
  id bigint generated always as identity primary key,
  payment_id bigint not null unique references public.payments(id) on delete restrict,
  account_month_id bigint not null,
  account_id bigint not null,
  gym_id bigint not null,
  month_start date not null,
  payer_label text not null check (length(btrim(payer_label)) > 0),
  received_on date not null,
  check_number text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  idempotency_key uuid not null,
  constraint payment_tracking_payment_links_month_fkey
    foreign key (account_month_id, gym_id, account_id, month_start)
    references public.payment_tracking_months(id, gym_id, account_id, month_start)
    on delete restrict,
  constraint payment_tracking_payment_links_retry_key
    unique (gym_id, created_by, idempotency_key)
);

create table public.payment_tracking_status_events (
  id bigint generated always as identity primary key,
  account_month_id bigint not null,
  account_id bigint not null,
  gym_id bigint not null,
  month_start date not null,
  prior_status text not null
    check (prior_status in ('no_payment_recorded', 'partial', 'paid')),
  new_status text not null
    check (new_status in ('no_payment_recorded', 'partial', 'paid')),
  event_kind text not null check (event_kind in ('set', 'correction')),
  reason text,
  changed_by uuid not null,
  changed_at timestamptz not null default now(),
  idempotency_key uuid not null,
  constraint payment_tracking_status_events_month_fkey
    foreign key (account_month_id, gym_id, account_id, month_start)
    references public.payment_tracking_months(id, gym_id, account_id, month_start)
    on delete restrict,
  constraint payment_tracking_status_events_retry_key
    unique (gym_id, changed_by, idempotency_key),
  constraint payment_tracking_status_events_reason_check check (
    event_kind = 'set' or length(btrim(coalesce(reason, ''))) > 0
  )
);

-- The latest TEST index export contains only the indexes backing the above
-- primary/unique constraints for these seven tables. Do not add the old draft's
-- extra lookup indexes under the claim that they came from this TEST export.

create trigger payment_tracking_members_guard
before delete or update on public.payment_tracking_account_members
for each row execute function public.payment_tracking_guard_member_mutation();

create trigger payment_tracking_members_overlap
before insert or update on public.payment_tracking_account_members
for each row execute function public.payment_tracking_prevent_overlap();

create trigger payment_tracking_requests_immutable
before delete or update on public.payment_tracking_enrollment_requests
for each row execute function public.payment_tracking_reject_mutation();

create trigger payment_tracking_snapshots_immutable
before delete or update on public.payment_tracking_month_members
for each row execute function public.payment_tracking_reject_mutation();

create trigger payment_tracking_links_immutable
before delete or update on public.payment_tracking_payment_links
for each row execute function public.payment_tracking_reject_mutation();

create trigger payment_tracking_status_events_immutable
before delete or update on public.payment_tracking_status_events
for each row execute function public.payment_tracking_reject_mutation();

```

## Ten installed helper/trigger function definitions

```sql
CREATE OR REPLACE FUNCTION public.payment_tracking_active_admin(p_gym_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from public.gym_staff staff
    where staff.gym_id = p_gym_id
      and staff.user_id = auth.uid()
      and staff.is_active = true
      and staff.role = 'admin'
  );
$function$;

CREATE OR REPLACE FUNCTION public.payment_tracking_active_staff(p_gym_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from public.gym_staff staff
    where staff.gym_id = p_gym_id
      and staff.user_id = auth.uid()
      and staff.is_active = true
      and staff.role in ('admin', 'coach')
  );
$function$;

CREATE OR REPLACE FUNCTION public.payment_tracking_ensure_month(p_account_id bigint, p_month_start date)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_account public.payment_tracking_accounts%rowtype;
  v_month_id bigint;
begin
  select * into v_account
  from public.payment_tracking_accounts account
  where account.id = p_account_id;

  if not found then
    raise exception 'Account not found.' using errcode = 'P0002';
  end if;

  perform public.payment_tracking_require_admin(v_account.gym_id);
  perform public.payment_tracking_validate_month(p_month_start);
  perform public.payment_tracking_lock_scope(v_account.gym_id, '{}'::bigint[], array[v_account.id]);

  select * into v_account
  from public.payment_tracking_accounts account
  where account.id = p_account_id
  for update;

  select month.id into v_month_id
  from public.payment_tracking_months month
  where month.account_id = v_account.id
    and month.gym_id = v_account.gym_id
    and month.month_start = p_month_start;

  if v_month_id is not null then
    return v_month_id;
  end if;

  insert into public.payment_tracking_months (
    account_id, gym_id, month_start, created_by
  )
  values (
    v_account.id, v_account.gym_id, p_month_start, auth.uid()
  )
  returning id into v_month_id;

  insert into public.payment_tracking_month_members (
    account_month_id, account_id, gym_id, student_id, coverage_status, month_start
  )
  select
    v_month_id,
    v_account.id,
    v_account.gym_id,
    member.student_id,
    member.coverage_status,
    p_month_start
  from public.payment_tracking_account_members member
  where member.account_id = v_account.id
    and member.effective_start_month <= p_month_start
    and (
      member.effective_end_month is null
      or member.effective_end_month >= p_month_start
    );

  if not exists (
    select 1
    from public.payment_tracking_month_members snapshot
    where snapshot.account_month_id = v_month_id
      and snapshot.coverage_status = 'active'
  ) then
    raise exception 'An active enrolled member is required.' using errcode = '23514';
  end if;

  return v_month_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.payment_tracking_guard_member_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if current_setting('payment_tracking.lifecycle_write', true)
    is distinct from 'on' then
    raise exception 'Coverage changes must use audited lifecycle RPCs.'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.payment_tracking_lock_retry(p_gym_id bigint, p_operation text, p_key uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if p_gym_id is null or p_operation is null or p_key is null then
    raise exception 'Gym, operation, and retry key are required.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      format('payment-tracking-retry:%s:%s:%s:%s', p_gym_id, auth.uid(), p_operation, p_key),
      0
    )
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.payment_tracking_lock_scope(p_gym_id bigint, p_member_ids bigint[], p_account_ids bigint[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_id bigint;
begin
  for v_id in
    select distinct value
    from unnest(coalesce(p_member_ids, '{}'::bigint[])) source(value)
    order by value
  loop
    perform pg_advisory_xact_lock(
      hashtextextended(format('payment-tracking-member:%s:%s', p_gym_id, v_id), 0)
    );
  end loop;

  for v_id in
    select distinct value
    from unnest(coalesce(p_account_ids, '{}'::bigint[])) source(value)
    order by value
  loop
    perform pg_advisory_xact_lock(
      hashtextextended(format('payment-tracking-account:%s', v_id), 0)
    );
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.payment_tracking_prevent_overlap()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_account public.payment_tracking_accounts%rowtype;
begin
  perform public.payment_tracking_lock_scope(
    new.gym_id, array[new.student_id], array[new.account_id]
  );

  select * into v_account
  from public.payment_tracking_accounts account
  where account.id = new.account_id and account.gym_id = new.gym_id;

  if not found
    or new.effective_start_month < v_account.effective_start_month
    or (
      v_account.effective_end_month is not null
      and (
        new.effective_end_month is null
        or new.effective_end_month > v_account.effective_end_month
      )
    ) then
    raise exception 'Coverage is outside the account period.' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.payment_tracking_account_members existing
    where existing.gym_id = new.gym_id
      and existing.student_id = new.student_id
      and existing.id <> coalesce(old.id, 0)
      and existing.effective_start_month <= coalesce(new.effective_end_month, 'infinity'::date)
      and new.effective_start_month <= coalesce(existing.effective_end_month, 'infinity'::date)
  ) then
    raise exception 'A member cannot have overlapping account coverage.'
      using errcode = '23505';
  end if;

  if v_account.account_kind = 'individual'
    and exists (
      select 1
      from public.payment_tracking_account_members existing
      where existing.account_id = new.account_id
        and existing.id <> coalesce(old.id, 0)
        and existing.effective_start_month <= coalesce(new.effective_end_month, 'infinity'::date)
        and new.effective_start_month <= coalesce(existing.effective_end_month, 'infinity'::date)
    ) then
    raise exception 'An individual account may cover one member only.'
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.payment_tracking_reject_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  raise exception '% is immutable.', tg_table_name using errcode = '55000';
end;
$function$;

CREATE OR REPLACE FUNCTION public.payment_tracking_require_admin(p_gym_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if p_gym_id is null
    or auth.uid() is null
    or not public.payment_tracking_active_admin(p_gym_id) then
    raise exception 'Only an active administrator for this gym may change payment tracking.'
      using errcode = '42501';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.payment_tracking_validate_month(p_month date)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
begin
  if p_month is null
    or p_month <> date_trunc('month', p_month)::date
    or p_month < date '2026-10-01' then
    raise exception 'Tracking months must start on or after 2026-10-01.'
      using errcode = '22007';
  end if;
end;
$function$;

```

## Eight installed public RPC definitions

### payment_tracking_create_account(bigint,text,text,date,date,bigint[],text,uuid)

Returns: `bigint`

Normalized exported definition SHA-256 (before appended semicolon): `adc045bd803749058e8db690aa5781092e5f7eeaf959f7e441560b0665cd6b71`

```sql
CREATE OR REPLACE FUNCTION public.payment_tracking_create_account(p_gym_id bigint, p_account_kind text, p_account_label text, p_effective_start_month date, p_effective_end_month date, p_member_ids bigint[], p_coverage_status text, p_idempotency_key uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_members bigint[];
  v_account_id bigint;
  v_prior_flag text;
begin
  if p_gym_id is null or p_account_kind is null or p_account_label is null
    or p_effective_start_month is null or p_member_ids is null
    or p_coverage_status is null or p_idempotency_key is null then
    raise exception 'Required account inputs and retry key must not be null.'
      using errcode = '22023';
  end if;

  perform public.payment_tracking_require_admin(p_gym_id);
  perform public.payment_tracking_lock_retry(p_gym_id, 'create_account', p_idempotency_key);
  perform public.payment_tracking_validate_month(p_effective_start_month);

  if p_effective_end_month is not null then
    perform public.payment_tracking_validate_month(p_effective_end_month);
  end if;

  select array_agg(id order by id) into v_members
  from (
    select distinct id from unnest(p_member_ids) source(id)
  ) normalized;

  if array_position(p_member_ids, null) is not null
    or cardinality(v_members) <> cardinality(p_member_ids)
    or nullif(btrim(p_account_label), '') is null
    or p_account_kind not in ('individual', 'family')
    or p_coverage_status not in ('active', 'exempt', 'inactive')
    or (p_account_kind = 'individual' and cardinality(v_members) > 1)
    or (
      p_effective_end_month is not null
      and p_effective_end_month < p_effective_start_month
    ) then
    raise exception 'Invalid account payload.' using errcode = '22023';
  end if;

  perform public.payment_tracking_lock_scope(p_gym_id, v_members, '{}'::bigint[]);

  select account.id into v_account_id
  from public.payment_tracking_accounts account
  where account.gym_id = p_gym_id
    and account.created_by = auth.uid()
    and account.idempotency_key = p_idempotency_key;

  if v_account_id is not null then
    if exists (
      select 1
      from public.payment_tracking_accounts account
      where account.id = v_account_id
        and account.account_kind = p_account_kind
        and account.account_label = btrim(p_account_label)
        and account.effective_start_month = p_effective_start_month
        and account.effective_end_month is not distinct from p_effective_end_month
        and account.initial_member_ids = coalesce(v_members, '{}'::bigint[])
        and account.initial_coverage_status = p_coverage_status
    ) then
      return v_account_id;
    end if;

    raise exception 'Account retry key was already used with different inputs.'
      using errcode = '23505';
  end if;

  if cardinality(v_members) > 0 and exists (
    select 1
    from unnest(v_members) requested(student_id)
    left join public.students student
      on student."studentId" = requested.student_id
      and student.gym_id = p_gym_id
    where student."studentId" is null
  ) then
    raise exception 'All covered members must belong to this gym.' using errcode = '23503';
  end if;

  insert into public.payment_tracking_accounts (
    gym_id, account_kind, account_label,
    effective_start_month, effective_end_month,
    initial_member_ids, initial_coverage_status,
    created_by, idempotency_key
  )
  values (
    p_gym_id, p_account_kind, btrim(p_account_label),
    p_effective_start_month, p_effective_end_month,
    coalesce(v_members, '{}'::bigint[]), p_coverage_status,
    auth.uid(), p_idempotency_key
  )
  returning id into v_account_id;

  if cardinality(v_members) > 0 then
    v_prior_flag := current_setting('payment_tracking.lifecycle_write', true);
    perform set_config('payment_tracking.lifecycle_write', 'on', true);

    insert into public.payment_tracking_account_members (
      account_id, gym_id, student_id, coverage_status,
      effective_start_month, effective_end_month, enrolled_by
    )
    select
      v_account_id, p_gym_id, requested.student_id, p_coverage_status,
      p_effective_start_month, p_effective_end_month, auth.uid()
    from unnest(v_members) requested(student_id);

    insert into public.payment_tracking_enrollment_requests (
      gym_id, operation, account_id, member_ids, coverage_status,
      effective_start_month, effective_end_month, payload,
      requested_by, idempotency_key
    )
    values (
      p_gym_id, 'enroll', v_account_id, v_members, p_coverage_status,
      p_effective_start_month, p_effective_end_month,
      jsonb_build_object('initial_account', true),
      auth.uid(), p_idempotency_key
    );

    perform set_config('payment_tracking.lifecycle_write', coalesce(v_prior_flag, ''), true);
  end if;

  return v_account_id;
end;
$function$;
```

### payment_tracking_end_enrollment(bigint,bigint,date,text,uuid)

Returns: `void`

Normalized exported definition SHA-256 (before appended semicolon): `535135dc3e56fa8ab3ec8d874dd162af21034b779edcd019ca8127eccfe71b7e`

```sql
CREATE OR REPLACE FUNCTION public.payment_tracking_end_enrollment(p_account_id bigint, p_student_id bigint, p_end_month date, p_reason text, p_idempotency_key uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_account public.payment_tracking_accounts%rowtype;
  v_member public.payment_tracking_account_members%rowtype;
  v_payload jsonb;
  v_prior_flag text;
begin
  if p_account_id is null
    or p_student_id is null
    or p_end_month is null
    or p_reason is null
    or p_idempotency_key is null
    or nullif(btrim(p_reason), '') is null then
    raise exception 'End-enrollment inputs, reason, and retry key are required.'
      using errcode = '22023';
  end if;

  select * into v_account
  from public.payment_tracking_accounts account
  where account.id = p_account_id;

  if not found then
    raise exception 'Account not found.'
      using errcode = 'P0002';
  end if;

  perform public.payment_tracking_require_admin(v_account.gym_id);

  perform public.payment_tracking_lock_retry(
    v_account.gym_id, 'end_enrollment', p_idempotency_key
  );

  perform public.payment_tracking_validate_month(p_end_month);

  perform public.payment_tracking_lock_scope(
    v_account.gym_id,
    array[p_student_id],
    array[v_account.id]
  );

  select * into v_account
  from public.payment_tracking_accounts account
  where account.id = p_account_id
  for update;

  v_payload := jsonb_build_object(
    'student_id', p_student_id,
    'end_month', p_end_month,
    'reason', btrim(p_reason)
  );

  if exists (
    select 1
    from public.payment_tracking_enrollment_requests request
    where request.gym_id = v_account.gym_id
      and request.requested_by = auth.uid()
      and request.idempotency_key = p_idempotency_key
      and request.operation = 'end_enrollment'
      and request.account_id = v_account.id
      and request.payload = v_payload
  ) then
    return;
  end if;

  if exists (
    select 1
    from public.payment_tracking_enrollment_requests request
    where request.gym_id = v_account.gym_id
      and request.requested_by = auth.uid()
      and request.idempotency_key = p_idempotency_key
  ) then
    raise exception 'End-enrollment retry key was used with different inputs.'
      using errcode = '23505';
  end if;

  select * into v_member
  from public.payment_tracking_account_members member
  where member.account_id = v_account.id
    and member.gym_id = v_account.gym_id
    and member.student_id = p_student_id
    and member.effective_start_month <= p_end_month
    and (
      member.effective_end_month is null
      or member.effective_end_month >= p_end_month
    )
  order by member.effective_start_month desc
  limit 1
  for update;

  if not found then
    raise exception 'Current enrollment not found.'
      using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.payment_tracking_month_members snapshot
    where snapshot.account_id = v_account.id
      and snapshot.gym_id = v_account.gym_id
      and snapshot.student_id = p_student_id
      and snapshot.month_start > p_end_month
  ) then
    raise exception 'Cannot end coverage after a later frozen month.'
      using errcode = '55000';
  end if;

  v_prior_flag := current_setting(
    'payment_tracking.lifecycle_write', true
  );

  perform set_config(
    'payment_tracking.lifecycle_write', 'on', true
  );

  update public.payment_tracking_account_members
  set effective_end_month = p_end_month
  where id = v_member.id;

  -- Remove scheduled coverage after the permanent departure.
  delete from public.payment_tracking_account_members member
  where member.account_id = v_account.id
    and member.gym_id = v_account.gym_id
    and member.student_id = p_student_id
    and member.effective_start_month > p_end_month;

  insert into public.payment_tracking_enrollment_requests (
    gym_id,
    operation,
    account_id,
    member_ids,
    effective_start_month,
    effective_end_month,
    reason,
    payload,
    requested_by,
    idempotency_key
  )
  values (
    v_account.gym_id,
    'end_enrollment',
    v_account.id,
    array[p_student_id],
    v_member.effective_start_month,
    p_end_month,
    btrim(p_reason),
    v_payload,
    auth.uid(),
    p_idempotency_key
  );

  perform set_config(
    'payment_tracking.lifecycle_write',
    coalesce(v_prior_flag, ''),
    true
  );
end;
$function$;
```

### payment_tracking_enroll_members(bigint,bigint[],text,date,date,uuid)

Returns: `void`

Normalized exported definition SHA-256 (before appended semicolon): `db6723e78511ffc4ee74ba977ce3404376821f980b7637c0c1603515b99d0a2b`

```sql
CREATE OR REPLACE FUNCTION public.payment_tracking_enroll_members(p_account_id bigint, p_member_ids bigint[], p_coverage_status text, p_effective_start_month date, p_effective_end_month date, p_idempotency_key uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_account public.payment_tracking_accounts%rowtype;
  v_members bigint[];
  v_payload jsonb;
  v_prior_flag text;
begin
  if p_account_id is null or p_member_ids is null or p_coverage_status is null
    or p_effective_start_month is null or p_idempotency_key is null then
    raise exception 'Required enrollment inputs and retry key must not be null.'
      using errcode = '22023';
  end if;

  select * into v_account
  from public.payment_tracking_accounts account
  where account.id = p_account_id;

  if not found then
    raise exception 'Account not found.' using errcode = 'P0002';
  end if;

  perform public.payment_tracking_require_admin(v_account.gym_id);
  perform public.payment_tracking_lock_retry(v_account.gym_id, 'enroll', p_idempotency_key);
  perform public.payment_tracking_validate_month(p_effective_start_month);

  if p_effective_end_month is not null then
    perform public.payment_tracking_validate_month(p_effective_end_month);
  end if;

  select array_agg(id order by id) into v_members
  from (
    select distinct id from unnest(p_member_ids) source(id)
  ) normalized;

  if cardinality(p_member_ids) = 0
    or array_position(p_member_ids, null) is not null
    or cardinality(v_members) <> cardinality(p_member_ids)
    or p_coverage_status not in ('active', 'exempt', 'inactive')
    or (
      p_effective_end_month is not null
      and p_effective_end_month < p_effective_start_month
    ) then
    raise exception 'Invalid enrollment payload.' using errcode = '22023';
  end if;

  perform public.payment_tracking_lock_scope(
    v_account.gym_id, v_members, array[v_account.id]
  );

  select * into v_account
  from public.payment_tracking_accounts account
  where account.id = p_account_id
  for update;

  if p_effective_start_month < v_account.effective_start_month
    or (
      v_account.effective_end_month is not null
      and (
        p_effective_end_month is null
        or p_effective_end_month > v_account.effective_end_month
      )
    ) then
    raise exception 'Enrollment must remain inside the account period.'
      using errcode = '23514';
  end if;

  v_payload := jsonb_build_object(
    'members', v_members,
    'status', p_coverage_status,
    'start', p_effective_start_month,
    'end', p_effective_end_month
  );

  if exists (
    select 1
    from public.payment_tracking_enrollment_requests request
    where request.gym_id = v_account.gym_id
      and request.requested_by = auth.uid()
      and request.idempotency_key = p_idempotency_key
      and request.operation = 'enroll'
      and request.account_id = v_account.id
      and request.payload = v_payload
  ) then
    return;
  end if;

  if exists (
    select 1
    from public.payment_tracking_enrollment_requests request
    where request.gym_id = v_account.gym_id
      and request.requested_by = auth.uid()
      and request.idempotency_key = p_idempotency_key
  ) then
    raise exception 'Enrollment retry key was already used with different inputs.'
      using errcode = '23505';
  end if;

  if exists (
    select 1
    from public.payment_tracking_months month
    where month.account_id = v_account.id
      and month.month_start >= p_effective_start_month
      and (
        p_effective_end_month is null
        or month.month_start <= p_effective_end_month
      )
  ) then
    raise exception 'Cannot add coverage affecting a frozen month.'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from unnest(v_members) requested(student_id)
    left join public.students student
      on student."studentId" = requested.student_id
      and student.gym_id = v_account.gym_id
    where student."studentId" is null
  ) then
    raise exception 'All covered members must belong to this gym.' using errcode = '23503';
  end if;

  v_prior_flag := current_setting('payment_tracking.lifecycle_write', true);
  perform set_config('payment_tracking.lifecycle_write', 'on', true);

  insert into public.payment_tracking_account_members (
    account_id, gym_id, student_id, coverage_status,
    effective_start_month, effective_end_month, enrolled_by
  )
  select
    v_account.id, v_account.gym_id, requested.student_id, p_coverage_status,
    p_effective_start_month, p_effective_end_month, auth.uid()
  from unnest(v_members) requested(student_id);

  insert into public.payment_tracking_enrollment_requests (
    gym_id, operation, account_id, member_ids, coverage_status,
    effective_start_month, effective_end_month, payload,
    requested_by, idempotency_key
  )
  values (
    v_account.gym_id, 'enroll', v_account.id, v_members, p_coverage_status,
    p_effective_start_month, p_effective_end_month, v_payload,
    auth.uid(), p_idempotency_key
  );

  perform set_config('payment_tracking.lifecycle_write', coalesce(v_prior_flag, ''), true);
end;
$function$;
```

### payment_tracking_monthly_report(bigint,date,timestamp with time zone)

Returns: `TABLE(account_id bigint, account_kind text, account_label text, coverage_status text, month_start date, covered_member_ids bigint[], manual_status text, timing_status text, display_status text, is_overdue boolean, recorded_payment_count bigint, recorded_payment_total numeric)`

Normalized exported definition SHA-256 (before appended semicolon): `829217cdff7468a662c0c76d35613d6110439299091ba65865db025b01fb0840`

```sql
CREATE OR REPLACE FUNCTION public.payment_tracking_monthly_report(p_gym_id bigint, p_month_start date, p_at timestamp with time zone DEFAULT now())
 RETURNS TABLE(account_id bigint, account_kind text, account_label text, coverage_status text, month_start date, covered_member_ids bigint[], manual_status text, timing_status text, display_status text, is_overdue boolean, recorded_payment_count bigint, recorded_payment_total numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_time_zone text;
  v_timing text;
begin
  if p_gym_id is null or p_month_start is null or p_at is null then
    raise exception 'Gym, month, and timestamp are required.' using errcode = '22023';
  end if;

  if not public.payment_tracking_active_staff(p_gym_id) then
    raise exception 'Active staff access is required.' using errcode = '42501';
  end if;

  perform public.payment_tracking_validate_month(p_month_start);

  select nullif(btrim(settings.time_zone), '')
  into v_time_zone
  from public.gym_settings settings
  where settings.id = p_gym_id;

  if v_time_zone is null then
    raise exception 'Gym timezone is required.' using errcode = '22023';
  end if;

  v_timing := case
    when (p_at at time zone v_time_zone)::date < p_month_start then 'upcoming'
    when (p_at at time zone v_time_zone)::date <= p_month_start + 4 then 'grace'
    else 'overdue'
  end;

  return query
  with existing_months as (
    select month.*
    from public.payment_tracking_months month
    where month.gym_id = p_gym_id
      and month.month_start = p_month_start
  ),
  coverage as (
    select
      snapshot.account_id,
      snapshot.student_id,
      snapshot.coverage_status,
      frozen_month.id as account_month_id,
      frozen_month.manual_status
    from existing_months frozen_month
    join public.payment_tracking_month_members snapshot
      on snapshot.account_month_id = frozen_month.id

    union all

    select
      member.account_id,
      member.student_id,
      member.coverage_status,
      null::bigint as account_month_id,
      'no_payment_recorded'::text as manual_status
    from public.payment_tracking_account_members member
    left join existing_months frozen_month
      on frozen_month.account_id = member.account_id
    where frozen_month.id is null
      and member.gym_id = p_gym_id
      and member.effective_start_month <= p_month_start
      and (
        member.effective_end_month is null
        or member.effective_end_month >= p_month_start
      )
  ),
  grouped as (
    select
      account.id as account_id,
      account.account_kind,
      account.account_label,
      case
        when bool_or(coverage.coverage_status = 'active') then 'active'
        when bool_or(coverage.coverage_status = 'exempt') then 'exempt'
        else 'inactive'
      end as coverage_status,
      max(coverage.account_month_id) as account_month_id,
      max(coverage.manual_status) as manual_status,
      array_agg(coverage.student_id order by coverage.student_id) as covered_member_ids
    from coverage
    join public.payment_tracking_accounts account
      on account.id = coverage.account_id
      and account.gym_id = p_gym_id
    group by account.id, account.account_kind, account.account_label
  ),
  totals as (
    select
      link.account_month_id,
      count(*)::bigint as payment_count,
      coalesce(sum(payment.amount), 0)::numeric as payment_total
    from public.payment_tracking_payment_links link
    join public.payments payment on payment.id = link.payment_id
    where link.gym_id = p_gym_id
    group by link.account_month_id
  )
  select
    grouped.account_id,
    grouped.account_kind,
    grouped.account_label,
    grouped.coverage_status,
    p_month_start,
    grouped.covered_member_ids,
    grouped.manual_status,
    v_timing,
    case
      when grouped.coverage_status = 'exempt' then 'exempt'
      when grouped.coverage_status = 'inactive' then 'inactive'
      when grouped.manual_status = 'paid' then 'paid'
      when grouped.manual_status = 'partial' and v_timing = 'overdue' then 'partial_overdue'
      when grouped.manual_status = 'partial' then 'partial'
      when v_timing = 'overdue' then 'no_payment_recorded_overdue'
      when v_timing = 'grace' then 'no_payment_recorded_grace'
      else 'no_payment_recorded_upcoming'
    end,
    (
      grouped.coverage_status = 'active'
      and grouped.manual_status <> 'paid'
      and v_timing = 'overdue'
    ),
    coalesce(totals.payment_count, 0),
    coalesce(totals.payment_total, 0)::numeric
  from grouped
  left join totals on totals.account_month_id = grouped.account_month_id
  order by grouped.account_label, grouped.account_id;
end;
$function$;
```

### payment_tracking_record_payment(bigint,date,numeric,text,text,text,text,date,text,uuid)

Returns: `TABLE(payment_id bigint, account_month_id bigint)`

Normalized exported definition SHA-256 (before appended semicolon): `7312f5d585acf804546c8653291bac320f86abb74dc07e3842bc4ba00098ef43`

```sql
CREATE OR REPLACE FUNCTION public.payment_tracking_record_payment(p_account_id bigint, p_month_start date, p_amount numeric, p_payment_method text, p_payment_type text, p_notes text, p_payer_label text, p_received_on date, p_check_number text, p_idempotency_key uuid)
 RETURNS TABLE(payment_id bigint, account_month_id bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_account public.payment_tracking_accounts%rowtype;
  v_payment_id bigint;
  v_month_id bigint;
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_check text := nullif(btrim(coalesce(p_check_number, '')), '');
begin
  if p_account_id is null or p_month_start is null or p_amount is null
    or p_payment_method is null or p_payment_type is null
    or p_payer_label is null or p_received_on is null
    or p_idempotency_key is null then
    raise exception 'Required payment inputs and retry key must not be null.'
      using errcode = '22023';
  end if;

  if p_amount <= 0
    or p_amount::text in ('NaN', 'Infinity', '-Infinity')
    or p_payment_method not in ('Cash', 'Check', 'Cash App')
    or nullif(btrim(p_payment_type), '') is null
    or nullif(btrim(p_payer_label), '') is null then
    raise exception 'Invalid payment payload.' using errcode = '22023';
  end if;

  select * into v_account
  from public.payment_tracking_accounts account
  where account.id = p_account_id;

  if not found then
    raise exception 'Account not found.' using errcode = 'P0002';
  end if;

  perform public.payment_tracking_require_admin(v_account.gym_id);
  perform public.payment_tracking_lock_retry(v_account.gym_id, 'record_payment', p_idempotency_key);
  perform public.payment_tracking_lock_scope(v_account.gym_id, '{}'::bigint[], array[v_account.id]);

  select * into v_account
  from public.payment_tracking_accounts account
  where account.id = p_account_id
  for update;

  select link.payment_id, link.account_month_id
  into v_payment_id, v_month_id
  from public.payment_tracking_payment_links link
  join public.payments payment on payment.id = link.payment_id
  where link.gym_id = v_account.gym_id
    and link.created_by = auth.uid()
    and link.idempotency_key = p_idempotency_key;

  if v_payment_id is not null then
    if exists (
      select 1
      from public.payment_tracking_payment_links link
      join public.payments payment on payment.id = link.payment_id
      where link.payment_id = v_payment_id
        and link.account_id = p_account_id
        and link.month_start = p_month_start
        and payment.amount = p_amount
        and payment.payment_method = p_payment_method
        and payment.payment_type = btrim(p_payment_type)
        and payment.notes is not distinct from v_notes
        and link.payer_label = btrim(p_payer_label)
        and link.received_on = p_received_on
        and link.check_number is not distinct from v_check
    ) then
      return query select v_payment_id, v_month_id;
      return;
    end if;

    raise exception 'Payment retry key was used with different inputs.'
      using errcode = '23505';
  end if;

  v_month_id := public.payment_tracking_ensure_month(v_account.id, p_month_start);

  insert into public.payments (
    student_id, gym_id, amount, payment_method,
    payment_status, payment_type, notes
  )
  values (
    null, v_account.gym_id, p_amount, p_payment_method,
    'paid', btrim(p_payment_type), v_notes
  )
  returning id into v_payment_id;

  insert into public.payment_tracking_payment_links (
    payment_id, account_month_id, account_id, gym_id, month_start,
    payer_label, received_on, check_number, created_by, idempotency_key
  )
  values (
    v_payment_id, v_month_id, v_account.id, v_account.gym_id, p_month_start,
    btrim(p_payer_label), p_received_on, v_check, auth.uid(), p_idempotency_key
  );

  return query select v_payment_id, v_month_id;
end;
$function$;
```

### payment_tracking_set_month_status(bigint,date,text,text,uuid)

Returns: `bigint`

Normalized exported definition SHA-256 (before appended semicolon): `17b0deb3235ba9e0eb5f355c6163c97ee62558f5cf371e39b1d190310f79526a`

```sql
CREATE OR REPLACE FUNCTION public.payment_tracking_set_month_status(p_account_id bigint, p_month_start date, p_new_status text, p_reason text, p_idempotency_key uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_account public.payment_tracking_accounts%rowtype;
  v_month public.payment_tracking_months%rowtype;
  v_kind text;
begin
  if p_account_id is null or p_month_start is null
    or p_new_status is null or p_idempotency_key is null then
    raise exception 'Required status inputs and retry key must not be null.'
      using errcode = '22023';
  end if;

  if p_new_status not in ('no_payment_recorded', 'partial', 'paid') then
    raise exception 'Monthly status is invalid.' using errcode = '22023';
  end if;

  select * into v_account
  from public.payment_tracking_accounts account
  where account.id = p_account_id;

  if not found then
    raise exception 'Account not found.' using errcode = 'P0002';
  end if;

  perform public.payment_tracking_require_admin(v_account.gym_id);
  perform public.payment_tracking_lock_retry(v_account.gym_id, 'set_month_status', p_idempotency_key);
  perform public.payment_tracking_lock_scope(v_account.gym_id, '{}'::bigint[], array[v_account.id]);

  select * into v_account
  from public.payment_tracking_accounts account
  where account.id = p_account_id
  for update;

  if exists (
    select 1
    from public.payment_tracking_status_events event
    where event.gym_id = v_account.gym_id
      and event.changed_by = auth.uid()
      and event.idempotency_key = p_idempotency_key
      and event.account_id = p_account_id
      and event.month_start = p_month_start
      and event.new_status = p_new_status
      and event.reason is not distinct from nullif(btrim(coalesce(p_reason, '')), '')
  ) then
    return (
      select event.account_month_id
      from public.payment_tracking_status_events event
      where event.gym_id = v_account.gym_id
        and event.changed_by = auth.uid()
        and event.idempotency_key = p_idempotency_key
    );
  end if;

  if exists (
    select 1
    from public.payment_tracking_status_events event
    where event.gym_id = v_account.gym_id
      and event.changed_by = auth.uid()
      and event.idempotency_key = p_idempotency_key
  ) then
    raise exception 'Status retry key was used with different inputs.'
      using errcode = '23505';
  end if;

  select * into v_month
  from public.payment_tracking_months month
  where month.id = public.payment_tracking_ensure_month(p_account_id, p_month_start)
  for update;

  v_kind := case
    when v_month.manual_status = 'no_payment_recorded'
      and p_new_status <> 'no_payment_recorded' then 'set'
    else 'correction'
  end;

  if v_kind = 'correction'
    and nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'A correction reason is required.' using errcode = '22023';
  end if;

  insert into public.payment_tracking_status_events (
    account_month_id, account_id, gym_id, month_start,
    prior_status, new_status, event_kind, reason,
    changed_by, idempotency_key
  )
  values (
    v_month.id, v_account.id, v_account.gym_id, v_month.month_start,
    v_month.manual_status, p_new_status, v_kind,
    nullif(btrim(coalesce(p_reason, '')), ''),
    auth.uid(), p_idempotency_key
  );

  update public.payment_tracking_months month
  set manual_status = p_new_status,
      status_changed_by = auth.uid(),
      status_changed_at = now()
  where month.id = v_month.id;

  return v_month.id;
end;
$function$;
```

### payment_tracking_set_tracking_status(bigint,text,date,date,text,uuid)

Returns: `void`

Normalized exported definition SHA-256 (before appended semicolon): `fa2ce3397aba4625fb2ba3118103551824a8eaeff8a32a6d55d3a514e9c741c7`

```sql
CREATE OR REPLACE FUNCTION public.payment_tracking_set_tracking_status(p_account_id bigint, p_new_status text, p_effective_start_month date, p_effective_end_month date, p_reason text, p_idempotency_key uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_account public.payment_tracking_accounts%rowtype;
  v_member public.payment_tracking_account_members%rowtype;
  v_members bigint[];
  v_payload jsonb;
  v_prior_flag text;
  v_changed_end date;
begin
  if p_account_id is null or p_new_status is null
    or p_effective_start_month is null or p_reason is null
    or p_idempotency_key is null or nullif(btrim(p_reason), '') is null then
    raise exception 'Tracking-status inputs, reason, and retry key are required.'
      using errcode = '22023';
  end if;

  if p_new_status not in ('active', 'exempt', 'inactive') then
    raise exception 'Tracking status is invalid.' using errcode = '22023';
  end if;

  select * into v_account
  from public.payment_tracking_accounts account
  where account.id = p_account_id;

  if not found then
    raise exception 'Account not found.' using errcode = 'P0002';
  end if;

  perform public.payment_tracking_require_admin(v_account.gym_id);
  perform public.payment_tracking_lock_retry(v_account.gym_id, 'set_tracking_status', p_idempotency_key);
  perform public.payment_tracking_validate_month(p_effective_start_month);

  if p_effective_end_month is not null then
    perform public.payment_tracking_validate_month(p_effective_end_month);
  end if;

  select array_agg(member.student_id order by member.student_id)
  into v_members
  from public.payment_tracking_account_members member
  where member.account_id = p_account_id
    and member.effective_start_month <= p_effective_start_month
    and (
      member.effective_end_month is null
      or member.effective_end_month >= p_effective_start_month
    );

  if v_members is null then
    raise exception 'No enrollment exists at the effective date.' using errcode = '23514';
  end if;

  perform public.payment_tracking_lock_scope(
    v_account.gym_id, v_members, array[v_account.id]
  );

  select * into v_account
  from public.payment_tracking_accounts account
  where account.id = p_account_id
  for update;

  if p_effective_start_month < v_account.effective_start_month
    or (
      v_account.effective_end_month is not null
      and (
        p_effective_end_month is null
        or p_effective_end_month > v_account.effective_end_month
      )
    ) then
    raise exception 'Status period must remain inside the account period.'
      using errcode = '23514';
  end if;

  if p_effective_end_month is not null
    and p_effective_end_month < p_effective_start_month then
    raise exception 'Status period end precedes its start.' using errcode = '22007';
  end if;

  v_payload := jsonb_build_object(
    'status', p_new_status,
    'start', p_effective_start_month,
    'end', p_effective_end_month,
    'reason', btrim(p_reason)
  );

  if exists (
    select 1
    from public.payment_tracking_enrollment_requests request
    where request.gym_id = v_account.gym_id
      and request.requested_by = auth.uid()
      and request.idempotency_key = p_idempotency_key
      and request.operation = 'set_tracking_status'
      and request.account_id = v_account.id
      and request.payload = v_payload
  ) then
    return;
  end if;

  if exists (
    select 1
    from public.payment_tracking_enrollment_requests request
    where request.gym_id = v_account.gym_id
      and request.requested_by = auth.uid()
      and request.idempotency_key = p_idempotency_key
  ) then
    raise exception 'Tracking-status retry key was used with different inputs.'
      using errcode = '23505';
  end if;

  if exists (
    select 1
    from public.payment_tracking_month_members snapshot
    where snapshot.account_id = v_account.id
      and snapshot.month_start >= p_effective_start_month
      and (
        p_effective_end_month is null
        or snapshot.month_start <= p_effective_end_month
      )
  ) then
    raise exception 'Cannot change a period with finalized monthly snapshots.'
      using errcode = '55000';
  end if;

  v_prior_flag := current_setting('payment_tracking.lifecycle_write', true);
  perform set_config('payment_tracking.lifecycle_write', 'on', true);

  for v_member in
    select *
    from public.payment_tracking_account_members member
    where member.account_id = v_account.id
      and member.effective_start_month <= p_effective_start_month
      and (
        member.effective_end_month is null
        or member.effective_end_month >= p_effective_start_month
      )
    order by member.student_id
    for update
  loop
    v_changed_end := coalesce(p_effective_end_month, v_member.effective_end_month);

    if v_changed_end is not null
      and v_member.effective_end_month is not null
      and v_changed_end > v_member.effective_end_month then
      raise exception 'Status period cannot extend beyond the enrolled period.'
        using errcode = '23514';
    end if;

    if p_effective_start_month = v_member.effective_start_month then
      update public.payment_tracking_account_members
      set coverage_status = p_new_status,
          effective_end_month = v_changed_end
      where id = v_member.id;
    else
      update public.payment_tracking_account_members
      set effective_end_month = p_effective_start_month - interval '1 month'
      where id = v_member.id;

      insert into public.payment_tracking_account_members (
        account_id, gym_id, student_id, coverage_status,
        effective_start_month, effective_end_month, enrolled_by
      )
      values (
        v_member.account_id, v_member.gym_id, v_member.student_id, p_new_status,
        p_effective_start_month, v_changed_end, auth.uid()
      );
    end if;

    if v_changed_end is not null
      and (
        v_member.effective_end_month is null
        or v_changed_end < v_member.effective_end_month
      ) then
      insert into public.payment_tracking_account_members (
        account_id, gym_id, student_id, coverage_status,
        effective_start_month, effective_end_month, enrolled_by
      )
      values (
        v_member.account_id, v_member.gym_id, v_member.student_id, v_member.coverage_status,
        v_changed_end + interval '1 month', v_member.effective_end_month, auth.uid()
      );
    end if;
  end loop;

  insert into public.payment_tracking_enrollment_requests (
    gym_id, operation, account_id, member_ids, coverage_status,
    effective_start_month, effective_end_month, reason, payload,
    requested_by, idempotency_key
  )
  values (
    v_account.gym_id, 'set_tracking_status', v_account.id, v_members, p_new_status,
    p_effective_start_month, p_effective_end_month, btrim(p_reason), v_payload,
    auth.uid(), p_idempotency_key
  );

  perform set_config('payment_tracking.lifecycle_write', coalesce(v_prior_flag, ''), true);
end;
$function$;
```

### payment_tracking_transfer_member(bigint,bigint,bigint,date,text,uuid)

Returns: `void`

Normalized exported definition SHA-256 (before appended semicolon): `f1e100a29bf22b833b704730d5686412f67a636976c940168c760be9a3e604e8`

```sql
CREATE OR REPLACE FUNCTION public.payment_tracking_transfer_member(p_from_account_id bigint, p_to_account_id bigint, p_student_id bigint, p_effective_start_month date, p_reason text, p_idempotency_key uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_from public.payment_tracking_accounts%rowtype;
  v_to public.payment_tracking_accounts%rowtype;
  v_source public.payment_tracking_account_members%rowtype;
  v_payload jsonb;
  v_prior_flag text;
begin
  if p_from_account_id is null or p_to_account_id is null
    or p_student_id is null or p_effective_start_month is null
    or p_reason is null or p_idempotency_key is null
    or nullif(btrim(p_reason), '') is null
    or p_from_account_id = p_to_account_id then
    raise exception 'Transfer inputs, reason, and retry key are required.'
      using errcode = '22023';
  end if;

  select * into v_from
  from public.payment_tracking_accounts account
  where account.id = p_from_account_id;

  select * into v_to
  from public.payment_tracking_accounts account
  where account.id = p_to_account_id;

  if v_from.id is null or v_to.id is null or v_from.gym_id <> v_to.gym_id then
    raise exception 'Transfer accounts must exist in the same gym.'
      using errcode = '23503';
  end if;

  perform public.payment_tracking_require_admin(v_from.gym_id);
  perform public.payment_tracking_lock_retry(v_from.gym_id, 'transfer', p_idempotency_key);
  perform public.payment_tracking_validate_month(p_effective_start_month);
  perform public.payment_tracking_lock_scope(
    v_from.gym_id, array[p_student_id], array[v_from.id, v_to.id]
  );

  perform 1
  from public.payment_tracking_accounts account
  where account.id in (p_from_account_id, p_to_account_id)
  order by account.id
  for update;

  select * into v_from from public.payment_tracking_accounts where id = p_from_account_id;
  select * into v_to from public.payment_tracking_accounts where id = p_to_account_id;

  v_payload := jsonb_build_object(
    'from_account_id', v_from.id,
    'to_account_id', v_to.id,
    'student_id', p_student_id,
    'start', p_effective_start_month,
    'reason', btrim(p_reason)
  );

  if exists (
    select 1
    from public.payment_tracking_enrollment_requests request
    where request.gym_id = v_from.gym_id
      and request.requested_by = auth.uid()
      and request.idempotency_key = p_idempotency_key
      and request.operation = 'transfer'
      and request.account_id = v_from.id
      and request.related_account_id = v_to.id
      and request.payload = v_payload
  ) then
    return;
  end if;

  if exists (
    select 1
    from public.payment_tracking_enrollment_requests request
    where request.gym_id = v_from.gym_id
      and request.requested_by = auth.uid()
      and request.idempotency_key = p_idempotency_key
  ) then
    raise exception 'Transfer retry key was used with different inputs.'
      using errcode = '23505';
  end if;

  if p_effective_start_month < v_to.effective_start_month
    or (
      v_to.effective_end_month is not null
      and p_effective_start_month > v_to.effective_end_month
    ) then
    raise exception 'Transfer date is outside the destination account period.'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.payment_tracking_months destination_month
    where destination_month.account_id = v_to.id
      and destination_month.month_start >= p_effective_start_month
  ) then
    raise exception 'Cannot transfer into a destination with a frozen affected month.'
      using errcode = '55000';
  end if;

  select * into v_source
  from public.payment_tracking_account_members member
  where member.account_id = v_from.id
    and member.student_id = p_student_id
    and member.coverage_status = 'active'
    and member.effective_start_month <= p_effective_start_month
    and (
      member.effective_end_month is null
      or member.effective_end_month >= p_effective_start_month
    )
  order by member.effective_start_month desc
  limit 1
  for update;

  if not found then
    raise exception 'Active source enrollment not found.' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.payment_tracking_month_members source_snapshot
    where source_snapshot.account_id = v_from.id
      and source_snapshot.student_id = p_student_id
      and source_snapshot.month_start >= p_effective_start_month
  ) then
    raise exception 'Cannot transfer after a frozen source month.'
      using errcode = '55000';
  end if;

  v_prior_flag := current_setting('payment_tracking.lifecycle_write', true);
  perform set_config('payment_tracking.lifecycle_write', 'on', true);

  if v_source.effective_start_month = p_effective_start_month then
    delete from public.payment_tracking_account_members
    where id = v_source.id;
  else
    update public.payment_tracking_account_members
    set effective_end_month = p_effective_start_month - interval '1 month'
    where id = v_source.id;
  end if;

  insert into public.payment_tracking_account_members (
    account_id, gym_id, student_id, coverage_status,
    effective_start_month, effective_end_month, enrolled_by
  )
  values (
    v_to.id, v_to.gym_id, p_student_id, 'active',
    p_effective_start_month, v_to.effective_end_month, auth.uid()
  );

  insert into public.payment_tracking_enrollment_requests (
    gym_id, operation, account_id, related_account_id, member_ids,
    coverage_status, effective_start_month, effective_end_month,
    reason, payload, requested_by, idempotency_key
  )
  values (
    v_from.gym_id, 'transfer', v_from.id, v_to.id, array[p_student_id],
    'active', p_effective_start_month, v_to.effective_end_month,
    btrim(p_reason), v_payload, auth.uid(), p_idempotency_key
  );

  perform set_config('payment_tracking.lifecycle_write', coalesce(v_prior_flag, ''), true);
end;
$function$;
```

## TEST security and access contract

All seven tables: owner postgres, RLS enabled, FORCE RLS false.
Six SELECT policies: PERMISSIVE, role authenticated, USING
`public.payment_tracking_active_staff(gym_id)`, no WITH CHECK expression.
Enrollment requests: no authenticated table grant and no read policy.
PUBLIC and anon: no table or function privileges for these objects.
Authenticated: SELECT on the six listed tables, EXECUTE on active_staff and eight
public RPCs only. No direct INSERT/UPDATE/DELETE/TRUNCATE or sequence access is
needed by the authenticated app; writes execute under the function owner.
Service_role has all table privileges and EXECUTE on all 18 functions in the export.
The original catalog contained MAINTAIN for postgres/service_role tables; do not
assume a particular PostgreSQL version based only on this privilege. GRANT ALL
below expresses the table privileges supported by the target server.

The following is SQL reproduction of those exported permissions. It touches only
tracking objects. Function ownership must be postgres before exposing SECURITY DEFINER RPCs.
Existing sequence default privileges should be reviewed; do not grant app users
new direct sequence privileges as a workaround for a broken RPC.

```sql
alter table public.payment_tracking_accounts owner to postgres;
alter table public.payment_tracking_accounts enable row level security;
alter table public.payment_tracking_accounts no force row level security;
revoke all privileges on table public.payment_tracking_accounts from public, anon, authenticated;
grant all privileges on table public.payment_tracking_accounts to service_role;
alter table public.payment_tracking_account_members owner to postgres;
alter table public.payment_tracking_account_members enable row level security;
alter table public.payment_tracking_account_members no force row level security;
revoke all privileges on table public.payment_tracking_account_members from public, anon, authenticated;
grant all privileges on table public.payment_tracking_account_members to service_role;
alter table public.payment_tracking_enrollment_requests owner to postgres;
alter table public.payment_tracking_enrollment_requests enable row level security;
alter table public.payment_tracking_enrollment_requests no force row level security;
revoke all privileges on table public.payment_tracking_enrollment_requests from public, anon, authenticated;
grant all privileges on table public.payment_tracking_enrollment_requests to service_role;
alter table public.payment_tracking_months owner to postgres;
alter table public.payment_tracking_months enable row level security;
alter table public.payment_tracking_months no force row level security;
revoke all privileges on table public.payment_tracking_months from public, anon, authenticated;
grant all privileges on table public.payment_tracking_months to service_role;
alter table public.payment_tracking_month_members owner to postgres;
alter table public.payment_tracking_month_members enable row level security;
alter table public.payment_tracking_month_members no force row level security;
revoke all privileges on table public.payment_tracking_month_members from public, anon, authenticated;
grant all privileges on table public.payment_tracking_month_members to service_role;
alter table public.payment_tracking_payment_links owner to postgres;
alter table public.payment_tracking_payment_links enable row level security;
alter table public.payment_tracking_payment_links no force row level security;
revoke all privileges on table public.payment_tracking_payment_links from public, anon, authenticated;
grant all privileges on table public.payment_tracking_payment_links to service_role;
alter table public.payment_tracking_status_events owner to postgres;
alter table public.payment_tracking_status_events enable row level security;
alter table public.payment_tracking_status_events no force row level security;
revoke all privileges on table public.payment_tracking_status_events from public, anon, authenticated;
grant all privileges on table public.payment_tracking_status_events to service_role;
grant select on public.payment_tracking_accounts to authenticated;
create policy payment_tracking_accounts_read
on public.payment_tracking_accounts as permissive for select to authenticated
using (public.payment_tracking_active_staff(gym_id));
grant select on public.payment_tracking_account_members to authenticated;
create policy payment_tracking_members_read
on public.payment_tracking_account_members as permissive for select to authenticated
using (public.payment_tracking_active_staff(gym_id));
grant select on public.payment_tracking_months to authenticated;
create policy payment_tracking_months_read
on public.payment_tracking_months as permissive for select to authenticated
using (public.payment_tracking_active_staff(gym_id));
grant select on public.payment_tracking_month_members to authenticated;
create policy payment_tracking_month_members_read
on public.payment_tracking_month_members as permissive for select to authenticated
using (public.payment_tracking_active_staff(gym_id));
grant select on public.payment_tracking_payment_links to authenticated;
create policy payment_tracking_payment_links_read
on public.payment_tracking_payment_links as permissive for select to authenticated
using (public.payment_tracking_active_staff(gym_id));
grant select on public.payment_tracking_status_events to authenticated;
create policy payment_tracking_status_events_read
on public.payment_tracking_status_events as permissive for select to authenticated
using (public.payment_tracking_active_staff(gym_id));
alter function public.payment_tracking_active_admin(bigint) owner to postgres;
revoke all on function public.payment_tracking_active_admin(bigint) from public, anon, authenticated;
grant execute on function public.payment_tracking_active_admin(bigint) to service_role;
alter function public.payment_tracking_active_staff(bigint) owner to postgres;
revoke all on function public.payment_tracking_active_staff(bigint) from public, anon, authenticated;
grant execute on function public.payment_tracking_active_staff(bigint) to service_role;
alter function public.payment_tracking_ensure_month(bigint,date) owner to postgres;
revoke all on function public.payment_tracking_ensure_month(bigint,date) from public, anon, authenticated;
grant execute on function public.payment_tracking_ensure_month(bigint,date) to service_role;
alter function public.payment_tracking_guard_member_mutation() owner to postgres;
revoke all on function public.payment_tracking_guard_member_mutation() from public, anon, authenticated;
grant execute on function public.payment_tracking_guard_member_mutation() to service_role;
alter function public.payment_tracking_lock_retry(bigint,text,uuid) owner to postgres;
revoke all on function public.payment_tracking_lock_retry(bigint,text,uuid) from public, anon, authenticated;
grant execute on function public.payment_tracking_lock_retry(bigint,text,uuid) to service_role;
alter function public.payment_tracking_lock_scope(bigint,bigint[],bigint[]) owner to postgres;
revoke all on function public.payment_tracking_lock_scope(bigint,bigint[],bigint[]) from public, anon, authenticated;
grant execute on function public.payment_tracking_lock_scope(bigint,bigint[],bigint[]) to service_role;
alter function public.payment_tracking_prevent_overlap() owner to postgres;
revoke all on function public.payment_tracking_prevent_overlap() from public, anon, authenticated;
grant execute on function public.payment_tracking_prevent_overlap() to service_role;
alter function public.payment_tracking_reject_mutation() owner to postgres;
revoke all on function public.payment_tracking_reject_mutation() from public, anon, authenticated;
grant execute on function public.payment_tracking_reject_mutation() to service_role;
alter function public.payment_tracking_require_admin(bigint) owner to postgres;
revoke all on function public.payment_tracking_require_admin(bigint) from public, anon, authenticated;
grant execute on function public.payment_tracking_require_admin(bigint) to service_role;
alter function public.payment_tracking_validate_month(date) owner to postgres;
revoke all on function public.payment_tracking_validate_month(date) from public, anon, authenticated;
grant execute on function public.payment_tracking_validate_month(date) to service_role;
alter function public.payment_tracking_create_account(bigint,text,text,date,date,bigint[],text,uuid) owner to postgres;
revoke all on function public.payment_tracking_create_account(bigint,text,text,date,date,bigint[],text,uuid) from public, anon, authenticated;
grant execute on function public.payment_tracking_create_account(bigint,text,text,date,date,bigint[],text,uuid) to service_role;
alter function public.payment_tracking_end_enrollment(bigint,bigint,date,text,uuid) owner to postgres;
revoke all on function public.payment_tracking_end_enrollment(bigint,bigint,date,text,uuid) from public, anon, authenticated;
grant execute on function public.payment_tracking_end_enrollment(bigint,bigint,date,text,uuid) to service_role;
alter function public.payment_tracking_enroll_members(bigint,bigint[],text,date,date,uuid) owner to postgres;
revoke all on function public.payment_tracking_enroll_members(bigint,bigint[],text,date,date,uuid) from public, anon, authenticated;
grant execute on function public.payment_tracking_enroll_members(bigint,bigint[],text,date,date,uuid) to service_role;
alter function public.payment_tracking_monthly_report(bigint,date,timestamp with time zone) owner to postgres;
revoke all on function public.payment_tracking_monthly_report(bigint,date,timestamp with time zone) from public, anon, authenticated;
grant execute on function public.payment_tracking_monthly_report(bigint,date,timestamp with time zone) to service_role;
alter function public.payment_tracking_record_payment(bigint,date,numeric,text,text,text,text,date,text,uuid) owner to postgres;
revoke all on function public.payment_tracking_record_payment(bigint,date,numeric,text,text,text,text,date,text,uuid) from public, anon, authenticated;
grant execute on function public.payment_tracking_record_payment(bigint,date,numeric,text,text,text,text,date,text,uuid) to service_role;
alter function public.payment_tracking_set_month_status(bigint,date,text,text,uuid) owner to postgres;
revoke all on function public.payment_tracking_set_month_status(bigint,date,text,text,uuid) from public, anon, authenticated;
grant execute on function public.payment_tracking_set_month_status(bigint,date,text,text,uuid) to service_role;
alter function public.payment_tracking_set_tracking_status(bigint,text,date,date,text,uuid) owner to postgres;
revoke all on function public.payment_tracking_set_tracking_status(bigint,text,date,date,text,uuid) from public, anon, authenticated;
grant execute on function public.payment_tracking_set_tracking_status(bigint,text,date,date,text,uuid) to service_role;
alter function public.payment_tracking_transfer_member(bigint,bigint,bigint,date,text,uuid) owner to postgres;
revoke all on function public.payment_tracking_transfer_member(bigint,bigint,bigint,date,text,uuid) from public, anon, authenticated;
grant execute on function public.payment_tracking_transfer_member(bigint,bigint,bigint,date,text,uuid) to service_role;
grant execute on function public.payment_tracking_active_staff(bigint) to authenticated;
grant execute on function public.payment_tracking_create_account(bigint,text,text,date,date,bigint[],text,uuid) to authenticated;
grant execute on function public.payment_tracking_end_enrollment(bigint,bigint,date,text,uuid) to authenticated;
grant execute on function public.payment_tracking_enroll_members(bigint,bigint[],text,date,date,uuid) to authenticated;
grant execute on function public.payment_tracking_monthly_report(bigint,date,timestamp with time zone) to authenticated;
grant execute on function public.payment_tracking_record_payment(bigint,date,numeric,text,text,text,text,date,text,uuid) to authenticated;
grant execute on function public.payment_tracking_set_month_status(bigint,date,text,text,uuid) to authenticated;
grant execute on function public.payment_tracking_set_tracking_status(bigint,text,date,date,text,uuid) to authenticated;
grant execute on function public.payment_tracking_transfer_member(bigint,bigint,bigint,date,text,uuid) to authenticated;
```

## Expected inventory checks for the assembled migration

- Seven tracking tables, all bigint GENERATED ALWAYS AS IDENTITY primary ids.
- 18 functions: eight public RPCs plus the ten helpers above.
- Six original triggers, all enabled, with exact exported trigger-function targets.
- Seven primary-key indexes plus 11 additional unique-constraint indexes:
  18 tracking indexes total.
  No standalone lookup index appears in the latest TEST tracking-index export.
- Account-member unique key: (account_id, gym_id, student_id, effective_start_month).
- Frozen student-month unique key: (gym_id, student_id, month_start).
- Month scope unique key and dependent FKs preserve order
  (id, gym_id, account_id, month_start).
- Snapshot/payment-link/status-event FKs include month_start.
- Correction reason CHECK and nonempty request member_ids CHECK are present.
- Six staff SELECT policies; no authenticated enrollment-request table policy/grant.
- Internal helper EXECUTE restricted; active_staff is the sole helper exposed to authenticated.
- No CREATE/ALTER/DROP against the four existing application tables.
- One BEGIN/COMMIT enclosing preflight, DDL, functions, triggers, policies and grants.
- No inserts of fixtures, accounts, payments, or backfills in the initial migration.

The counts and reference DDL should be checked against the catalog before describing
an assembled file as identical. Structural/function comparison and execution checks
are different; whitespace validation alone is not SQL validation.
