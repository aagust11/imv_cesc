import type { PeerOptions, DataConnection } from 'peerjs';

// Public STUN discovers direct routes. TURN must be supplied explicitly when required.
// Public demo TURN hosts were tested and are not shipped as a working fallback.
export async function defaultIceServers():Promise<RTCIceServer[]> {
  return [{urls:['stun:stun.l.google.com:19302','stun:stun.cloudflare.com:3478']}];
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

export async function diagnoseIce(){
  const options=await peerOptions();
  const connection=new RTCPeerConnection(options.config);
  const result={stun:false,turn:false,hasTurn:(options.config?.iceServers||[]).some(s=>(Array.isArray(s.urls)?s.urls:[s.urls]).some(u=>u.startsWith('turn:')||u.startsWith('turns:')))};
  try{
    connection.onicecandidate=event=>{
      if(event.candidate?.type==='srflx')result.stun=true;
      if(event.candidate?.type==='relay')result.turn=true;
    };
    connection.createDataChannel('network-test');
    await connection.setLocalDescription(await connection.createOffer());
    await new Promise(resolve=>setTimeout(resolve,10000));
    return result;
  }finally{connection.close();}
}
