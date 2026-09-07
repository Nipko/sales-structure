import { createServer as createTcpServer,type Socket } from 'net';
import { createServer as createTlsServer,createSecureContext,TLSSocket } from 'tls';
import { mkdtempSync,readFileSync,unlinkSync,rmdirSync,existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { sendBoundedSmtp } from './bounded-smtp';

describe('bounded SMTP socket ownership through TLS',()=>{
    let key:Buffer,cert:Buffer,server:any,port:number,accepted:number,sockets:Set<Socket>,closures:Promise<void>[];
    beforeAll(()=>{
        const directory=mkdtempSync(join(tmpdir(),'parallly-smtp-test-')),keyFile=join(directory,'key.pem'),certFile=join(directory,'cert.pem');
        const windows='C:\\Program Files\\OpenSSL-Win64\\bin\\openssl.exe';
        const openssl=process.env.OPENSSL_BIN||(existsSync(windows)?windows:'openssl');
        try{
            execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-keyout',keyFile,'-out',certFile,'-days','1','-subj','/CN=localhost'],{stdio:'ignore'});
            key=readFileSync(keyFile);cert=readFileSync(certFile);
        }finally{if(existsSync(keyFile))unlinkSync(keyFile);if(existsSync(certFile))unlinkSync(certFile);rmdirSync(directory);}
    });
    afterEach(async()=>{for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));});
    async function start(implicit:boolean,hold:boolean){
        sockets=new Set();closures=[];accepted=0;const context=createSecureContext({key,cert});
        const serve=(socket:Socket,upgrade:boolean,greet:boolean)=>{
            sockets.add(socket);socket.on('error',()=>{});closures.push(new Promise(resolve=>socket.once('close',()=>{sockets.delete(socket);resolve();})));
            if(greet)socket.write('220 synthetic SMTP\r\n');let buffer='',data=false;
            const onData=(chunk:Buffer)=>{
                buffer+=chunk.toString();
                if(data){if(buffer.includes('\r\n.\r\n')){accepted++;buffer='';data=false;if(!hold)socket.write('250 queued\r\n');}return;}
                let end:number;while((end=buffer.indexOf('\r\n'))>=0){
                    const line=buffer.slice(0,end);buffer=buffer.slice(end+2);
                    if(line.startsWith('EHLO'))socket.write(upgrade?'250-synthetic\r\n250 STARTTLS\r\n':'250 synthetic\r\n');
                    else if(line==='STARTTLS'){
                        socket.removeListener('data',onData);socket.write('220 proceed\r\n');
                        serve(new TLSSocket(socket,{isServer:true,secureContext:context}),false,false);return;
                    }else if(line==='DATA'){data=true;socket.write('354 send data\r\n');}
                    else socket.write('250 ok\r\n');
                }
            };socket.on('data',onData);
        };
        server=implicit?createTlsServer({key,cert},socket=>serve(socket,false,true)):createTcpServer(socket=>serve(socket,true,true));
        await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));port=server.address().port;
    }
    const send=(secure:boolean,deadline=1500)=>sendBoundedSmtp({host:'127.0.0.1',port,secure,tls:{rejectUnauthorized:false,servername:'localhost'}},
        {from:'sender@example.invalid',to:'recipient@example.invalid',subject:'Synthetic',text:'Synthetic fixture'},deadline);
    it.each([true,false])('receives acceptance over implicit TLS=%s and closes its connection',async secure=>{
        await start(secure,false);expect(await send(secure)).toContain('@');expect(accepted).toBe(1);
        await Promise.all(closures);expect(sockets.size).toBe(0);
    });
    it('destroys the upgraded STARTTLS transport before returning an uncertain timeout',async()=>{
        await start(false,true);await expect(send(false,350)).rejects.toThrow('smtp_deadline_outcome_unknown');
        expect(accepted).toBe(1);await Promise.all(closures);expect(sockets.size).toBe(0);
    });
});
