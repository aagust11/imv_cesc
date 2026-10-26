// Controlled broker: run the full app flow with WebRTC forbidden and inspect wire payloads.
import { WebSocketServer } from 'ws';
const server=new WebSocketServer({port:19001});
const members=new Map();
server.on('connection',socket=>{
  const topics=new Set();members.set(socket,topics);
  socket.on('message',raw=>{
    const text=raw.toString();
    if(/Alumne A|Alumne B|Alumne privat|Company privat/.test(text))throw Error('Plaintext student data found on relay wire');
    const message=JSON.parse(text);
    const {topic,event,payload,ref,join_ref}=message;
    const reply=response=>socket.send(JSON.stringify({topic,event:'phx_reply',payload:{status:'ok',response},ref,join_ref}));
    if(event==='phx_join'){topics.add(topic);reply({postgres_changes:[]});}
    else if(event==='phx_leave'){topics.delete(topic);reply({});}
    else if(event==='heartbeat')reply({});
    else if(event==='access_token'){}
    else if(event==='broadcast'){
      for(const [other,subscriptions] of members)if(other!==socket&&subscriptions.has(topic)&&other.readyState===1){
        other.send(JSON.stringify({topic,event:'broadcast',payload,ref:null,join_ref:null}));
      }
      reply({});
    }
  });
  socket.on('close',()=>members.delete(socket));
});
process.env.VITE_RELAY_URL='http://127.0.0.1:19001';
process.env.VITE_RELAY_PUBLISHABLE_KEY='test-publishable-key';
process.env.VITE_TRANSPORT='relay';
process.env.CESC_BLOCK_WEBRTC='true';
await import('./live.mjs');
