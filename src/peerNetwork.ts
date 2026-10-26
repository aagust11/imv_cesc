import type { PeerOptions, DataConnection } from 'peerjs';

// Public static-auth demo explicitly documented by the Open Relay Project:
// https://www.metered.ca/tools/openrelay/ (not a private or account API secret).
export async function defaultIceServers():Promise<RTCIceServer[]> {
  const username = `${Math.floor(Date.now()/1000)+3600}:cesc`;
  const key = await crypto.subtle.importKey('raw',new TextEncoder().encode('openrelayprojectsecret'),{name:'HMAC',hash:'SHA-1'},false,['sign']);
  const signature=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(username));
  const credential=btoa(String.fromCharCode(...new Uint8Array(signature)));
  return [
    {urls:['stun:stun.l.google.com:19302','stun:stun.cloudflare.com:3478']},
    {urls:import.meta.env.VITE_TURN_TLS_ONLY==='true'?['turns:staticauth.openrelay.metered.ca:443?transport=tcp']:['turn:staticauth.openrelay.metered.ca:80?transport=udp','turn:staticauth.openrelay.metered.ca:443?transport=tcp','turns:staticauth.openrelay.metered.ca:443?transport=tcp'],username,credential},
  ];
}
export async function peerOptions():Promise<PeerOptions> {
  const configured=import.meta.env.VITE_ICE_SERVERS;
  const iceServers:RTCIceServer[]=configured?JSON.parse(configured):await defaultIceServers();
  if(!Array.isArray(iceServers))throw new Error('Configuració ICE no vàlida.');
  return {
    ...(import.meta.env.VITE_PEER_HOST?{
      host:import.meta.env.VITE_PEER_HOST,port:Number(import.meta.env.VITE_PEER_PORT||443),
      path:import.meta.env.VITE_PEER_PATH||'/',secure:import.meta.env.VITE_PEER_SECURE!=='false',
    }:{}),
    config:{iceServers,iceTransportPolicy:import.meta.env.VITE_ICE_TRANSPORT_POLICY==='relay'?'relay':'all'},
  };
}
export async function reportPeerRoute(connection:DataConnection){
  try{
    const stats=await connection.peerConnection.getStats();
    let pair:any;
    stats.forEach(s=>{if(s.type==='transport'&&s.selectedCandidatePairId)pair=stats.get(s.selectedCandidatePairId);});
    if(!pair)stats.forEach(s=>{if(s.type==='candidate-pair'&&s.state==='succeeded'&&s.nominated)pair=s;});
    if(!pair)return;
    const local=stats.get(pair.localCandidateId), remote=stats.get(pair.remoteCandidateId);
    const relay=local?.candidateType==='relay'||remote?.candidateType==='relay';
    window.dispatchEvent(new CustomEvent('cesc-peer-route',{detail:{relay,text:relay?'WebRTC amb relé TURN · sense desat al servidor':'WebRTC directe entre dispositius'}}));
  }catch{}
}
