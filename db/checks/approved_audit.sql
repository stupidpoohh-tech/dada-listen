-- approved_audit — 승인된 강사가 누구인지 관리자가 직접 확인한다
--
-- ⚠️ 왜 사람이 봐야 하나
--   0005 이전에는 **누구든 자기 approved 를 스스로 true 로 바꿀 수 있었다.**
--   그런데 승인을 누가·언제 했는지 남기는 기록이 없었다. 그래서 지금 승인된
--   계정 중 **관리자가 승인한 것과 스스로 승인한 것을 코드로는 구분할 수 없다.**
--   아래 목록을 관리자가 직접 보고, 승인한 기억이 없는 계정을 꺼야 한다.
--
--   끄는 방법:  select public.admin_set_teacher_approval('<강사 id>', false);
--
-- Neon SQL Editor 에 붙여넣고 실행한다.

select
  t.id                                   as "강사 id",
  t.name                                 as "이름",
  t.approved                             as "승인됨",
  to_char(t.created_at, 'YYYY-MM-DD HH24:MI') as "가입 시각",
  -- 스스로 승인한 계정인지 가리는 단서는 없다. 다만 활동량이 없는데 승인된
  -- 계정은 눈에 띄므로 함께 보여준다.
  (select count(*) from public.items  i where i.owner_id = t.id) as "음원 수",
  (select count(*) from public.classes c where c.owner_id = t.id) as "반 수",
  case
    when not t.approved then '—'
    when (select count(*) from public.items i where i.owner_id = t.id) = 0
      then '⚠️ 승인됐지만 음원이 없음 — 승인한 기억이 있는지 확인'
    else '확인 필요'
  end as "메모"
from public.teachers t
order by t.approved desc, t.created_at;

-- 요약
select
  count(*)                                  as "전체 강사",
  count(*) filter (where approved)          as "승인됨",
  count(*) filter (where not approved)      as "미승인"
from public.teachers;
