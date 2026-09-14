import { guardAccess } from './lib/_guard.js';
import { createRedisClient, redisConfigured } from '../server-lib/redis.js';
import { assertSameOrigin, readToolsJson, setPrivateHeaders, clientFingerprint, enforceRateLimit } from '../server-lib/tools-security.js';
import { menuMonthlyLimit, reserveMenuQuota, recordMenuUsage } from '../server-lib/menu-quota.js';
import { parseMenuPhoto, validateMenuImages } from '../preview/v22/menu-api.mjs';
import { photoHeaderSize, MAX_PHOTO_REQUEST_BYTES } from '../preview/v22/menu-photo-optimize.js';
import { MENU_ANALYSIS_TIMEOUT_MS, MENU_HANDLER_DEADLINE_MS, MENU_ANALYSIS_VERSION } from '../preview/v22/menu-analysis-policy.js';

const fail=(message,status=503,code='MENU_PHOTO_UNAVAILABLE')=>{throw Object.assign(new Error(message),{status,code});};

export function validateProductionMenuPhotos(body) {
  const images=validateMenuImages(body);
  for(const image of images) {
    const bytes=Buffer.from(image.data,'base64');
    const size=photoHeaderSize(new Uint8Array(bytes.subarray(0,512*1024)));
    if(!size||![size.width,size.height].every(value=>Number.isInteger(value)&&value>0&&value<=1568)||size.width*size.height>1568*1568) {
      fail('최적화한 사진의 해상도를 확인하지 못했습니다. 사진을 다시 선택해 자동 최적화해 주세요.',400,'MENU_PHOTO_DIMENSIONS');
    }
  }
  return images;
}

function configuration(env) {
  const limit=menuMonthlyLimit(env);
  const model=env.ANTHROPIC_MODEL||'claude-haiku-4-5';
  if(!/^claude-haiku-4-5(?:-\d{8})?$/.test(model))fail('사진 분석은 기존 Haiku 4.5 모델 설정에서만 사용할 수 있습니다.');
  const storage=redisConfigured(env);
  const enabled=env.MENU_PHOTO_ENABLED!=='0'&&Boolean(env.ANTHROPIC_API_KEY)&&storage&&limit>0;
  return {limit,model,storage,enabled};
}

export function createMenuPhotoHandler({env=process.env,createRedis=createRedisClient,parsePhoto=parseMenuPhoto,accessGuard=guardAccess,now=()=>new Date(),clock=()=>Date.now(),logEvent=event=>console.info('menu-photo',JSON.stringify(event))}={}) {
  return async function handler(req,res) {
    const started=clock();let photoCount=0;let phase='validation';
    const record=status=>{
      // Never log photos, menu text, tokens, IP addresses or API keys.
      try {logEvent({version:MENU_ANALYSIS_VERSION,status,phase,photoCount,durationMs:Math.max(0,clock()-started)});} catch {}
    };
    setPrivateHeaders(res);
    res.setHeader('X-Menu-Analysis-Version',String(MENU_ANALYSIS_VERSION));
    try {
      if(req.method==='GET') {
        let config;
        try {config=configuration(env);} catch {config={limit:0,enabled:false,storage:redisConfigured(env)};}
        return res.status(200).json({menuVisionConfigured:config.enabled,storageConfigured:config.storage,accessKeyRequired:Boolean(env.APP_ACCESS_KEY),menuMonthlyLimit:config.limit,menuAnalysisVersion:MENU_ANALYSIS_VERSION,menuMeaningEnabled:true,menuAnalysisTimeoutSeconds:MENU_ANALYSIS_TIMEOUT_MS/1000,quotaScope:'project-shared-production-and-preview',quotaTimezone:'UTC'});
      }
      if(req.method!=='POST') {res.setHeader('Allow','GET, POST');fail('GET 또는 POST만 지원합니다.',405,'METHOD_NOT_ALLOWED');}
      assertSameOrigin(req);
      if(!accessGuard(req,res))return;
      const config=configuration(env);
      if(!config.enabled)fail('사진 분석 연결이 준비되지 않았거나 일시 중지되어 있습니다. 직접 입력은 계속 사용할 수 있어요.');
      const body=await readToolsJson(req,MAX_PHOTO_REQUEST_BYTES);
      photoCount=validateProductionMenuPhotos(body).length; // Reject invalid input before a paid-call reservation.
      const redis=createRedis({env});
      phase='quota';
      await enforceRateLimit(redis,{key:`matjib:v22:menu:global:rate:${clientFingerprint(req,env)}`,limit:3,windowSeconds:60});
      if(clock()-started>MENU_HANDLER_DEADLINE_MS-15000)fail('서버 준비 시간이 길어 분석을 시작하지 않았어요. 사진은 그대로 두고 잠시 후 다시 시도해 주세요.',504,'MENU_PREPARATION_TIMEOUT');
      const reservation=await reserveMenuQuota(redis,{limit:config.limit,now:now()});
      let usage=null;let result;
      try {
        phase='analysis';
        result=await parsePhoto(body,{apiKey:env.ANTHROPIC_API_KEY,model:config.model,timeoutMs:Math.max(1000,Math.min(MENU_ANALYSIS_TIMEOUT_MS,MENU_HANDLER_DEADLINE_MS-5000-(clock()-started))),onUsage:value=>{usage=value;}});
      } finally {
        // Reservations are never refunded: a timeout/invalid OCR result may already have incurred model charges.
        if(usage)await recordMenuUsage(redis,reservation,usage);
      }
      phase='complete';record(200);
      return res.status(200).json({...result,quota:{limit:reservation.limit,remaining:reservation.remaining,resetsAt:reservation.resetsAt}});
    } catch(error) {
      const status=Number.isInteger(error.status)&&error.status>=400&&error.status<=599?error.status:503;
      if(req.method==='POST')record(status);
      if(status===429&&Number.isFinite(error.retryAfter))res.setHeader('Retry-After',String(Math.max(1,Math.ceil(error.retryAfter))));
      return res.status(status).json({error:status===503&&!error.status?'사진 분석 연결을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.':error.message,code:error.code||'MENU_PHOTO_ERROR',...(error.quota?{quota:error.quota}:{})});
    }
  };
}

export default createMenuPhotoHandler();
