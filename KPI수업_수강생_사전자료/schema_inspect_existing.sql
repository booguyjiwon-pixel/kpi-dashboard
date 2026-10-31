-- 읽기 전용 사전 점검용 SQL입니다. 데이터나 스키마를 변경하지 않습니다.
-- 1) 컬럼·자료형·기본값을 확인하고, 필수 컬럼이 있는지 확인합니다.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'kpi_records'
order by ordinal_position;

-- 2) 현재 제약조건을 확인합니다.
select conname, contype, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = to_regclass('public.kpi_records')
order by conname;

-- 3) RLS 활성화 상태와 기존 정책을 확인합니다.
select c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
from pg_class c
where c.oid = to_regclass('public.kpi_records');

select policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'kpi_records'
order by policyname;

-- 4) 위에서 month/team/target/actual/user_id 컬럼을 확인한 뒤 실행합니다.
-- 집계만 반환하며 업무 행의 값은 출력하지 않습니다.
select
  count(*) filter (where user_id is null) as missing_user_id,
  count(*) filter (where month is null or month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$') as invalid_month,
  count(*) filter (where team is null or length(btrim(team)) not between 1 and 80 or team <> btrim(team)) as invalid_team,
  count(*) filter (where target is null or target not between 0 and 9007199254740991) as invalid_target,
  count(*) filter (where actual is null or actual not between 0 and 9007199254740991) as invalid_actual
from public.kpi_records;

-- 5) 중복 그룹 수를 확인합니다. 실제 행의 상세 값은 출력하지 않습니다.
select count(*) as duplicate_user_month_team_groups
from (
  select user_id, month, team
  from public.kpi_records
  group by user_id, month, team
  having count(*) > 1
) duplicates;
