import { formatWon, rateLabel, summarize, validateRecord } from './core.js';
import * as repository from './data/kpiRepository.js';

const $ = selector => document.querySelector(selector);
const monthFilter = $('#month-filter');
const teamFilter = $('#team-filter');
let records = [];
let loadFailed = false;
let loading = false;
let toastTimer;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function selectedRows() {
  return records.filter(row => (monthFilter.value === 'all' || row.month === monthFilter.value) && (teamFilter.value === 'all' || row.team === teamFilter.value));
}

function setupFilters() {
  const oldMonth = monthFilter.value || 'all';
  const oldTeam = teamFilter.value || 'all';
  const months = [...new Set(records.map(row => row.month))].sort().reverse();
  const teams = [...new Set(records.map(row => row.team))].sort((a, b) => a.localeCompare(b, 'ko'));
  monthFilter.innerHTML = '<option value="all">전체 기간</option>' + months.map(month => `<option value="${month}">${month.replace('-', '년 ')}월</option>`).join('');
  teamFilter.innerHTML = '<option value="all">전체 부서</option>' + teams.map(team => `<option value="${escapeHtml(team)}">${escapeHtml(team)}</option>`).join('');
  monthFilter.value = months.includes(oldMonth) ? oldMonth : 'all';
  teamFilter.value = teams.includes(oldTeam) ? oldTeam : 'all';
}

function renderChart(rows) {
  const chart = $('#chart');
  const teams = [...new Set(rows.map(row => row.team))].sort((a, b) => a.localeCompare(b, 'ko'));
  if (!teams.length) {
    chart.innerHTML = '<div class="chart-empty">표시할 부서 실적이 없습니다.</div>';
    return;
  }
  const values = teams.map(team => rows.filter(row => row.team === team).reduce((acc, row) => ({ target: acc.target + row.target, actual: acc.actual + row.actual }), { target: 0, actual: 0 }));
  const max = Math.max(1, ...values.flatMap(item => [item.target, item.actual]));
  chart.innerHTML = teams.map((team, index) => {
    const data = values[index];
    const targetWidth = Math.max(data.target ? 2 : 0, data.target / max * 100);
    const actualWidth = Math.max(data.actual ? 2 : 0, data.actual / max * 100);
    return `<div class="chart-row"><div class="chart-team">${escapeHtml(team)}</div><div class="bars"><div class="bar-track"><div class="bar target-bar" style="width:${targetWidth}%"></div></div><div class="bar-track"><div class="bar actual-bar" style="width:${actualWidth}%"></div></div></div><div class="chart-value">${rateLabel(data.target, data.actual)}</div></div>`;
  }).join('');
}

function render() {
  const rows = selectedRows();
  const totals = summarize(rows);
  $('#target-total').textContent = formatWon(totals.target);
  $('#actual-total').textContent = formatWon(totals.actual);
  $('#achievement').textContent = totals.target === 0 ? '—' : rateLabel(totals.target, totals.actual);
  $('#achievement-label').textContent = totals.target === 0 ? '목표 미설정' : '실적 ÷ 목표';
  $('#progress').style.width = `${Math.min(100, Math.max(0, totals.rate || 0))}%`;
  $('#progress-label').textContent = totals.count ? `${totals.count}건 기준` : '데이터 없음';
  $('#actual-change').textContent = totals.target === 0 ? '목표 미설정' : `${totals.actual >= totals.target ? '+' : ''}${rateLabel(totals.target, totals.actual)}`;
  $('#actual-change').classList.toggle('negative', totals.target > totals.actual);
  $('#chart-context').textContent = `${monthFilter.value === 'all' ? '전체 기간' : monthFilter.value} · ${teamFilter.value === 'all' ? '전체 부서' : teamFilter.value}`;
  renderChart(rows);

  const tbody = $('#evidence-rows');
  tbody.innerHTML = rows.slice().sort((a, b) => b.month.localeCompare(a.month) || a.team.localeCompare(b.team, 'ko')).map(row => {
    const rate = rateLabel(row.target, row.actual);
    const status = row.target === 0 ? '목표 미설정' : row.actual >= row.target ? '목표 달성' : '진행 중';
    const statusClass = row.target === 0 ? 'status-neutral' : row.actual >= row.target ? 'status-success' : 'status-progress';
    return `<tr><td><span class="month-chip">${row.month}</span></td><td class="team-cell"><span class="team-bullet"></span>${escapeHtml(row.team)}</td><td class="numeric">${formatWon(row.target)}</td><td class="numeric actual-cell">${formatWon(row.actual)}</td><td class="numeric"><b class="rate-cell">${rate}</b></td><td><span class="status ${statusClass}"><i></i>${status}</span></td></tr>`;
  }).join('');
  $('#result-count').textContent = `${rows.length}건`;
  $('#empty-state').hidden = rows.length !== 0 || loadFailed;
  $('#empty-title').textContent = records.length ? '조건에 맞는 데이터가 없어요' : '아직 등록된 데이터가 없어요';
  $('#empty-message').textContent = records.length ? '월과 부서 필터를 바꾸거나 데이터를 추가해 보세요.' : '첫 KPI 데이터를 입력하면 여기에서 성과를 확인할 수 있어요.';
  $('#error-state').hidden = !loadFailed;
  $('#evidence-rows').closest('.table-scroll').hidden = rows.length === 0 || loadFailed;
  $('#result-count').closest('.table-meta').hidden = loadFailed;
}

async function load() {
  if (loading) return;
  loading = true;
  $('#retry-load').disabled = true;
  try {
    records = await repository.read();
    loadFailed = false;
    setupFilters();
    render();
  } catch (error) {
    loadFailed = true;
    $('#error-message').textContent = error.message || '잠시 후 다시 시도해 주세요.';
    render();
  } finally {
    loading = false;
    $('#retry-load').disabled = false;
  }
}

function showToast(message, error = false) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.toggle('toast-error', error);
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 2800);
}

const dialog = $('#entry-dialog');
function openDialog() {
  $('#form-error').hidden = true;
  $('#entry-form').reset();
  $('#entry-month').value = monthFilter.value === 'all' ? '2026-10' : monthFilter.value;
  dialog.showModal();
}

$('#open-form').addEventListener('click', openDialog);
$('#open-form-secondary').addEventListener('click', openDialog);
$('#empty-add').addEventListener('click', openDialog);
$('#close-form').addEventListener('click', () => dialog.close());
$('#cancel-form').addEventListener('click', () => dialog.close());
monthFilter.addEventListener('change', render);
teamFilter.addEventListener('change', render);
$('#retry-load').addEventListener('click', load);
$('#entry-form').addEventListener('submit', async event => {
  event.preventDefault();
  const submit = $('#save-record');
  submit.disabled = true;
  submit.textContent = '저장 중…';
  const form = new FormData(event.currentTarget);
  try {
    const input = validateRecord({ month: form.get('month'), team: form.get('team'), target: Number(form.get('target')), actual: Number(form.get('actual')) });
    await repository.save(input);
    dialog.close();
    await load();
    showToast('KPI 데이터를 저장했어요.');
  } catch (error) {
    $('#form-error').textContent = error.message || '저장하지 못했습니다. 입력을 확인해 주세요.';
    $('#form-error').hidden = false;
  } finally {
    submit.disabled = false;
    submit.textContent = '저장하기';
  }
});

load();
