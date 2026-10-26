import { createClient, type RealtimeChannel } from '@supabase/supabase-js';

// Publishable key only: no privileged key, application data API or database access.
const url = import.meta.env.VITE_RELAY_URL || 'https://ohlkjphpzxnuyjbcszcn.supabase.co';
const publishableKey = import.meta.env.VITE_RELAY_PUBLISHABLE_KEY || 'sb_publishable_jqcEh8qkM_mmA_XLuOm6TA_08qr3DY2';
const client = createClient(url, publishableKey, {
  auth: { persistSession:false, autoRefreshToken:false, detectSessionInUrl:false },
  realtime: { vsn:'1.0.0', timeout:10000, params:{eventsPerSecond:100} },
});
const encoder = new TextEncoder();
const notify = (detail: string) => window.dispatchEvent(new CustomEvent('cesc-live-status',{detail}));
const wait = (ms:number) => new Promise(resolve=>setTimeout(resolve,ms));
const base64 = (bytes:Uint8Array) => { let s=''; for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s); };
const bytes = (s:string) => Uint8Array.from(atob(s),c=>c.charCodeAt(0));
export const createKeys = () => crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveKey']);
export const deriveKey = async (secret:CryptoKey,publicKey:JsonWebKey) => {
  const key=await crypto.subtle.importKey('jwk',publicKey,{name:'ECDH',namedCurve:'P-256'},false,[]);
  return crypto.subtle.deriveKey({name:'ECDH',public:key},secret,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
};
export async function encrypt(key:CryptoKey,value:unknown,id:string,label:string) {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const data=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(id+':'+label)},key,encoder.encode(JSON.stringify(value)));
  return {iv:base64(iv),data:base64(new Uint8Array(data))};
}
export async function decrypt(key:CryptoKey,packet:any,id:string,label:string) {
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(packet.iv),additionalData:encoder.encode(id+':'+label)},key,bytes(packet.data));
  return JSON.parse(new TextDecoder().decode(plain));
}
type Announcement={kind:'announce';hostId:string;publicKey:JsonWebKey;ready:boolean};
type Link={channel:RealtimeChannel;ready:Promise<void>;listeners:Set<(p:any)=>void>;host?:Announcement;seenAt:number;state:string};
const links=new Map<string,Link>();
function linkFor(code:string):Link {
  const existing=links.get(code);if(existing)return existing;
  if(links.size>=4){
    const oldest=[...links.entries()].find(([c])=>c!==hosting?.code);
    if(oldest){void client.removeChannel(oldest[1].channel);links.delete(oldest[0]);}
  }
  const channel=client.channel('imv-cesc-relay-v2-'+code,{config:{broadcast:{self:false,ack:true}}});
  const link:Link={channel,listeners:new Set(),seenAt:0,state:'CONNECTING',ready:Promise.resolve()};
  channel.on('broadcast',{event:'cesc'},({payload})=>{
    if(!payload||typeof payload.kind!=='string'||JSON.stringify(payload).length>180000)return;
    if(payload.kind==='announce'&&payload.ready){link.host=payload;link.seenAt=Date.now();}
    for(const callback of link.listeners)callback(payload);
  });
  link.ready=new Promise<void>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('No es pot connectar amb el relé segur. Comprova Internet o el domini de Supabase a la xarxa.')),15000);
    channel.subscribe(status=>{
      link.state=status;
      if(status==='SUBSCRIBED'){
        clearTimeout(timer);resolve();
        if(hosting?.code===code&&hosting.active){notify('Connectat · rebent respostes');void announce(hosting);}
      } else if(hosting?.code===code&&hosting.active)notify('Relé segur interromput · reconnectant');
    });
  });
  // Failed initial subscriptions can be retried from a fresh channel.
  void link.ready.catch(()=>{if(links.get(code)===link){links.delete(code);void client.removeChannel(channel);}});
  links.set(code,link);return link;
}
async function publish(link:Link,payload:unknown){
  await link.ready;
  const result=await link.channel.send({type:'broadcast',event:'cesc',payload});
  if(result!=='ok')throw new Error('El relé no ha confirmat el missatge. Es tornarà a intentar.');
}
type Host={code:string;id:string;link:Link;keys:CryptoKeyPair;publicKey:JsonWebKey;active:boolean;cancelled:boolean;ready:Promise<void>;listener:(p:any)=>void;handler:(p:any)=>any;cache:Map<string,any>;timer?:ReturnType<typeof setInterval>;occupied:boolean};
let hosting:Host|undefined;
const announce=(s:Host)=>publish(s.link,{kind:'announce',hostId:s.id,publicKey:s.publicKey,ready:s.active});
export function stopRelayHosting(){
  const old=hosting;hosting=undefined;
  if(old){old.cancelled=true;old.active=false;clearInterval(old.timer);old.link.listeners.delete(old.listener);old.cache.clear();old.link.host=undefined;}
}
export async function startRelayHosting(code:string,handler:(p:any)=>any):Promise<void>{
  if(hosting?.code===code&&!hosting.cancelled){
    if(hosting.link.state!=='SUBSCRIBED')throw new Error('Reconnectant amb el relé segur…');
    return hosting.ready;
  }
  stopRelayHosting();notify('Connectant amb el relé segur…');
  const keys=await createKeys();
  const link=linkFor(code);
  const state:Host={code,id:crypto.randomUUID(),link,keys,publicKey:await crypto.subtle.exportKey('jwk',keys.publicKey),active:false,cancelled:false,ready:Promise.resolve(),listener:()=>{},handler,cache:new Map(),occupied:false};
  hosting=state;
  state.listener=(message:any)=>{
    if(state.cancelled)return;
    if(message.kind==='discover'){void announce(state).catch(()=>{});return;}
    if(message.kind==='announce'&&message.hostId!==state.id){
      if(!state.active&&(message.ready||String(message.hostId)<state.id))state.occupied=true;
      if(state.active&&!message.ready)void announce(state).catch(()=>{});
      return;
    }
    if(!state.active||message.kind!=='request'||message.to!==state.id||typeof message.id!=='string')return;
    void (async()=>{
      const cached=state.cache.get(message.id);
      if(cached){await publish(link,cached);return;}
      const key=await deriveKey(keys.privateKey,message.publicKey);
      const payload=await decrypt(key,message.packet,message.id,'request');
      let reply;
      try{reply={ok:true,data:handler({...payload,code})};}
      catch(error){reply={ok:false,error:error instanceof Error?error.message:'No s’ha pogut desar.'};}
      if(state.cancelled)return;
      const packet={kind:'reply',id:message.id,from:state.id,packet:await encrypt(key,reply,message.id,'reply')};
      if(state.cache.size>=512)state.cache.delete(state.cache.keys().next().value!);
      state.cache.set(message.id,packet);
      await publish(link,packet);
    })().catch(()=>{}); // Invalid/corrupt ciphertext never reaches the application handler.
  };
  link.listeners.add(state.listener);
  state.ready=(async()=>{
    try{
      await link.ready;
      await publish(link,{kind:'discover'});
      await announce(state);
      await wait(1200);
      if(state.cancelled)throw new Error('Sessió cancel·lada.');
      if(state.occupied)throw new Error('Aquest codi ja està en ús en una altra administració. Tria’n un altre.');
      state.active=true;await announce(state);
      state.timer=setInterval(()=>{void announce(state).catch(()=>notify('Relé segur interromput · reconnectant'));},15000);
      notify('Connectat · rebent respostes');
    }catch(error){if(hosting===state)stopRelayHosting();throw error;}
  })();
  return state.ready;
}
export async function sendViaRelay(code:string,payload:object):Promise<any>{
  // Supports testing/presenting on the teacher browser without broadcasting back to itself.
  if(hosting?.code===code&&hosting.active)return hosting.handler({...payload,code});
  const link=linkFor(code);await link.ready;
  const id=crypto.randomUUID();
  const keys=await createKeys();
  return new Promise((resolve,reject)=>{
    let host:Announcement|undefined;
    let key:CryptoKey|undefined;
    let finished=false;
    let outgoing:any;
    const finish=(error?:Error,data?:any)=>{
      if(finished)return;finished=true;clearTimeout(timer);clearInterval(retry);link.listeners.delete(listener);
      error?reject(error):resolve(data);
    };
    const begin=async(announcement:Announcement)=>{
      if(host||finished)return;host=announcement;
      try{
        key=await deriveKey(keys.privateKey,host.publicKey);
        outgoing={kind:'request',id,to:host.hostId,publicKey:await crypto.subtle.exportKey('jwk',keys.publicKey),packet:await encrypt(key,{...payload,code},id,'request')};
        await publish(link,outgoing);
      }catch(error){finish(error as Error);}
    };
    const listener=(message:any)=>{
      if(message.kind==='announce'&&message.ready){
        if(host&&message.hostId!==host.hostId){host=undefined;key=undefined;outgoing=undefined;}
        if(!host)void begin(message);
      }
      if(message.kind==='reply'&&message.id===id&&message.from===host?.hostId&&key){
        void decrypt(key,message.packet,id,'reply').then(reply=>finish(reply.ok?undefined:new Error(reply.error),reply.data)).catch(()=>{});
      }
    };
    link.listeners.add(listener);
    const timer=setTimeout(()=>finish(new Error('Administració no ha confirmat la recepció. Comprova que la consola estigui oberta; es reintentarà.')),18000);
    const retry=setInterval(()=>{
      if(outgoing)void publish(link,outgoing).catch(()=>{});
      else void publish(link,{kind:'discover'}).catch(()=>{});
    },2500);
    // A live announcement is shared across requests; avoid a discovery storm for each answer.
    if(link.host&&Date.now()-link.seenAt<20000)void begin(link.host);
    else void publish(link,{kind:'discover'}).catch(error=>finish(error));
  });
}
