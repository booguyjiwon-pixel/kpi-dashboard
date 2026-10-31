import { formatWon, rateLabel, summarize, validateRecord } from './core.js';
import * as repository from './data/kpiRepository.js';

const $ = selector => document.querySelector(selector);
const monthFilter = $('#month-filter');
const teamFilter = $('#team-filter');
let records = [];
let loadFailed = false;
let loading = false;
let toastTimer;
let activeUserId;
let loadSequence = 0;
let authEventSequence = 0;

const databaseMode = repository.isConfigured();

function setAuthMessage(message, isError = false) {
  const messageNode = $('#auth-message');
  messageNode.textContent = message;
  messageNode.hidden = !message;
  messageNode.classList.toggle('auth-message-error', isError);
}

function showLoginState(message = '') {
  $('#auth-panel').hidden = false;
  $('#dashboard-content').hidden = true;
  $('#open-form').hidden = true;
  $('#login-form').hidden = false;
  $('#auth-signed-in').hidden = true;
  $('#auth-title').textContent = '계정 로그인';
  $('#auth-description').textContent = '본인 계정으로 로그인하면 본인 KPI 데이터만 불러옵니다.';
  setAuthMessage(message, Boolean(message));
}

function clearPrivateDashboard() {
  records = [];
  loadFailed = false;
  loadSequence += 1;
  setupFilters();
  render();
}

function presentSignedInState() {
  $('#auth-panel').hidden = false;
  $('#login-form').hidden = true;
  $('#auth-signed-in').hidden = false;
  $('#auth-title').textContent = 'Supabase 계정 연결됨';
  $('#auth-description').textContent = '현재 로그인한 계정의 KPI 데이터만 조회·저장합니다.';
  $('#open-form').hidden = false;
  setAuthMessage('로그인 상태를 확인했습니다. 본인 데이터만 불러옵니다.');
}

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
  if (databaseMode && !activeUserId) return false;
  const requestId = ++loadSequence;
  const expectedUserId = activeUserId;
  loading = true;
  $('#retry-load').disabled = true;
  try {
    const nextRecords = await repository.read();
    if (requestId !== loadSequence || (databaseMode && expectedUserId !== activeUserId)) return false;
    records = nextRecords;
    loadFailed = false;
    setupFilters();
    render();
    return true;
  } catch (error) {
    if (requestId !== loadSequence || (databaseMode && expectedUserId !== activeUserId)) return false;
    records = [];
    loadFailed = true;
    $('#error-message').textContent = error.message || '잠시 후 다시 시도해 주세요.';
    render();
    return false;
  } finally {
    if (requestId === loadSequence) {
      loading = false;
      $('#retry-load').disabled = false;
    }
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
$('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#login-button');
  const email = $('#login-email').value.trim();
  const password = $('#login-password').value;
  button.disabled = true;
  button.textContent = '로그인 중…';
  setAuthMessage('Supabase 계정을 확인하고 있습니다.');
  try {
    const result = await repository.signIn(email, password);
    if (result.user) await applyAuthenticatedUser(result.user);
  } catch (error) {
    setAuthMessage(error.message || '로그인하지 못했습니다. 이메일과 비밀번호를 확인해 주세요.', true);
  } finally {
    $('#login-password').value = '';
    button.disabled = false;
    button.textContent = '로그인';
  }
});

$('#logout-button').addEventListener('click', async () => {
  const button = $('#logout-button');
  button.disabled = true;
  try {
    await repository.signOut();
    await applyAuthenticatedUser(null);
  } catch (error) {
    setAuthMessage(error.message || '로그아웃하지 못했습니다.', true);
  } finally {
    button.disabled = false;
  }
});

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
    const refreshed = await load();
    if (refreshed) {
      monthFilter.value = input.month;
      teamFilter.value = input.team;
      render();
      showToast(databaseMode ? 'KPI 데이터를 DB에 저장하고 다시 불러왔어요.' : 'KPI 데이터를 샘플 세션에 저장했어요.');
    }
    else showToast('저장 응답은 받았지만 목록 재조회에 실패했습니다. 다시 조회해 확인해 주세요.', true);
  } catch (error) {
    $('#form-error').textContent = error.message || '저장하지 못했습니다. 입력을 확인해 주세요.';
    $('#form-error').hidden = false;
  } finally {
    submit.disabled = false;
    submit.textContent = '저장하기';
  }
});

async function applyAuthenticatedUser(user) {
  const nextUserId = user?.id || null;
  if (nextUserId === activeUserId) return;
  activeUserId = nextUserId;
  clearPrivateDashboard();
  if (!nextUserId) {
    showLoginState();
    return;
  }
  presentSignedInState();
  $('#dashboard-content').hidden = false;
  await load();
}

async function initializeDataMode() {
  document.body.classList.toggle('database-mode', databaseMode);
  if (!databaseMode) {
    $('#mode-label').textContent = '샘플 모드';
    $('#auth-panel').hidden = true;
    $('#dashboard-content').hidden = false;
    $('#open-form').hidden = false;
    $('#sample-notice').hidden = false;
    await load();
    return;
  }

  $('#mode-label').textContent = 'DB 모드';
  $('#footer-mode').textContent = 'Supabase 본인 데이터';
  $('#footer-note').textContent = '로그인 세션은 브라우저에 유지되며 KPI 행은 Supabase에 저장됩니다.';
  $('#sample-notice').hidden = true;
  $('#dashboard-content').hidden = true;
  $('#open-form').hidden = true;
  showLoginState();
  setAuthMessage('Supabase 로그인 상태를 확인하고 있습니다.');
  $('#login-form').hidden = true;

  const initError = repository.getInitializationError();
  if (initError) {
    $('#auth-title').textContent = 'Supabase 연결 설정 오류';
    setAuthMessage(initError.message, true);
    return;
  }

  try {
    repository.onAuthStateChange(session => {
      const eventSequence = ++authEventSequence;
      queueMicrotask(() => {
        const resolveUser = session ? repository.getCurrentUser() : Promise.resolve(null);
        resolveUser.then(user => {
          if (eventSequence !== authEventSequence) return;
          return applyAuthenticatedUser(user);
        }).catch(error => {
          if (eventSequence !== authEventSequence) return;
          activeUserId = null;
          clearPrivateDashboard();
          showLoginState(error.message || '로그인 상태를 확인하지 못했습니다. 다시 로그인해 주세요.');
        });
      });
    });
    const snapshotSequence = authEventSequence;
    const session = await repository.getSession();
    const user = session ? await repository.getCurrentUser() : null;
    if (snapshotSequence !== authEventSequence) return;
    if (user) await applyAuthenticatedUser(user);
    else {
      activeUserId = null;
      showLoginState();
    }
  } catch (error) {
    // A newer auth event supersedes a stale session snapshot or its network error.
    if (authEventSequence > 0 && activeUserId !== undefined) return;
    activeUserId = null;
    clearPrivateDashboard();
    showLoginState(error.message || 'Supabase에 연결하지 못했습니다. 설정과 인터넷 연결을 확인해 주세요.');
  }
}

initializeDataMode();
