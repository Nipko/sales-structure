// Preloaded with node --import before the Jest CLI/config/product imports.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import http2 from 'node:http2';
import net from 'node:net';
import tls from 'node:tls';
import dgram from 'node:dgram';
import childProcess from 'node:child_process';
import dns from 'node:dns';
import threads from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';
const out=process.env.SETTINGS_BOOKING_API_KEYS_NODE_BOUNDARY_FILE;
assert(out&&path.isAbsolute(out));assert.equal(path.dirname(path.resolve(out)),path.resolve('artifacts'));assert(/^settings-booking-api-keys-(booking|api-keys)-node-boundary\.json$/.test(path.basename(out)));assert(!fs.existsSync(out));
const attempts=[];
const sanitize=stack=>String(stack).replaceAll(process.cwd(),'<repository>').split('\n').slice(1,11).join('\n');
const block=port=>function(){attempts.push({port,phase:'guarded_Jest_CLI_config_and_product_render',stack:sanitize(new Error().stack)});throw new Error('Unapproved Node transport: '+port);};
for(const [target,label,names]of [[http,'node:http',['request','get','createServer']],[https,'node:https',['request','get','createServer']],[http2,'node:http2',['connect','createServer','createSecureServer']],[net,'node:net',['connect','createConnection','createServer']],[tls,'node:tls',['connect','createServer']],[dgram,'node:dgram',['createSocket']],[childProcess,'node:child_process',['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']],[dns,'node:dns',['lookup','lookupService','resolve','resolve4','resolve6','resolveAny','resolveCaa','resolveCname','resolveMx','resolveNaptr','resolveNs','resolvePtr','resolveSoa','resolveSrv','resolveTxt','reverse']]]){
 for(const name of names)if(typeof target[name]==='function')target[name]=block(label+'.'+name);
 if(target===dns)for(const name of names)if(typeof target.promises[name]==='function')target.promises[name]=block('node:dns.promises.'+name);
}
net.Socket.prototype.connect=block('node:net.Socket.connect');net.Server.prototype.listen=block('node:net.Server.listen');threads.Worker=block('node:worker_threads.Worker');
for(const name of ['fetch','WebSocket','EventSource','BroadcastChannel'])if(name in globalThis)globalThis[name]=block('globalThis.'+name);
syncBuiltinESMExports();
process.once('exit',()=>fs.writeFileSync(out,JSON.stringify({at_utc:new Date().toISOString(),scope:'owned Jest child only',installed_before_Jest_config_product_import:true,installed_before_Jest_CLI:true,attempts,actual_transports_started:0},null,2)+'\n',{flag:'wx'}));
