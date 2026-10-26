import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {handleRelay} from '../relay/worker.js';
export async function startMailbox(port=19000){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(`CREATE TABLE relay_rooms(code TEXT PRIMARY KEY,owner TEXT NOT NULL,public_key TEXT NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE relay_messages(id TEXT PRIMARY KEY,code TEXT NOT NULL,secret TEXT NOT NULL,packet TEXT NOT NULL,response TEXT,created INTEGER NOT NULL,expires INTEGER NOT NULL);`);
 const db={prepare(sql){let args=[];const query={bind(...values){args=values;return query},async run(){return sqlite.prepare(sql).run(...args)},async first(){return sqlite.prepare(sql).get(...args)},async all(){return {results:sqlite.prepare(sql).all(...args)}}};return query},async batch(queries){sqlite.exec('BEGIN');try{const results=[];for(const q of queries)results.push(await q.run());sqlite.exec('COMMIT');return results}catch(e){sqlite.exec('ROLLBACK');throw e}}};
 const server=createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const response=await handleRelay(new Request(`http://127.0.0.1:${port}${req.url}`,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})}),{DB:db});
  res.statusCode=response.status;
  for(const [key,value]of response.headers)res.setHeader(key,value);
  // Development test origin only; the production Worker restricts CORS to GitHub Pages.
  res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:15173');
  res.end(Buffer.from(await response.arrayBuffer()));
 });
 await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
 return {sqlite,close:async()=>{await new Promise(resolve=>server.close(resolve));sqlite.close();},handle:request=>handleRelay(request,{DB:db})};
}
