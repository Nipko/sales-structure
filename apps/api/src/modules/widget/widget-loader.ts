export function getLoaderScript(apiBase: string): string {
    return `(function(){
'use strict';
var C=window.__paralllyWidget||{};var WID=C.widgetId;if(!WID)return;

var API='${apiBase}';
var SK='parallly_w_'+WID;
var IO_CDN='https://cdn.socket.io/4.8.1/socket.io.min.js';

var st={open:false,cfg:null,sess:null,sock:null,msgs:[],unread:0,typing:false,pcDone:false,el:{}};

function loadIO(cb){if(window.io)return cb();var s=document.createElement('script');s.src=IO_CDN;s.onload=cb;s.onerror=function(){console.error('Parallly widget: socket.io load failed')};document.head.appendChild(s)}

function getVid(){var k=SK+'_vid';var v=localStorage.getItem(k);if(!v){v='v_'+Math.random().toString(36).substr(2,12)+Date.now().toString(36);localStorage.setItem(k,v)}return v}
function getSess(){try{var s=localStorage.getItem(SK);return s?JSON.parse(s):null}catch(e){return null}}
function saveSess(s){try{localStorage.setItem(SK,JSON.stringify(s))}catch(e){}}

function fetchCfg(cb){
  fetch(API+'/widget/config/'+WID).then(function(r){return r.json()}).then(function(d){
    if(d.success){st.cfg=d.data;cb(null,d.data)}else cb(new Error('not found'))
  }).catch(cb)
}

function initSess(pc,cb){
  var saved=getSess();
  if(saved&&saved.token){
    fetch(API+'/widget/sessions/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:saved.token})})
    .then(function(r){return r.json()}).then(function(d){
      if(d.success){st.sess=Object.assign({},saved,d.data);cb(null,st.sess)}
      else newSess(pc,cb)
    }).catch(function(){newSess(pc,cb)})
  }else newSess(pc,cb)
}

function newSess(pc,cb){
  var b={widgetId:WID,visitorId:getVid(),page:location.href};
  if(pc){if(pc.name)b.name=pc.name;if(pc.email)b.email=pc.email;if(pc.phone)b.phone=pc.phone}
  fetch(API+'/widget/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)})
  .then(function(r){return r.json()}).then(function(d){
    if(d.success){st.sess=d.data;saveSess(d.data);cb(null,d.data)}
    else cb(new Error(d.error||'failed'))
  }).catch(cb)
}

function connectWS(){
  if(!st.sess||!st.sess.token||!window.io)return;
  var wsUrl=API.replace('/api/v1','');
  st.sock=io(wsUrl+'/widget',{auth:{token:st.sess.token},transports:['websocket','polling'],reconnection:true,reconnectionDelay:2000,reconnectionAttempts:15});
  st.sock.on('widget:connected',function(){});
  st.sock.on('widget:history',function(d){
    if(d.messages&&d.messages.length){
      st.msgs=d.messages.map(function(m){return{role:m.direction==='inbound'?'user':'assistant',content:m.content_text,ts:m.created_at}});
      renderMsgs()
    }
  });
  st.sock.on('widget:message',function(d){
    st.msgs.push({role:d.role||'assistant',content:d.content,ts:d.timestamp||new Date().toISOString()});
    st.typing=false;renderMsgs();renderTyping();
    if(!st.open){st.unread++;renderBadge()}
    playSound()
  });
  st.sock.on('widget:typing',function(d){st.typing=d.isTyping;renderTyping()});
  st.sock.on('widget:error',function(d){console.warn('Parallly:',d.message)});
}

function send(txt){
  if(!txt.trim()||!st.sock)return;
  st.msgs.push({role:'user',content:txt.trim(),ts:new Date().toISOString()});
  renderMsgs();
  st.sock.emit('widget:message',{content:txt.trim()})
}

function playSound(){
  try{var a=new AudioContext();var o=a.createOscillator();var g=a.createGain();o.connect(g);g.connect(a.destination);o.frequency.value=800;g.gain.value=0.1;o.start();o.stop(a.currentTime+0.1)}catch(e){}
}

/* ─── UI ─── */
var CSS=\`
:host{all:initial;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.5;color:#1a1a2e}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
.pw-wrap{position:fixed;z-index:2147483647}
.pw-wrap.pos-br{bottom:20px;right:20px}
.pw-wrap.pos-bl{bottom:20px;left:20px}

/* Bubble */
.pw-bubble{width:60px;height:60px;border-radius:50%;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(0,0,0,.25);transition:transform .2s,box-shadow .2s;position:relative}
.pw-bubble:hover{transform:scale(1.08);box-shadow:0 6px 24px rgba(0,0,0,.3)}
.pw-bubble svg{width:28px;height:28px;fill:#fff;transition:transform .3s}
.pw-bubble.open svg.ico-chat{transform:rotate(90deg) scale(0);position:absolute}
.pw-bubble.open svg.ico-close{transform:rotate(0) scale(1)}
.pw-bubble:not(.open) svg.ico-close{transform:rotate(-90deg) scale(0);position:absolute}
.pw-badge{position:absolute;top:-4px;right:-4px;min-width:20px;height:20px;border-radius:10px;background:#ff4757;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 5px;border:2px solid #fff}
.pw-badge.hidden{display:none}

/* Panel */
.pw-panel{position:absolute;bottom:72px;width:380px;max-width:calc(100vw - 32px);height:520px;max-height:calc(100vh - 100px);border-radius:16px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 8px 40px rgba(0,0,0,.2);transform:scale(.6) translateY(20px);opacity:0;pointer-events:none;transition:transform .25s cubic-bezier(.4,0,.2,1),opacity .25s;transform-origin:bottom right;background:#fff}
.pos-br .pw-panel{right:0}
.pos-bl .pw-panel{left:0;transform-origin:bottom left}
.pw-panel.show{transform:scale(1) translateY(0);opacity:1;pointer-events:auto}

/* Header */
.pw-hdr{padding:16px 18px;display:flex;align-items:center;gap:12px;color:#fff;flex-shrink:0}
.pw-avatar{width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:600;overflow:hidden;flex-shrink:0}
.pw-avatar img{width:100%;height:100%;object-fit:cover}
.pw-hdr-info{flex:1;min-width:0}
.pw-hdr-name{font-size:15px;font-weight:600}
.pw-hdr-status{font-size:12px;opacity:.85}
.pw-close{background:none;border:none;color:#fff;cursor:pointer;padding:4px;border-radius:6px;display:flex;opacity:.8}
.pw-close:hover{opacity:1;background:rgba(255,255,255,.15)}
.pw-close svg{width:20px;height:20px;fill:currentColor}

/* Messages */
.pw-msgs{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:8px;background:#f8f9fa}
.pw-msg{max-width:82%;padding:10px 14px;border-radius:14px;font-size:13px;line-height:1.5;word-wrap:break-word;white-space:pre-wrap;animation:pw-fade .2s ease-out}
.pw-msg.in{background:#fff;align-self:flex-start;border-bottom-left-radius:4px;box-shadow:0 1px 2px rgba(0,0,0,.06)}
.pw-msg.out{color:#fff;align-self:flex-end;border-bottom-right-radius:4px}
.pw-msg-time{font-size:10px;opacity:.6;margin-top:4px}
.pw-welcome{text-align:center;padding:20px;color:#666;font-size:13px}
@keyframes pw-fade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}

/* Typing */
.pw-typing{display:none;align-self:flex-start;padding:10px 16px;background:#fff;border-radius:14px;border-bottom-left-radius:4px;box-shadow:0 1px 2px rgba(0,0,0,.06)}
.pw-typing.show{display:flex;gap:4px;align-items:center}
.pw-dot{width:6px;height:6px;border-radius:50%;background:#999;animation:pw-bounce 1.2s infinite}
.pw-dot:nth-child(2){animation-delay:.2s}
.pw-dot:nth-child(3){animation-delay:.4s}
@keyframes pw-bounce{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-6px)}}

/* Input */
.pw-input-wrap{padding:12px 14px;display:flex;align-items:flex-end;gap:8px;border-top:1px solid #eee;background:#fff;flex-shrink:0}
.pw-input{flex:1;border:1px solid #ddd;border-radius:20px;padding:8px 14px;font-size:13px;font-family:inherit;resize:none;outline:none;max-height:100px;line-height:1.4;transition:border-color .2s}
.pw-input:focus{border-color:var(--pw-color,#6c5ce7)}
.pw-send{width:36px;height:36px;border-radius:50%;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:opacity .2s}
.pw-send:disabled{opacity:.4;cursor:default}
.pw-send svg{width:18px;height:18px;fill:#fff}

/* Pre-chat form */
.pw-form{padding:20px 18px;display:flex;flex-direction:column;gap:12px;flex:1;overflow-y:auto;background:#f8f9fa}
.pw-form-title{font-size:14px;font-weight:600;color:#333;margin-bottom:4px}
.pw-form-sub{font-size:12px;color:#777;margin-bottom:8px}
.pw-field{display:flex;flex-direction:column;gap:4px}
.pw-field label{font-size:12px;font-weight:500;color:#555}
.pw-field input{border:1px solid #ddd;border-radius:8px;padding:8px 12px;font-size:13px;font-family:inherit;outline:none;transition:border-color .2s}
.pw-field input:focus{border-color:var(--pw-color,#6c5ce7)}
.pw-form-btn{border:none;border-radius:8px;padding:10px;color:#fff;font-size:14px;font-weight:600;cursor:pointer;transition:opacity .2s;margin-top:8px}
.pw-form-btn:hover{opacity:.9}
.pw-form-btn:disabled{opacity:.5;cursor:default}

/* Powered by */
.pw-powered{text-align:center;padding:6px;font-size:10px;color:#aaa;background:#fff;border-top:1px solid #f0f0f0}
.pw-powered a{color:#888;text-decoration:none}
.pw-powered a:hover{text-decoration:underline}

/* Mobile */
@media(max-width:480px){
  .pw-panel{width:100vw;height:100vh;max-height:100vh;max-width:100vw;bottom:0;right:0!important;left:0!important;border-radius:0;position:fixed;top:0}
  .pw-wrap.pos-br .pw-panel,.pw-wrap.pos-bl .pw-panel{transform-origin:bottom center}
  .pw-bubble{width:54px;height:54px}
}
\`;

function build(){
  var host=document.createElement('div');host.id='parallly-widget';
  var shadow=host.attachShadow({mode:'closed'});
  document.body.appendChild(host);

  var style=document.createElement('style');
  var pc=st.cfg.primaryColor||'#6c5ce7';
  style.textContent=CSS.replace(/var\\(--pw-color,[^)]*\\)/g,pc);
  shadow.appendChild(style);

  var wrap=document.createElement('div');
  wrap.className='pw-wrap pos-'+(st.cfg.position==='bottom-left'?'bl':'br');
  wrap.style.setProperty('--pw-color',pc);
  shadow.appendChild(wrap);

  // Panel
  var panel=document.createElement('div');panel.className='pw-panel';
  wrap.appendChild(panel);

  // Header
  var hdr=document.createElement('div');hdr.className='pw-hdr';hdr.style.background=pc;
  var avatar=document.createElement('div');avatar.className='pw-avatar';
  if(st.cfg.agentAvatar){var img=document.createElement('img');img.src=st.cfg.agentAvatar;img.alt='';avatar.appendChild(img)}
  else{avatar.textContent=(st.cfg.agentName||'A').charAt(0).toUpperCase()}
  hdr.appendChild(avatar);
  var info=document.createElement('div');info.className='pw-hdr-info';
  var nm=document.createElement('div');nm.className='pw-hdr-name';nm.textContent=st.cfg.agentName||'Asistente';
  var stat=document.createElement('div');stat.className='pw-hdr-status';stat.textContent='En l\\u00EDnea';
  info.appendChild(nm);info.appendChild(stat);hdr.appendChild(info);
  var closeBtn=document.createElement('button');closeBtn.className='pw-close';
  closeBtn.innerHTML='<svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>';
  closeBtn.onclick=toggle;hdr.appendChild(closeBtn);
  panel.appendChild(hdr);

  // Pre-chat form
  if(st.cfg.preChatEnabled&&!st.pcDone){
    var form=document.createElement('div');form.className='pw-form';
    st.el.form=form;
    var ft=document.createElement('div');ft.className='pw-form-title';ft.textContent=getT('formTitle');
    var fs=document.createElement('div');fs.className='pw-form-sub';fs.textContent=getT('formSub');
    form.appendChild(ft);form.appendChild(fs);

    var fields=st.cfg.preChatFields||['name','email'];
    var inputs={};
    fields.forEach(function(f){
      var d=document.createElement('div');d.className='pw-field';
      var l=document.createElement('label');l.textContent=getT('field_'+f);
      var inp=document.createElement('input');inp.type=f==='email'?'email':f==='phone'?'tel':'text';inp.placeholder=getT('ph_'+f);
      inputs[f]=inp;d.appendChild(l);d.appendChild(inp);form.appendChild(d)
    });
    var fbtn=document.createElement('button');fbtn.className='pw-form-btn';fbtn.style.background=pc;
    fbtn.textContent=getT('start');
    fbtn.onclick=function(){
      var data={};
      fields.forEach(function(f){data[f]=inputs[f].value});
      st.pcDone=true;
      form.remove();
      buildChat(panel);
      initSess(data,function(err){
        if(!err){loadIO(connectWS)}
      })
    };
    form.appendChild(fbtn);panel.appendChild(form)
  }else{
    buildChat(panel);
  }

  // Powered by
  var pw=document.createElement('div');pw.className='pw-powered';
  pw.innerHTML='Powered by <a href="https://parallly-chat.cloud" target="_blank" rel="noopener">Parallly</a>';
  panel.appendChild(pw);

  // Bubble
  var bubble=document.createElement('button');bubble.className='pw-bubble';bubble.style.background=pc;
  bubble.innerHTML='<svg class="ico-chat" viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg><svg class="ico-close" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" stroke="#fff" stroke-width="2.5" stroke-linecap="round" fill="none"/></svg>';
  var badge=document.createElement('span');badge.className='pw-badge hidden';badge.textContent='0';
  bubble.appendChild(badge);
  bubble.onclick=toggle;
  wrap.appendChild(bubble);

  st.el.panel=panel;st.el.bubble=bubble;st.el.badge=badge;st.el.wrap=wrap;
}

function buildChat(panel){
  // Messages
  var msgs=document.createElement('div');msgs.className='pw-msgs';st.el.msgs=msgs;

  // Welcome message
  if(st.msgs.length===0&&st.cfg.welcomeMessage){
    var wm=document.createElement('div');wm.className='pw-welcome';wm.textContent=st.cfg.welcomeMessage;
    msgs.appendChild(wm);st.el.welcome=wm
  }

  // Typing
  var typ=document.createElement('div');typ.className='pw-typing';
  typ.innerHTML='<div class="pw-dot"></div><div class="pw-dot"></div><div class="pw-dot"></div>';
  msgs.appendChild(typ);st.el.typing=typ;

  panel.insertBefore(msgs,panel.querySelector('.pw-powered'));

  // Input
  var iw=document.createElement('div');iw.className='pw-input-wrap';
  var inp=document.createElement('textarea');inp.className='pw-input';inp.rows=1;inp.placeholder=getT('placeholder');
  inp.addEventListener('input',function(){this.style.height='auto';this.style.height=Math.min(this.scrollHeight,100)+'px'});
  inp.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();doSend()}});
  var sbtn=document.createElement('button');sbtn.className='pw-send';sbtn.style.background=st.cfg.primaryColor||'#6c5ce7';
  sbtn.innerHTML='<svg viewBox="0 0 24 24"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>';
  sbtn.onclick=doSend;
  iw.appendChild(inp);iw.appendChild(sbtn);
  st.el.input=inp;st.el.sendBtn=sbtn;

  panel.insertBefore(iw,panel.querySelector('.pw-powered'));

  renderMsgs()
}

function toggle(){
  st.open=!st.open;
  st.el.panel.classList.toggle('show',st.open);
  st.el.bubble.classList.toggle('open',st.open);
  if(st.open){st.unread=0;renderBadge();if(st.el.input)st.el.input.focus()}
}

function renderMsgs(){
  if(!st.el.msgs)return;
  var container=st.el.msgs;
  // Remove existing messages (keep typing indicator)
  var existing=container.querySelectorAll('.pw-msg,.pw-welcome');
  existing.forEach(function(e){e.remove()});

  if(st.el.welcome&&st.msgs.length>0&&st.el.welcome.parentNode){st.el.welcome.remove();st.el.welcome=null}

  var frag=document.createDocumentFragment();
  st.msgs.forEach(function(m){
    var d=document.createElement('div');
    d.className='pw-msg '+(m.role==='user'?'out':'in');
    if(m.role==='user')d.style.background=st.cfg.primaryColor||'#6c5ce7';
    d.textContent=m.content||'';
    var t=document.createElement('div');t.className='pw-msg-time';
    try{t.textContent=new Date(m.ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}catch(e){t.textContent=''}
    d.appendChild(t);frag.appendChild(d)
  });
  container.insertBefore(frag,st.el.typing);
  container.scrollTop=container.scrollHeight
}

function renderTyping(){if(st.el.typing){st.el.typing.classList.toggle('show',st.typing);if(st.typing)st.el.msgs.scrollTop=st.el.msgs.scrollHeight}}
function renderBadge(){if(st.el.badge){st.el.badge.textContent=st.unread;st.el.badge.classList.toggle('hidden',st.unread===0)}}

function doSend(){
  if(!st.el.input)return;
  var v=st.el.input.value;
  if(!v.trim())return;
  send(v);
  st.el.input.value='';st.el.input.style.height='auto'
}

/* i18n */
var T={
  es:{formTitle:'Antes de empezar',formSub:'Completa los datos para que podamos ayudarte mejor.',field_name:'Nombre',field_email:'Correo',field_phone:'Tel\\u00E9fono',ph_name:'Tu nombre',ph_email:'tu@correo.com',ph_phone:'+57 300 123 4567',start:'Iniciar chat',placeholder:'Escribe un mensaje...'},
  en:{formTitle:'Before we start',formSub:'Fill in your details so we can help you better.',field_name:'Name',field_email:'Email',field_phone:'Phone',ph_name:'Your name',ph_email:'you@email.com',ph_phone:'+1 555 123 4567',start:'Start chat',placeholder:'Type a message...'},
  pt:{formTitle:'Antes de come\\u00E7ar',formSub:'Preencha seus dados para que possamos ajud\\u00E1-lo melhor.',field_name:'Nome',field_email:'E-mail',field_phone:'Telefone',ph_name:'Seu nome',ph_email:'voce@email.com',ph_phone:'+55 11 9999 0000',start:'Iniciar chat',placeholder:'Digite uma mensagem...'},
  fr:{formTitle:'Avant de commencer',formSub:'Remplissez vos informations pour que nous puissions mieux vous aider.',field_name:'Nom',field_email:'E-mail',field_phone:'T\\u00E9l\\u00E9phone',ph_name:'Votre nom',ph_email:'vous@email.com',ph_phone:'+33 6 12 34 56 78',start:'D\\u00E9marrer le chat',placeholder:'\\u00C9crivez un message...'}
};
function getT(k){var l=(st.cfg&&st.cfg.locale)||'es';return(T[l]||T.es)[k]||k}

/* ─── INIT ─── */
function init(){
  fetchCfg(function(err,cfg){
    if(err)return console.warn('Parallly widget: config error');
    if(cfg.preChatEnabled){
      build();
      var saved=getSess();
      if(saved&&saved.token){st.pcDone=true}
      if(st.pcDone){initSess(null,function(e){if(!e)loadIO(connectWS)})}
    }else{
      build();
      initSess(null,function(e){if(!e)loadIO(connectWS)})
    }
  })
}

if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',init)}else{init()}
})();`;
}
