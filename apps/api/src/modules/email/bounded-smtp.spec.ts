import { createServer,type Socket } from 'net';
import { sendBoundedSmtp } from './bounded-smtp';

describe('bounded SMTP attempt on a synthetic loopback server',()=>{
    let server:any,port:number,sockets:Set<Socket>,accepted:number,mode:string;
    beforeEach(async()=>{
        sockets=new Set();accepted=0;mode='ack';
        server=createServer(socket=>{
            sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));
            if(mode==='no_greeting')return;
            const hold=mode==='lost_ack';let buffer='',data=false;
            socket.write('220 synthetic SMTP\r\n');
            socket.on('data',chunk=>{
                buffer+=chunk.toString();
                if(data){if(buffer.includes('\r\n.\r\n')){accepted++;buffer='';data=false;if(!hold)socket.write('250 queued\r\n');}return;}
                let end:number;
                while((end=buffer.indexOf('\r\n'))>=0){
                    const line=buffer.slice(0,end);buffer=buffer.slice(end+2);
                    if(line.startsWith('EHLO')||line.startsWith('HELO'))socket.write('250 synthetic\r\n');
                    else if(line==='DATA'){data=true;socket.write('354 send data\r\n');}
                    else if(line==='QUIT')socket.end('221 bye\r\n');
                    else socket.write('250 ok\r\n');
                }
            });
        });
        await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));port=server.address().port;
    });
    afterEach(async()=>{for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));});
    const send=(deadline=200)=>sendBoundedSmtp({host:'127.0.0.1',port,secure:false,ignoreTLS:true},
        {from:'sender@example.invalid',to:'recipient@example.invalid',subject:'Synthetic',text:'Synthetic fixture'},deadline);
    it('returns SMTP acceptance without claiming recipient delivery',async()=>{
        expect(await send(1000)).toContain('@');expect(accepted).toBe(1);
    });
    it('aborts a hung greeting under a private deadline',async()=>{
        mode='no_greeting';await expect(send(75)).rejects.toThrow();expect(accepted).toBe(0);
    });
    it('preserves ambiguity after DATA was accepted but its acknowledgement was lost, without retrying',async()=>{
        mode='lost_ack';await expect(send()).rejects.toThrow('smtp_deadline_outcome_unknown');expect(accepted).toBe(1);
    });
    it('cancelling one attempt does not close another attempt',async()=>{
        mode='lost_ack';const first=send(250);const failed=expect(first).rejects.toThrow();
        while(!sockets.size)await new Promise(resolve=>setTimeout(resolve,5));
        mode='ack';expect(await send(1000)).toContain('@');await failed;expect(accepted).toBe(2);
    });
});
