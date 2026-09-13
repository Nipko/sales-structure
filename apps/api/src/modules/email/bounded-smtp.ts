import { connect, type Socket } from 'net';
import { connect as connectTls } from 'tls';
import * as nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';

/** One SMTP attempt owns its socket. Deadline cancellation destroys and awaits
 * that socket; it never closes the shared mail transport or retries DATA. */
export async function sendBoundedSmtp(options:SMTPTransport.Options,mail:nodemailer.SendMailOptions,deadlineMs=25000):Promise<string> {
    if(!Number.isFinite(deadlineMs)||deadlineMs<25||deadlineMs>25000)throw new Error('smtp_deadline_invalid');
    let socket:Socket|undefined,closed:Promise<void>=Promise.resolve(),aborted=false;
    let rejectDeadline:(error:Error)=>void=()=>{};
    const expired=new Promise<never>((_resolve,reject)=>{rejectDeadline=reject;});
    const timer=setTimeout(()=>{
        aborted=true;socket?.destroy();rejectDeadline(new Error('smtp_deadline_outcome_unknown'));
    },deadlineMs);
    const transport=nodemailer.createTransport({...options,pool:false,
        connectionTimeout:deadlineMs,greetingTimeout:deadlineMs,socketTimeout:deadlineMs,
        getSocket:(_opts:any,callback:any)=>{
            if(aborted)return callback(new Error('smtp_deadline_outcome_unknown'));
            const host=String(options.host||''),port=Number(options.port||(options.secure?465:587));
            socket=options.secure?connectTls({host,port,servername:options.tls?.servername||host,...options.tls}):connect({host,port});
            closed=new Promise<void>(resolve=>socket!.once('close',()=>resolve()));
            let provided=false;
            const provide=(error?:Error)=>{
                if(provided)return;provided=true;
                callback(error||(aborted?new Error('smtp_deadline_outcome_unknown'):null),{connection:socket,secured:options.secure===true});
            };
            socket.once(options.secure?'secureConnect':'connect',()=>provide());
            socket.once('error',error=>provide(error));
            socket.once('close',()=>provide(new Error('smtp_connection_closed')));
        },
    } as SMTPTransport.Options);
    try{
        const info=await Promise.race([transport.sendMail(mail),expired]);
        if(!info.accepted?.length || !info.messageId)throw new Error('smtp_acceptance_unverified');
        return info.messageId;
    }finally{
        clearTimeout(timer);aborted=true;socket?.destroy();await closed;
        transport.close();
    }
}
