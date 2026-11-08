rollback;
begin;

do $test$
declare
  g bigint; g2 bigint; admin uuid; family uuid; other uuid;
  s bigint[]; cross_student bigint; visible bigint[]; expected bigint[];
  adult bigint; child1 bigint; child2 bigint; unlinked bigint; other_student bigint;
  adult_link bigint; child_link bigint; link public.member_account_links%rowtype;
  akey uuid := gen_random_uuid(); anoop uuid := gen_random_uuid(); arevoke uuid := gen_random_uuid();
  c1key uuid := gen_random_uuid(); c2key uuid := gen_random_uuid(); otherkey uuid := gen_random_uuid();
  crevoke uuid := gen_random_uuid(); cnoope uuid := gen_random_uuid(); creapprove uuid := gen_random_uuid();
  adminkey uuid := gen_random_uuid(); nonstaff uuid[]; definition text; n integer;
begin
  select staff.gym_id, staff.user_id into g, admin
  from public.gym_staff staff
  where staff.is_active and staff.role = 'admin'
    and (select count(*) from public.students where gym_id = staff.gym_id) >= 5
    and exists (select 1 from public.gym_settings x where x.id <> staff.gym_id and exists (select 1 from public.students where gym_id = x.id))
  order by staff.gym_id, staff.user_id limit 1;
  if not found then raise exception 'FAIL setup: staging needs an active admin gym with five members and a second gym with a member.'; end if;
  select id into g2 from public.gym_settings where id <> g and exists (select 1 from public.students where gym_id = id) order by id limit 1;
  select array_agg(id order by id) into nonstaff from (select id from auth.users u where not exists (select 1 from public.gym_staff gs where gs.user_id=u.id and gs.is_active) order by id limit 2) u;
  if coalesce(cardinality(nonstaff),0) < 2 then raise exception 'FAIL setup: staging needs two existing non-staff auth users; this script creates none.'; end if;
  family:=nonstaff[1]; other:=nonstaff[2];
  select array_agg("studentId" order by "studentId") into s from (select "studentId" from public.students where gym_id=g order by "studentId" limit 5) x;
  if coalesce(cardinality(s),0) < 5 then raise exception 'FAIL setup: selected admin gym needs five members.'; end if;
  adult:=s[1]; child1:=s[2]; child2:=s[3]; unlinked:=s[4]; other_student:=s[5];
  select "studentId" into cross_student from public.students where gym_id=g2 order by "studentId" limit 1;
  if not found then raise exception 'FAIL setup: second gym needs a member.'; end if;
  select pg_get_functiondef('public.my_linked_members()'::regprocedure) into definition;
  if definition ~* '(student_guardian_contacts|payment_tracking)' then raise exception 'FAIL: profile RPC depends on contact/payment data.'; end if;

  perform set_config('request.jwt.claim.sub',admin::text,true); execute 'set local role authenticated';
  perform set_config('member_access.lifecycle_write','preexisting-approval',true);
  select * into link from public.approve_member_account_link(g,adult,family,'self',akey); adult_link:=link.id;
  if current_setting('member_access.lifecycle_write',true) <> 'preexisting-approval' then raise exception 'FAIL: approval lifecycle setting not restored.'; end if;
  if (select count(*) from public.member_account_links where gym_id=g and student_id=adult and user_id=family)<>1 or (select count(*) from public.member_account_link_events where request_key=akey)<>1 then raise exception 'FAIL: first approval link/event.'; end if;
  begin update public.member_account_link_events set occurred_at=occurred_at where request_key=akey; raise exception 'FAIL: admin updated audit event.'; exception when insufficient_privilege then null; end;
  begin delete from public.member_account_link_events where request_key=akey; raise exception 'FAIL: admin deleted audit event.'; exception when insufficient_privilege then null; end;
  perform public.approve_member_account_link(g,adult,family,'self',akey);
  if (select count(*) from public.member_account_link_events where request_key=akey)<>1 then raise exception 'FAIL: approval retry duplicated event.'; end if;
  begin perform public.approve_member_account_link(g,adult,family,'parent_guardian',akey); raise exception 'FAIL: changed approval key accepted.'; exception when sqlstate '22023' then null; end;
  begin perform public.approve_member_account_link(g,adult,family,null,gen_random_uuid()); raise exception 'FAIL: NULL relationship accepted.'; exception when others then if sqlerrm not like '%valid relationship%' then raise; end if; end;
  perform set_config('member_access.lifecycle_write','',true);
  perform public.approve_member_account_link(g,child1,family,'parent_guardian',c1key);
  perform public.approve_member_account_link(g,child2,family,'parent_guardian',c2key);
  perform public.approve_member_account_link(g,other_student,other,'parent_guardian',otherkey);
  begin perform public.approve_member_account_link(g,cross_student,family,'parent_guardian',gen_random_uuid()); raise exception 'FAIL: cross-gym approval accepted.'; exception when others then if sqlerrm not like '%does not belong to this gym%' then raise; end if; end;

  execute 'reset role'; perform set_config('request.jwt.claim.sub',family::text,true); execute 'set local role authenticated';
  begin perform public.approve_member_account_link(g,unlinked,family,'self',gen_random_uuid()); raise exception 'FAIL: family self-approved.'; exception when insufficient_privilege then null; end;
  begin insert into public.member_account_links(gym_id,student_id,user_id,relationship,status,created_by,approved_by) values(g,unlinked,family,'self','approved',family,family); raise exception 'FAIL: family inserted link.'; exception when insufficient_privilege then null; end;
  select array_agg(student_id order by student_id) into visible from public.my_linked_members();
  expected:=array[adult,child1,child2]; if visible is distinct from expected then raise exception 'FAIL: family linked-member scope.'; end if;
  if (select count(*) from public.member_account_links)<>3 or (select count(*) from public.member_account_link_events)<>0 then raise exception 'FAIL: family links or audit visibility.'; end if;
  if (select count(*) from public.students where gym_id=g)<>0 then raise exception 'FAIL: family general students access.'; end if;
  if exists(select 1 from public.my_linked_members() where student_id in (unlinked,other_student)) then raise exception 'FAIL: family could read unlinked or other-family member.'; end if;

  execute 'reset role'; perform set_config('request.jwt.claim.sub',admin::text,true); execute 'set local role authenticated';
  select id into child_link from public.member_account_links where gym_id=g and student_id=child1 and user_id=family;
  perform set_config('member_access.lifecycle_write','preexisting-revocation',true);
  select * into link from public.revoke_member_account_link(child_link,crevoke);
  if current_setting('member_access.lifecycle_write',true)<>'preexisting-revocation' or link.status<>'revoked' or not exists(select 1 from public.member_account_link_events where link_id=child_link and request_key=crevoke) then raise exception 'FAIL: revocation/lifecycle audit.'; end if;
  execute 'reset role'; perform set_config('request.jwt.claim.sub',family::text,true); execute 'set local role authenticated';
  if exists(select 1 from public.my_linked_members() where student_id=child1) then raise exception 'FAIL: revoked family access remained.'; end if;

  execute 'reset role'; perform set_config('request.jwt.claim.sub',admin::text,true); execute 'set local role authenticated';
  perform public.revoke_member_account_link(child_link,cnoope);
  if not exists(select 1 from public.member_account_link_events where link_id=child_link and request_key=cnoope and action_applied=false) then raise exception 'FAIL: revoked no-op key not stored.'; end if;
  begin perform public.revoke_member_account_link(adult_link,cnoope); raise exception 'FAIL: changed no-op revoke key accepted.'; exception when sqlstate '22023' then null; end;
  select * into link from public.approve_member_account_link(g,child1,family,'parent_guardian',c1key);
  if link.status<>'revoked' or (select count(*) from public.member_account_link_events where link_id=child_link)<>3 then raise exception 'FAIL: old approval restored revoked link or changed history.'; end if;
  begin perform public.approve_member_account_link(g,child1,family,'self',gen_random_uuid()); raise exception 'FAIL: relationship mismatch accepted.'; exception when sqlstate '22023' then null; end;
  select * into link from public.approve_member_account_link(g,child1,family,'parent_guardian',creapprove);
  if link.status<>'approved' or link.revoked_by is not null or link.revoked_at is not null or (select count(*) from public.member_account_link_events where link_id=child_link)<>4 then raise exception 'FAIL: reapproval current state/history.'; end if;
  select * into link from public.revoke_member_account_link(child_link,cnoope);
  if link.status<>'approved' or (select count(*) from public.member_account_link_events where link_id=child_link)<>4 then raise exception 'FAIL: old no-op revoke changed later approval/history.'; end if;

  perform public.approve_member_account_link(g,adult,family,'self',anoop);
  if not exists(select 1 from public.member_account_link_events where link_id=adult_link and request_key=anoop and action_applied=false) then raise exception 'FAIL: approved no-op key not stored.'; end if;
  begin perform public.approve_member_account_link(g,adult,family,'parent_guardian',anoop); raise exception 'FAIL: changed no-op approval key accepted.'; exception when sqlstate '22023' then null; end;
  perform public.revoke_member_account_link(adult_link,arevoke);
  select * into link from public.approve_member_account_link(g,adult,family,'self',anoop);
  if link.status<>'revoked' or (select count(*) from public.member_account_link_events where link_id=adult_link)<>3 then raise exception 'FAIL: old no-op approval restored access/history.'; end if;
  perform public.approve_member_account_link(g,unlinked,admin,'self',adminkey);
  if not exists(select 1 from public.my_linked_members() where student_id=unlinked) then raise exception 'FAIL: admin lost family access.'; end if;
  select count(*) into n from public.students where gym_id=g;
  if n<5 then raise exception 'FAIL: admin lost staff access.'; end if;
  execute 'reset role';
end;
$test$;

rollback;
