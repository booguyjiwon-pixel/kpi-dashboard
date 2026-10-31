-- KPI 저장 테이블 설계안입니다. 현재 DB에서 실행하지 마세요.
-- 새 교육용 Supabase 프로젝트에서 검토할 기본 구조입니다.
-- 기존 테이블/정책이 있는 DB에서는 그대로 실행하지 말고 별도 마이그레이션을 검토하세요.
begin;

create table public.kpi_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  source_id text,
  month text not null
    check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  team text not null
    check (length(btrim(team)) between 1 and 80 and team = btrim(team)),
  target bigint not null
    check (target between 0 and 9007199254740991),
  actual bigint not null
    check (actual between 0 and 9007199254740991),
  created_at timestamptz not null default now(),
  unique (user_id, month, team),
  unique (user_id, source_id)
);

alter table public.kpi_records enable row level security;
revoke all on public.kpi_records from public, anon;
grant select, insert, update, delete on public.kpi_records to authenticated;

create policy kpi_select_own on public.kpi_records
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy kpi_insert_own on public.kpi_records
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy kpi_update_own on public.kpi_records
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy kpi_delete_own on public.kpi_records
  for delete to authenticated
  using ((select auth.uid()) = user_id);

commit;
