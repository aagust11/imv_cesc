// HTTPS mailbox. All questionnaire payloads are encrypted by the browsers.
const headers = {
  'Access-Control-Allow-Origin': 'https://aagust11.github.io',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'no-store', 'Content-Type': 'application/json',
};
const json = (data, status = 200) => new Response(JSON.stringify(data), {status, headers});
const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(x=>x.toString(16).padStart(2,'0')).join('');
const validSecret = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{32,100}$/.test(value);
const validPacket = p => p && typeof p.iv === 'string' && typeof p.data === 'string' && p.data.length <= 150000 && p.iv.length <= 50;
export async function handleRelay(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, {status:204, headers});
  const url = new URL(request.url);
  if (url.pathname === '/health') return json({ok:true,transport:'https-polling',protocol:1});
  const match = /^\/v1\/rooms\/([A-Z0-9]{6})(?:\/(poll|reply|requests)(?:\/([a-zA-Z0-9_-]{36}))?)?$/.exec(url.pathname);
  if (!match) return json({error:'Ruta no vàlida.'},404);
  const [,code,action,id] = match;
  const db = env.DB;
  if (!db) return json({error:'Servei no configurat.'},503);
  const now = Date.now();
  try {
    // Expiry is enforced on reads too; physical cleanup runs with every request.
    await db.batch([
      db.prepare('DELETE FROM relay_messages WHERE expires < ?').bind(now),
      db.prepare('DELETE FROM relay_rooms WHERE expires < ?').bind(now),
    ]);
    let body = {};
    if (['POST','PUT'].includes(request.method)) {
      if (Number(request.headers.get('content-length')) > 180000) return json({error:'Petició massa gran.'},413);
      const text = await request.text();
      if (text.length > 180000) return json({error:'Petició massa gran.'},413);
      body = JSON.parse(text);
    }
    const bearer = request.headers.get('authorization')?.replace(/^Bearer /,'') || '';
    const owner = validSecret(bearer) ? await digest(bearer) : '';
    if (!action && request.method === 'PUT') {
      if (!owner || !body.publicKey || body.publicKey.kty !== 'EC' || body.publicKey.crv !== 'P-256' || 'd' in body.publicKey) return json({error:'Credencial no vàlida.'},400);
      const publicKey = JSON.stringify(body.publicKey);
      if(publicKey.length > 1000)return json({error:'Clau no vàlida.'},400);
      await db.prepare('INSERT INTO relay_rooms(code,owner,public_key,expires) VALUES(?,?,?,?) ON CONFLICT(code) DO UPDATE SET public_key=excluded.public_key,expires=excluded.expires WHERE relay_rooms.owner=excluded.owner').bind(code,owner,publicKey,now+90000).run();
      const room = await db.prepare('SELECT owner FROM relay_rooms WHERE code=?').bind(code).first();
      return room?.owner === owner ? json({ok:true}) : json({error:'Aquest codi ja està en ús en una altra administració.'},409);
    }
    const room = await db.prepare('SELECT * FROM relay_rooms WHERE code=? AND expires>?').bind(code,now).first();
    if (!room) return json({error:'La consola no està disponible. Comprova el codi i que administració estigui oberta.'},404);
    if (!action && request.method === 'GET') return json({publicKey:JSON.parse(room.public_key)});
    if ((!action && request.method === 'DELETE') || action === 'poll' || action === 'reply') {
      if (!owner || room.owner !== owner) return json({error:'Administració no autoritzada.'},403);
      if (!action) {
        await db.batch([db.prepare('DELETE FROM relay_messages WHERE code=?').bind(code),db.prepare('DELETE FROM relay_rooms WHERE code=? AND owner=?').bind(code,owner)]);
        return json({ok:true});
      }
      if (request.method !== 'POST') return json({error:'Mètode no vàlid.'},405);
      await db.prepare('UPDATE relay_rooms SET expires=? WHERE code=? AND owner=?').bind(now+90000,code,owner).run();
      if (action === 'poll') {
        const messages = await db.prepare('SELECT id,packet FROM relay_messages WHERE code=? AND response IS NULL AND expires>? ORDER BY created,id LIMIT 50').bind(code,now).all();
        return json({messages:messages.results.map(m=>({id:m.id,packet:JSON.parse(m.packet)}))});
      }
      if (!/^[a-zA-Z0-9_-]{36}$/.test(body.id) || !validPacket(body.packet)) return json({error:'Resposta no vàlida.'},400);
      await db.prepare('UPDATE relay_messages SET response=? WHERE id=? AND code=? AND response IS NULL AND expires>?').bind(JSON.stringify(body.packet),body.id,code,now).run();
      return json({ok:true});
    }
    if (action === 'requests' && !id && request.method === 'POST') {
      if (!/^[a-zA-Z0-9_-]{36}$/.test(body.id) || !validSecret(body.secret) || !validPacket(body.packet) || !body.packet.publicKey || JSON.stringify(body.packet.publicKey).length > 1000) return json({error:'Enviament no vàlid.'},400);
      const secret = await digest(body.secret);
      // Bound outstanding work per room. Completed ACKs remain retrievable until expiry.
      const count = await db.prepare('SELECT COUNT(*) AS n FROM relay_messages WHERE code=? AND response IS NULL').bind(code).first();
      if (count.n >= 500) return json({error:'Servei ocupat. Torna-ho a provar.'},429);
      await db.prepare('INSERT OR IGNORE INTO relay_messages(id,code,secret,packet,created,expires) VALUES(?,?,?,?,?,?)').bind(body.id,code,secret,JSON.stringify(body.packet),now,now+300000).run();
      const row = await db.prepare('SELECT secret,code FROM relay_messages WHERE id=?').bind(body.id).first();
      return row?.secret === secret && row?.code === code ? json({ok:true},202) : json({error:'Identificador no vàlid.'},409);
    }
    if (action === 'requests' && id && request.method === 'GET') {
      if (!owner) return json({error:'Accés no autoritzat.'},403);
      const row = await db.prepare('SELECT response FROM relay_messages WHERE id=? AND code=? AND secret=? AND expires>?').bind(id,code,owner,now).first();
      if (!row) return json({error:'Petició caducada.'},404);
      return json(row.response ? {packet:JSON.parse(row.response)} : {pending:true});
    }
    return json({error:'Mètode no vàlid.'},405);
  } catch {
    return json({error:'No s’ha pogut completar la petició. Es tornarà a intentar.'},500);
  }
}
export default {fetch:handleRelay};
