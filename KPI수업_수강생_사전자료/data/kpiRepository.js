import { validateRecord } from '../core.js';
import * as sampleRepository from './sampleRepository.js';

const config = window.KPI_CONFIG || {};
const projectUrl = typeof config.supabaseUrl === 'string' ? config.supabaseUrl.trim() : '';
const publishableKey = typeof config.supabasePublishableKey === 'string' ? config.supabasePublishableKey.trim() : '';
const isPlaceholder = value => !value || /^YOUR_/i.test(value);

function isPublishableKey(value) {
  if (value.startsWith('sb_publishable_')) return true;
  // 이전 anon JWT 키 형식은 payload.role=anon인 경우만 공개 키로 취급합니다.
  const parts = value.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.role === 'anon';
  } catch {
    return false;
  }
}

let configured = !isPlaceholder(projectUrl) && !isPlaceholder(publishableKey);
let client = null;
let initError = null;

if (configured) {
  try {
    const parsedUrl = new URL(projectUrl);
    if (parsedUrl.protocol !== 'https:') throw new Error('Supabase Project URL은 HTTPS 주소여야 합니다.');
    if (!isPublishableKey(publishableKey)) throw new Error('config.js에는 Supabase publishable key를 넣어 주세요. secret/service_role 키는 사용할 수 없습니다.');
    if (window.KPI_CONFIG_LOAD_ERROR) throw new Error('config.js를 읽지 못했습니다. 파일 경로와 이름을 확인해 주세요.');
    if (window.KPI_SUPABASE_LOAD_ERROR || !window.supabase?.createClient) throw new Error('vendor/supabase.js를 불러오지 못했습니다. 파일 경로와 이름을 확인해 주세요.');
    client = window.supabase.createClient(projectUrl, publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
  } catch (error) {
    initError = error;
  }
}

const selectedFields = 'id,month,team,target,actual';

function requireClient() {
  if (initError) throw initError;
  if (!client) throw new Error('Supabase 설정이 없어 샘플 모드로 실행 중입니다.');
  return client;
}

async function requireUser() {
  const supabase = requireClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error('로그인 후 KPI 데이터를 이용할 수 있습니다.');
  return data.user;
}

function mapDatabaseRow(row) {
  const mapped = {
    id: row.id,
    month: row.month,
    team: row.team,
    target: Number(row.target),
    actual: Number(row.actual)
  };
  if (!Number.isSafeInteger(mapped.target) || !Number.isSafeInteger(mapped.actual)) {
    throw new Error('DB 금액이 JavaScript 안전 정수 범위를 벗어나 표시할 수 없습니다.');
  }
  return mapped;
}

function explainDatabaseError(error, action) {
  if (error?.code === '23505') return new Error('같은 월·부서 KPI가 이미 있습니다. 기존 자료를 확인해 주세요.');
  if (error?.code === '42501' || error?.code === 'PGRST301') return new Error('DB 권한 또는 RLS 정책이 요청을 거부했습니다. Supabase 테이블 권한과 본인 행 정책을 확인해 주세요.');
  if (error?.code === 'PGRST205' || error?.code === '42P01') return new Error('kpi_records 테이블을 찾지 못했습니다. schema.sql 적용 여부와 Data API 노출 설정을 확인해 주세요.');
  if (error?.code === '23514' || error?.code === '23502' || error?.code === '22P02') return new Error('DB 입력 제약을 통과하지 못했습니다. 월·부서·목표·실적을 확인해 주세요.');
  return new Error(error?.message || `Supabase ${action}에 실패했습니다.`);
}

export const isConfigured = () => configured;
export const getInitializationError = () => initError;

export async function getSession() {
  const supabase = requireClient();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function getCurrentUser() {
  const supabase = requireClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  return data.user;
}

export function onAuthStateChange(callback) {
  const supabase = requireClient();
  return supabase.auth.onAuthStateChange((_event, session) => callback(session));
}

export async function signIn(email, password) {
  const supabase = requireClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const supabase = requireClient();
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function read() {
  if (!configured) return sampleRepository.read();
  const supabase = requireClient();
  const user = await requireUser();
  const { data, error } = await supabase
    .from('kpi_records')
    .select(selectedFields)
    .eq('user_id', user.id)
    .order('month', { ascending: false })
    .order('team', { ascending: true });
  if (error) throw explainDatabaseError(error, '조회');
  return (data || []).map(mapDatabaseRow);
}

export async function save(input) {
  const valid = validateRecord(input);
  if (!configured) return sampleRepository.save(valid);
  const supabase = requireClient();
  const user = await requireUser();
  const { data, error } = await supabase
    .from('kpi_records')
    .insert({ ...valid, user_id: user.id })
    .select(selectedFields)
    .single();
  if (error) throw explainDatabaseError(error, '저장');
  if (!data) throw new Error('저장 결과를 확인하지 못했습니다. DB 저장 여부를 다시 조회해 확인해 주세요.');
  return mapDatabaseRow(data);
}
