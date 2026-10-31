import { validateRecord } from '../core.js';

// 샘플 모드는 브라우저 탭 메모리에서만 동작합니다. 새로고침하면 초기 샘플로 돌아갑니다.
const seed = [
  { id: 'sample-2026-09-a', month: '2026-09', team: '영업A', target: 10000000, actual: 9000000 },
  { id: 'sample-2026-09-b', month: '2026-09', team: '영업B', target: 8000000, actual: 8800000 },
  { id: 'sample-2026-09-c', month: '2026-09', team: '영업C', target: 12000000, actual: 10800000 },
  { id: 'sample-2026-10-a', month: '2026-10', team: '영업A', target: 10000000, actual: 11000000 },
  { id: 'sample-2026-10-b', month: '2026-10', team: '영업B', target: 8000000, actual: 7200000 },
  { id: 'sample-2026-10-c', month: '2026-10', team: '영업C', target: 12000000, actual: 12600000 }
];
let rows = seed.map(row => ({ ...row }));

export async function read() {
  return rows.map(row => ({ ...row }));
}

export async function save(input) {
  const valid = validateRecord(input);
  if (rows.some(row => row.month === valid.month && row.team === valid.team)) {
    throw new Error('같은 월·부서 데이터가 이미 있어요. 기존 근거표를 확인해 주세요.');
  }
  const row = { id: `session-${Date.now()}`, ...valid };
  rows = [...rows, row];
  return { ...row };
}
