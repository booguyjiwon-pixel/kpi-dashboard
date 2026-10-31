export const formatWon = value => `${new Intl.NumberFormat('ko-KR').format(value)}원`;

export function validateRecord(record) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(record.month || '')) throw new Error('기준 월을 올바르게 선택해 주세요.');
  const team = String(record.team || '').trim();
  if (!team || team.length > 80) throw new Error('부서명은 1~80자로 입력해 주세요.');
  for (const [label, value] of [['목표', record.target], ['실적', record.actual]]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label}은(는) 0 이상의 안전한 정수로 입력해 주세요.`);
  }
  return { month: record.month, team, target: record.target, actual: record.actual };
}

export function summarize(records) {
  const target = records.reduce((sum, row) => sum + row.target, 0);
  const actual = records.reduce((sum, row) => sum + row.actual, 0);
  if (!Number.isSafeInteger(target) || !Number.isSafeInteger(actual)) throw new Error('합계가 안전한 정수 범위를 넘어 계산할 수 없습니다.');
  return { target, actual, count: records.length, rate: target === 0 ? null : actual / target * 100 };
}

export function rateLabel(target, actual) {
  if (target === 0) return '목표 미설정';
  const rate = actual / target * 100;
  return `${Number.isInteger(rate) ? rate : Number(rate.toFixed(2))}%`;
}
