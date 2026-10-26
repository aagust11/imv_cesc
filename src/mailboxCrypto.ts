const b64 = (data: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(data instanceof Uint8Array ? data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength) : data)));
const bytes = (data:string) => Uint8Array.from(atob(data),c=>c.charCodeAt(0));
export const createKeys = () => crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveKey']);
export async function sharedKey(privateKey:CryptoKey,publicKey:JsonWebKey) {
  const key = await crypto.subtle.importKey('jwk',publicKey,{name:'ECDH',namedCurve:'P-256'},false,[]);
  return crypto.subtle.deriveKey({name:'ECDH',public:key},privateKey,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export async function seal(key:CryptoKey,value:unknown,context:string) {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const data=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(context)},key,new TextEncoder().encode(JSON.stringify(value)));
  return {iv:b64(iv),data:b64(data)};
}
export async function unseal(key:CryptoKey,packet:{iv:string;data:string},context:string) {
  const data=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(packet.iv),additionalData:new TextEncoder().encode(context)},key,bytes(packet.data));
  return JSON.parse(new TextDecoder().decode(data));
}
