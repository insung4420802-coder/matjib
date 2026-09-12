// New photo-tool quota only. Existing restaurant-search API behavior is unchanged.
// Production and preview intentionally share this project-wide monthly budget.
export const DEFAULT_MENU_MONTHLY_LIMIT = 20;
export const MAX_MENU_MONTHLY_LIMIT = 100;
const PREFIX = 'matjib:v22:menu:global';
const fail = (message,status=503,code='MENU_QUOTA_UNAVAILABLE') => {throw Object.assign(new Error(message),{status,code});};

export function menuMonthlyLimit(env = process.env) {
  const value=env.MENU_MONTHLY_LIMIT;
  if(value===undefined || value==='') return DEFAULT_MENU_MONTHLY_LIMIT;
  if(typeof value!=='string' || !/^\d{1,3}$/.test(value)) fail('사진 분석 월 한도 설정을 확인해 주세요.');
  const limit=Number(value);
  if(!Number.isInteger(limit)||limit<0||limit>MAX_MENU_MONTHLY_LIMIT) fail('사진 분석 월 한도는 0~100회로 설정해야 합니다.');
  return limit;
}

export function menuQuotaPeriod(now = new Date()) {
  const date=now instanceof Date ? now : new Date(now);
  if(!Number.isFinite(date.getTime())) fail('사진 분석 한도의 기준 시간을 확인하지 못했습니다.');
  const year=date.getUTCFullYear();const month=date.getUTCMonth();
  const period=`${year}-${String(month+1).padStart(2,'0')}`;
  const nextMonth=Date.UTC(year,month+1,1);
  return {month:period,key:`${PREFIX}:${period}:reserved`,usageKey:`${PREFIX}:${period}:usage`,resetsAt:new Date(nextMonth).toISOString(),ttl:Math.ceil((nextMonth-date.getTime())/1000)+7*86400};
}

const RESERVE_SCRIPT=`-- matjib-menu-reserve-v1
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local limit = tonumber(ARGV[1])
if current >= limit then return {0, current} end
local used = redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
return {1, used}`;

export async function reserveMenuQuota(redis,{limit=DEFAULT_MENU_MONTHLY_LIMIT,now=new Date()}={}) {
  if(!Number.isInteger(limit)||limit<0||limit>MAX_MENU_MONTHLY_LIMIT) fail('사진 분석 월 한도 설정을 확인해 주세요.');
  const period=menuQuotaPeriod(now);
  const result=await redis.command(['EVAL',RESERVE_SCRIPT,1,period.key,limit,period.ttl]);
  const isIntegerReply=value=>(typeof value==='number'&&Number.isSafeInteger(value))||(typeof value==='string'&&/^\d+$/.test(value)&&Number.isSafeInteger(Number(value)));
  if(!Array.isArray(result)||result.length!==2||!result.every(isIntegerReply)||![0,1].includes(Number(result[0]))||Number(result[1])<0) fail('사진 분석 한도를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  const used=Number(result[1]);
  if(Number(result[0])!==1) {
    const error=Object.assign(new Error(limit===0 ? '사진 분석이 일시 중지되어 있습니다. 직접 입력은 계속 사용할 수 있어요.' : `이번 달 사진 분석 공유 한도 ${limit}회를 모두 사용했습니다. 다음 달에 다시 이용하거나 직접 입력해 주세요.`),{status:429,code:'MENU_MONTHLY_LIMIT',quota:{limit,remaining:0,resetsAt:period.resetsAt}});
    throw error;
  }
  if(used<1||used>limit) fail('사진 분석 한도 응답이 올바르지 않습니다.');
  return {...period,limit,used,remaining:Math.max(0,limit-used)};
}

export function sanitizedMenuUsage(usage) {
  if(!usage||typeof usage!=='object')return null;
  if(!Number.isInteger(usage.input_tokens)||!Number.isInteger(usage.output_tokens))return null;
  const fields=['input_tokens','output_tokens','cache_creation_input_tokens','cache_read_input_tokens'];
  const result={};
  for(const field of fields) {
    const value=usage[field];
    if(value===undefined) {result[field]=0;continue;}
    if(!Number.isInteger(value)||value<0||value>1000000)return null;
    result[field]=value;
  }
  return result;
}

const USAGE_SCRIPT=`-- matjib-menu-usage-v1
redis.call('HINCRBY', KEYS[1], 'observed_calls', 1)
redis.call('HINCRBY', KEYS[1], 'input_tokens', tonumber(ARGV[1]))
redis.call('HINCRBY', KEYS[1], 'output_tokens', tonumber(ARGV[2]))
redis.call('HINCRBY', KEYS[1], 'cache_creation_input_tokens', tonumber(ARGV[3]))
redis.call('HINCRBY', KEYS[1], 'cache_read_input_tokens', tonumber(ARGV[4]))
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[5]))
return 1`;

// Best effort is deliberate: paid work must not be presented as failed solely because statistics could not be saved.
export async function recordMenuUsage(redis,reservation,usage) {
  const safe=sanitizedMenuUsage(usage);
  if(!safe||!reservation?.usageKey||!Number.isInteger(reservation.ttl))return false;
  let timer;
  try {
    const write=redis.command(['EVAL',USAGE_SCRIPT,1,reservation.usageKey,safe.input_tokens,safe.output_tokens,safe.cache_creation_input_tokens,safe.cache_read_input_tokens,reservation.ttl]).then(()=>true,()=>false);
    return await Promise.race([write,new Promise(resolve=>{timer=setTimeout(()=>resolve(false),1500);})]);
  } catch {return false;}
  finally {clearTimeout(timer);}
}
