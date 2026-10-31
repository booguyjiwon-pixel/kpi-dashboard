-- 기존 DB용 비파괴 마이그레이션 초안입니다. 실제 DB 구조를 확인하기 전에는 실행하지 마세요.
-- 기존 행을 삭제하거나 user_id를 임의로 채우지 않습니다.
-- 전제: public.kpi_records가 이미 있고 id/user_id/month/team/target/actual/created_at 컬럼이
-- 예상 자료형으로 존재하며, 기존 행들이 아래 검사를 통과해야 합니다.
-- 기존 RLS 정책이 하나라도 있으면 보안 동작이 불명확할 수 있어 이 초안은 중단합니다.
begin;

do $$
declare
  table_oid regclass := to_regclass('public.kpi_records');
  policy_count integer;
  has_source_id boolean;
  has_source_duplicates boolean;
  user_id_attnum smallint;
begin
  if table_oid is null then
    raise exception 'public.kpi_records가 없습니다. 새 DB에는 schema.sql을 검토하세요.';
  end if;

  if exists (
    select required.column_name
    from (values ('id'), ('user_id'), ('month'), ('team'), ('target'), ('actual'), ('created_at')) as required(column_name)
    where not exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = 'kpi_records'
        and c.column_name = required.column_name
    )
  ) then
    raise exception '필수 컬럼이 누락되었습니다. 자동 이관하지 말고 기존 스키마에 맞는 별도 마이그레이션을 설계하세요.';
  end if;

  if exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'kpi_records'
      and not (
        (c.column_name = 'id' and c.data_type = 'uuid') or
        (c.column_name = 'user_id' and c.data_type = 'uuid') or
        (c.column_name in ('month', 'team') and c.data_type = 'text') or
        (c.column_name in ('target', 'actual') and c.data_type = 'bigint') or
        (c.column_name = 'created_at' and c.data_type = 'timestamp with time zone')
      )
      and c.column_name in ('id', 'user_id', 'month', 'team', 'target', 'actual', 'created_at')
  ) then
    raise exception '필수 컬럼 자료형이 예상과 다릅니다. 기존 구조를 검토하세요.';
  end if;

  if exists (
    select 1 from public.kpi_records
    where id is null or user_id is null or month is null or team is null
       or target is null or actual is null or created_at is null
       or month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
       or length(btrim(team)) not between 1 and 80 or team <> btrim(team)
       or target not between 0 and 9007199254740991
       or actual not between 0 and 9007199254740991
  ) then
    raise exception '기존 행에 필수값 또는 범위 위반이 있습니다. 원본 행을 보존한 채 먼저 검토·정정하세요.';
  end if;

  if exists (
    select 1 from public.kpi_records
    group by user_id, month, team having count(*) > 1
  ) then
    raise exception '사용자·월·부서 중복 행이 있습니다. 자동 삭제하지 않습니다. 중복 처리 정책을 먼저 결정하세요.';
  end if;

  if exists (
    select 1 from public.kpi_records group by id having count(*) > 1
  ) then
    raise exception 'id 중복 행이 있습니다. 기본 키를 추가하지 않고 중단합니다.';
  end if;

  if exists (
    select 1 from pg_constraint
    where conrelid = table_oid and contype = 'p'
      and pg_get_constraintdef(oid) <> 'PRIMARY KEY (id)'
  ) then
    raise exception '기존 기본 키가 id가 아닙니다. 기본 키 구조를 수동 검토하세요.';
  end if;

  if exists (
    select 1 from public.kpi_records r
    left join auth.users u on u.id = r.user_id
    where u.id is null
  ) then
    raise exception 'auth.users와 연결되지 않은 user_id가 있습니다. 소유자 매핑을 확인하기 전에는 진행하지 않습니다.';
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'kpi_records' and column_name = 'source_id'
  ) into has_source_id;
  if has_source_id then
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'kpi_records'
        and column_name = 'source_id' and data_type <> 'text'
    ) then
      raise exception '기존 source_id 자료형이 text가 아닙니다. 수동 검토가 필요합니다.';
    end if;
    execute 'select exists (select 1 from public.kpi_records where source_id is not null group by user_id, source_id having count(*) > 1)'
      into has_source_duplicates;
    if has_source_duplicates then
      raise exception '사용자별 source_id 중복이 있습니다. 자동 삭제하지 않습니다.';
    end if;
  end if;

  select attnum::smallint into user_id_attnum
  from pg_attribute
  where attrelid = table_oid and attname = 'user_id' and not attisdropped;
  if exists (
    select 1 from pg_constraint
    where conrelid = table_oid and contype = 'f'
      and conkey = array[user_id_attnum]::smallint[]
      and confrelid <> 'auth.users'::regclass
  ) then
    raise exception '기존 user_id 외래 키 대상이 auth.users가 아닙니다. 수동 검토하세요.';
  end if;

  select count(*) into policy_count
  from pg_policies
  where schemaname = 'public' and tablename = 'kpi_records';
  if policy_count > 0 then
    raise exception '기존 RLS 정책이 있습니다. 정책 정의를 검토한 뒤 별도 변경안을 작성하세요.';
  end if;
end $$;

-- 원본 추적이 아직 없으면 선택 컬럼만 추가합니다. 기존 행의 값은 NULL로 보존됩니다.
alter table public.kpi_records add column if not exists source_id text;

-- 올바른 기본 키/외래 키가 없을 때만 보충합니다.
do $$
declare
  table_oid regclass := 'public.kpi_records'::regclass;
  user_id_attnum smallint;
begin
  if not exists (select 1 from pg_constraint where conrelid = table_oid and contype = 'p') then
    alter table public.kpi_records add constraint kpi_records_pkey primary key (id);
  end if;
  select attnum::smallint into user_id_attnum
  from pg_attribute
  where attrelid = table_oid and attname = 'user_id' and not attisdropped;
  if not exists (
    select 1 from pg_constraint
    where conrelid = table_oid and contype = 'f'
      and conkey = array[user_id_attnum]::smallint[]
      and confrelid = 'auth.users'::regclass
  ) then
    alter table public.kpi_records
      add constraint kpi_records_user_id_fkey foreign key (user_id) references auth.users(id);
  end if;
end $$;

alter table public.kpi_records
  alter column id set default gen_random_uuid(),
  alter column user_id set default auth.uid(),
  alter column created_at set default now(),
  alter column id set not null,
  alter column user_id set not null,
  alter column month set not null,
  alter column team set not null,
  alter column target set not null,
  alter column actual set not null,
  alter column created_at set not null,
  add constraint kpi_records_month_format_check
    check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  add constraint kpi_records_team_trimmed_check
    check (length(btrim(team)) between 1 and 80 and team = btrim(team)),
  add constraint kpi_records_target_safe_integer_check
    check (target between 0 and 9007199254740991),
  add constraint kpi_records_actual_safe_integer_check
    check (actual between 0 and 9007199254740991),
  add constraint kpi_records_user_month_team_key
    unique (user_id, month, team),
  add constraint kpi_records_user_source_id_key
    unique (user_id, source_id);

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
