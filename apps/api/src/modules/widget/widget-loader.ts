export function getLoaderScript(apiBase: string): string {
    return `(function(){
'use strict';
var C=window.__paralllyWidget||{};var WID=C.widgetId;if(!WID)return;

var API='${apiBase}';
var SK='parallly_w_'+WID;
var IO_CDN='https://cdn.socket.io/4.8.1/socket.io.min.js';
// One mounted snippet per API/origin/widget, including concurrent config fetches.
var widgetOwnerKey=String(location.origin||'')+'|'+API+'|'+WID;
var widgetOwners=window.__paralllyWidgetOwners||(window.__paralllyWidgetOwners=Object.create(null));
if(widgetOwners[widgetOwnerKey])return;
var widgetOwner={};widgetOwners[widgetOwnerKey]=widgetOwner;
function releaseWidgetOwner(){if(widgetOwners[widgetOwnerKey]===widgetOwner)delete widgetOwners[widgetOwnerKey];if(window.removeEventListener)window.removeEventListener('pagehide',releaseWidgetOwner)}
if(window.addEventListener)window.addEventListener('pagehide',releaseWidgetOwner);

// page: rendered inline inside a host element (C.mode==='page'); capped: composer locked by a server cap notice;
// retryTimer: the single pending auto-retry after a rate limit (see scheduleRetry).
var st={open:false,cfg:null,sess:null,sock:null,msgs:[],unread:0,typing:false,pcDone:false,page:false,capped:false,retryTimer:null,el:{}};
var triggerEngine=null;

function loadIO(cb){if(window.io)return cb();var s=document.createElement('script');s.src=IO_CDN;s.onload=cb;s.onerror=function(){console.error('Parallly widget: socket.io load failed')};document.head.appendChild(s)}

function getVid(){var k=SK+'_vid';var v=localStorage.getItem(k);if(!v){v='v_'+Math.random().toString(36).substr(2,12)+Date.now().toString(36);localStorage.setItem(k,v)}return v}
function getSess(){try{var s=localStorage.getItem(SK);return s?JSON.parse(s):null}catch(e){return null}}
function saveSess(s){try{localStorage.setItem(SK,JSON.stringify(s))}catch(e){}}
function setConnectionStatus(status){if(st.el.status)st.el.status.textContent=getT(status)}

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
      if(d.success){st.sess=Object.assign({},saved,d.data);bindTriggerSession(st.sess);cb(null,st.sess)}
      else newSess(pc,cb)
    }).catch(function(){newSess(pc,cb)})
  }else newSess(pc,cb)
}

function newSess(pc,cb){
  var b={widgetId:WID,visitorId:getVid(),page:location.href};
  var prior=getSess();if(prior&&prior.token)b.resumeToken=prior.token;
  if(pc){if(pc.name)b.name=pc.name;if(pc.email)b.email=pc.email;if(pc.phone)b.phone=pc.phone}
  fetch(API+'/widget/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)})
  .then(function(r){return r.json()}).then(function(d){
    if(d.success){st.sess=d.data;saveSess(d.data);bindTriggerSession(st.sess);cb(null,d.data)}
    else cb(new Error(d.error||'failed'))
  }).catch(cb)
}

function connectWS(){
  if(!st.sess||!st.sess.token||!window.io)return;
  setConnectionStatus('connecting');
  var wsUrl=API.replace('/api/v1','');
  st.sock=io(wsUrl+'/widget',{auth:{token:st.sess.token},transports:['websocket','polling'],reconnection:true,reconnectionDelay:2000,reconnectionAttempts:15});
  st.sock.on('widget:connected',function(d){if(d&&st.sess&&typeof d.sessionId==='string'&&d.sessionId===st.sess.sessionId)setConnectionStatus('connected')});
  // A (re)connect ends a cap lock: the server decides again whether the next message goes through.
  st.sock.on('connect',function(){setConnectionStatus('connecting');clearRetry();if(st.capped)setComposer(true)});
  st.sock.on('widget:history',function(d){
    (d.messages||[]).forEach(function(m){mergeWidgetMessage(m)});renderMsgs();
    (d.messages||[]).forEach(ackWidgetMessage)
  });
  st.sock.on('widget:message',function(d){
    var added=mergeWidgetMessage(d);st.typing=false;renderMsgs();renderTyping();ackWidgetMessage(d);
    if(added){if(!st.open){st.unread++;renderBadge()}playSound()}
    if(st.capped){clearRetry();setComposer(true)}
  });
  // Streaming (#6 Fase-2): the assistant reply arrives token-by-token.
  st.sock.on('widget:stream_start',function(d){
    st.streamingId=d.messageId;
    var old=findWidgetMessage(d.messageId);if(old){old.streaming=true;old.content=''}else st.msgs.push({id:d.messageId,role:d.role||'assistant',content:'',ts:d.timestamp||new Date().toISOString(),streaming:true});
    st.typing=false;renderMsgs();renderTyping();
  });
  st.sock.on('widget:stream_chunk',function(d){
    var last=findWidgetMessage(d.messageId||st.streamingId);
    if(last&&last.streaming){last.content+=d.delta;renderMsgs();}
  });
  st.sock.on('widget:stream_end',function(d){
    var last=findWidgetMessage(d.messageId||st.streamingId);
    if(last&&last.streaming){last.content=d.content||last.content;last.streaming=false;}
    st.streamingId=null;renderMsgs();
    if(!st.open){st.unread++;renderBadge()}
    playSound()
  });
  st.sock.on('widget:stream_error',function(d){
    var last=findWidgetMessage(d.messageId||st.streamingId);
    if(last&&last.streaming){last.streaming=false;if(!last.content){last.content='⚠️';}}
    st.streamingId=null;renderMsgs();
  });
  // Delivery ack: the server persisted the visitor's message. Until this
  // arrives the bubble stays 'pending' - socket.io drops its send buffer
  // once reconnection attempts run out, so an un-acked message never made it.
  st.sock.on('widget:message-received',function(d){
    for(var i=st.msgs.length-1;i>=0;i--){
      var m=st.msgs[i];
      if(m.role==='user'&&m.pending&&m.content===d.content){m.pending=false;m.id=d.id;break}
    }
    renderMsgs()
  });
  // Anything still pending when the socket dies was never delivered.
  st.sock.on('disconnect',function(){setConnectionStatus('disconnected');markPendingFailed()});
  st.sock.on('connect_error',function(){setConnectionStatus('disconnected')});
  st.sock.io.on('reconnect_failed',function(){setConnectionStatus('disconnected');markPendingFailed()});
  st.sock.on('widget:typing',function(d){st.typing=d.isTyping;renderTyping()});
  st.sock.on('widget:error',onWidgetError);
}

// Caps the visitor must see in the chat (the server already localised d.message for the demo codes).
// Anything else stays a console warning: it is a developer signal, not a visitor-facing state.
var CAP_CODES={demo_daily_cap:1,demo_allowance_exhausted:1,rate_limited:1};
// A rate limit never reaches the visitor in their language: the server sends a hardcoded
// English 'Rate limit exceeded'. Say it ourselves, and wait out the window it reported.
var MAX_RETRY_MS=60000;
function onWidgetError(d){
  d=d||{};
  if(!CAP_CODES[d.code]){console.warn('Parallly:',d.message);return}
  var limited=d.code==='rate_limited';
  var text=limited?getT('rateLimited'):((typeof d.message==='string'&&d.message.trim())?d.message.trim():getT('capReached'));
  // The server refused this turn BEFORE persisting it, and on a cap it does not even hang up:
  // without this the visitor's own bubble would spin on '↻' forever under a notice saying the chat stopped.
  markPendingFailed();
  pushSystemNotice(text);
  setComposer(false);
  // Only rate_limited ends in a server-initiated disconnect, and socket.io never reconnects
  // from one of those on its own - the composer would stay dead for good. The demo caps keep
  // the socket, so their unlock stays where it was: the next 'connect' or agent message.
  if(limited)scheduleRetry(d.retryAfterSeconds)
}
function clearRetry(){if(st.retryTimer){clearTimeout(st.retryTimer);st.retryTimer=null}}
function scheduleRetry(seconds){
  clearRetry();
  // No usable window (absent, null, NaN, Infinity) means no automatic retry: a 'connect' or the
  // next agent message is still allowed to unlock, but nothing here guesses when that is.
  if(typeof seconds!=='number'||!isFinite(seconds)||seconds<0)return;
  // The server reports the whole window (an hour for the per-IP rule); nobody stares at a dead
  // composer that long, so we retry sooner and let the server refuse again if it still wants to.
  st.retryTimer=setTimeout(function(){
    st.retryTimer=null;
    setComposer(true);
    if(st.sock&&typeof st.sock.connect==='function')st.sock.connect()
  },Math.min(seconds*1000,MAX_RETRY_MS))
}
// A system notice is not an agent message: no id, no ack, never merged/deduped by identity, never sent back.
function pushSystemNotice(text){
  var last=st.msgs[st.msgs.length-1];
  if(last&&last.role==='system'&&last.content===text){renderMsgs();return}
  st.msgs.push({role:'system',content:text,ts:new Date().toISOString()});
  renderMsgs()
}
function setComposer(enabled){
  st.capped=!enabled;
  if(st.el.input)st.el.input.disabled=!enabled;
  if(st.el.sendBtn)st.el.sendBtn.disabled=!enabled
}

function findWidgetMessage(id){if(!id)return null;for(var i=0;i<st.msgs.length;i++)if(st.msgs[i].id===id)return st.msgs[i];return null}
function mergeWidgetMessage(d){
  var id=d.messageId||d.id;var role=d.role||(d.direction==='inbound'?'user':'assistant');
  var found=findWidgetMessage(id);var value={id:id,role:role,content:d.content!=null?d.content:d.content_text,
    type:d.type||d.content_type||'text',mediaUrl:d.mediaUrl||d.media_url,caption:d.caption,filename:d.filename,
    ts:d.timestamp||d.created_at||new Date().toISOString(),pending:false,streaming:false};
  if(found){Object.assign(found,value);return false}
  if(!id){var last=st.msgs[st.msgs.length-1];if(last&&last.role===role&&last.content===value.content)return false}
  st.msgs.push(value);st.msgs.sort(function(a,b){return new Date(a.ts)-new Date(b.ts)});return true
}
function ackWidgetMessage(d){var id=d.messageId||d.id;if(d.receiptRequired&&id&&st.sock)st.sock.emit('widget:received',{messageId:id})}

function markPendingFailed(){
  var changed=false;
  for(var i=0;i<st.msgs.length;i++){
    if(st.msgs[i].role==='user'&&st.msgs[i].pending){st.msgs[i].pending=false;st.msgs[i].failed=true;changed=true}
  }
  if(changed)renderMsgs()
}

function send(txt){
  if(st.capped||!txt.trim()||!st.sock)return;
  // pending until the server acks it - previously every message rendered as
  // delivered even when it was silently dropped by a dead socket.
  st.msgs.push({role:'user',content:txt.trim(),ts:new Date().toISOString(),pending:true});
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
.pw-msg.sys{align-self:center;max-width:90%;padding:6px 12px;border-radius:10px;background:#eceef2;color:#6b7280;font-size:11px;line-height:1.4;text-align:center;box-shadow:none}
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
.pw-input:disabled{background:#f3f4f6;color:#9ca3af;cursor:not-allowed}
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

/* Page mode: the panel IS the page. It sits statically inside the host and fills it (the host
   sets the height); no launcher, no close control. The two-class selectors outrank the mobile
   full-screen rule above, so the same DOM reads inline at every width. */
:host(.pw-page-host){display:block;width:100%;height:100%}
.pw-wrap.pw-page{position:static;width:100%;height:100%;z-index:auto}
.pw-page .pw-panel{position:static;width:100%;max-width:none;height:100%;max-height:none;border-radius:0;box-shadow:none;transform:none;opacity:1;pointer-events:auto;transition:none}
.pw-page .pw-close,.pw-page .pw-bubble,.pw-page .pw-badge{display:none}
\`;

// Page mode mounts inside window.__paralllyWidget.host (default '#parallly-widget-host').
// A missing or invalid host is not an error: the widget falls back to the floating bubble on body.
function pageHost(){
  if(C.mode!=='page')return null;
  try{return document.querySelector(C.host||'#parallly-widget-host')||null}catch(e){return null}
}

function build(){
  var mount=pageHost();st.page=!!mount;
  var host=document.createElement('div');host.id='parallly-widget';
  // Inline styles on the host outrank the shadow's :host{all:initial}, so the block fills the mount.
  if(st.page){host.className='pw-page-host';host.style.display='block';host.style.width='100%';host.style.height='100%'}
  var shadow=host.attachShadow({mode:'closed'});
  (mount||document.body).appendChild(host);

  var style=document.createElement('style');
  var pc=st.cfg.primaryColor||'#6c5ce7';
  style.textContent=CSS.replace(/var\\(--pw-color,[^)]*\\)/g,pc);
  shadow.appendChild(style);

  var wrap=document.createElement('div');
  wrap.className='pw-wrap pos-'+(st.cfg.position==='bottom-left'?'bl':'br')+(st.page?' pw-page':'');
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
  var stat=document.createElement('div');stat.className='pw-hdr-status';stat.textContent=getT('connecting');st.el.status=stat;
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
    var ferr=document.createElement('div');ferr.className='pw-form-error';ferr.setAttribute('role','alert');ferr.hidden=true;
    var pending=false;
    fbtn.onclick=function(){
      if(pending)return;
      var data={};
      fields.forEach(function(f){data[f]=inputs[f].value});
      pending=true;fbtn.disabled=true;ferr.hidden=true;ferr.textContent='';setConnectionStatus('connecting');
      initSess(data,function(err){
        if(err){pending=false;fbtn.disabled=false;ferr.textContent=getT('sessionError');ferr.hidden=false;setConnectionStatus('disconnected');return}
        st.pcDone=true;form.remove();st.el.form=null;buildChat(panel);loadIO(connectWS)
      })
    };
    form.appendChild(ferr);form.appendChild(fbtn);panel.appendChild(form)
  }else{
    buildChat(panel);
  }

  // Powered by
  var pw=document.createElement('div');pw.className='pw-powered';
  pw.innerHTML='Powered by <a href="https://parallly-chat.cloud" target="_blank" rel="noopener">Parallly</a>';
  panel.appendChild(pw);

  // Bubble (floating mode only: in page mode the panel is the page, so there is nothing to launch)
  var bubble=null,badge=null;
  if(!st.page){
    bubble=document.createElement('button');bubble.className='pw-bubble';bubble.style.background=pc;
    bubble.innerHTML='<svg class="ico-chat" viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg><svg class="ico-close" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" stroke="#fff" stroke-width="2.5" stroke-linecap="round" fill="none"/></svg>';
    badge=document.createElement('span');badge.className='pw-badge hidden';badge.textContent='0';
    bubble.appendChild(badge);
    bubble.onclick=toggle;
    wrap.appendChild(bubble);
  }

  st.el.panel=panel;st.el.bubble=bubble;st.el.badge=badge;st.el.wrap=wrap;
  if(st.page){st.open=true;panel.classList.add('show')}
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
  setWidgetOpen(!st.open,true)
}
function setWidgetOpen(open,focus){
  if(st.page||st.open===open)return false;
  st.open=open;
  st.el.panel.classList.toggle('show',st.open);
  st.el.bubble.classList.toggle('open',st.open);
  if(st.open){st.unread=0;renderBadge();if(focus&&st.el.input)st.el.input.focus()}
  return true
}

function renderMsgs(){
  if(!st.el.msgs)return;
  var container=st.el.msgs;
  // Remove existing messages (keep typing indicator)
  var existing=container.querySelectorAll('.pw-msg');
  existing.forEach(function(e){e.remove()});

  if(st.el.welcome&&st.msgs.length>0&&st.el.welcome.parentNode){st.el.welcome.remove();st.el.welcome=null}

  var frag=document.createDocumentFragment();
  st.msgs.forEach(function(m){
    var d=document.createElement('div');
    // Server notices (caps, rate limits) are not agent messages: muted, centred, no timestamp.
    if(m.role==='system'){d.className='pw-msg sys';d.textContent=m.content||'';frag.appendChild(d);return}
    d.className='pw-msg '+(m.role==='user'?'out':'in');
    if(m.role==='user')d.style.background=st.cfg.primaryColor||'#6c5ce7';
    d.textContent=m.caption||((m.mediaUrl&&m.content===m.mediaUrl)?'':m.content)||'';
    if(m.mediaUrl){
      try{var u=new URL(m.mediaUrl);if(u.protocol==='https:'&&!u.username&&!u.password){
        var media;if(m.type==='image'){media=document.createElement('img');media.src=u.href;media.alt=m.caption||'';media.style.maxWidth='100%';media.style.borderRadius='8px'}
        else if(m.type==='audio'||m.type==='video'){media=document.createElement(m.type);media.src=u.href;media.controls=true;media.style.maxWidth='100%'}
        else{media=document.createElement('a');media.href=u.href;media.textContent=m.filename||u.href;media.target='_blank';media.rel='noopener noreferrer'}
        d.appendChild(media)
      }}catch(e){}
    }else if(m.content){
      try{var link=new URL(m.content.trim());if(link.protocol==='https:'&&!link.username&&!link.password){
        var anchor=document.createElement('a');anchor.href=link.href;anchor.textContent=m.content;anchor.target='_blank';anchor.rel='noopener noreferrer';d.textContent='';d.appendChild(anchor)
      }}catch(e){}
    }
    if(m.pending)d.style.opacity='0.6';
    if(m.failed)d.style.opacity='0.6';
    var t=document.createElement('div');t.className='pw-msg-time';
    try{t.textContent=new Date(m.ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}catch(e){t.textContent=''}
    // Visitors must be able to tell 'delivered' from 'never left the browser'.
    if(m.pending)t.textContent+=' · ↻';
    if(m.failed)t.textContent+=' · ⚠ no enviado';
    d.appendChild(t);frag.appendChild(d)
  });
  container.insertBefore(frag,st.el.typing);
  container.scrollTop=container.scrollHeight
}

function renderTyping(){if(st.el.typing){st.el.typing.classList.toggle('show',st.typing);if(st.typing)st.el.msgs.scrollTop=st.el.msgs.scrollHeight}}
function renderBadge(){if(st.page||!st.el.badge)return;st.el.badge.textContent=st.unread;st.el.badge.classList.toggle('hidden',st.unread===0)}

function doSend(){
  if(!st.el.input||st.capped)return;
  var v=st.el.input.value;
  if(!v.trim())return;
  send(v);
  st.el.input.value='';st.el.input.style.height='auto'
}

/* i18n */
var T={
  es:{connecting:'Conectando el chat…',connected:'Chat conectado',disconnected:'Chat desconectado',sessionError:'No pudimos iniciar el chat. Inténtalo de nuevo.',formTitle:'Antes de empezar',formSub:'Completa los datos para que podamos ayudarte mejor.',field_name:'Nombre',field_email:'Correo',field_phone:'Tel\\u00E9fono',ph_name:'Tu nombre',ph_email:'tu@correo.com',ph_phone:'+57 300 123 4567',start:'Iniciar chat',placeholder:'Escribe un mensaje...',capReached:'Este chat alcanz\\u00F3 su l\\u00EDmite por hoy. Vuelve ma\\u00F1ana.',rateLimited:'Est\\u00E1s enviando mensajes muy r\\u00E1pido. Espera un momento e int\\u00E9ntalo de nuevo.'},
  en:{connecting:'Connecting chat…',connected:'Chat connected',disconnected:'Chat disconnected',sessionError:'Unable to start the chat. Please try again.',formTitle:'Before we start',formSub:'Fill in your details so we can help you better.',field_name:'Name',field_email:'Email',field_phone:'Phone',ph_name:'Your name',ph_email:'you@email.com',ph_phone:'+1 555 123 4567',start:'Start chat',placeholder:'Type a message...',capReached:'This chat reached its limit for today. Come back tomorrow.',rateLimited:'You are sending messages too quickly. Wait a moment and try again.'},
  pt:{connecting:'Conectando o chat…',connected:'Chat conectado',disconnected:'Chat desconectado',sessionError:'Não foi possível iniciar o chat. Tente novamente.',formTitle:'Antes de come\\u00E7ar',formSub:'Preencha seus dados para que possamos ajud\\u00E1-lo melhor.',field_name:'Nome',field_email:'E-mail',field_phone:'Telefone',ph_name:'Seu nome',ph_email:'voce@email.com',ph_phone:'+55 11 9999 0000',start:'Iniciar chat',placeholder:'Digite uma mensagem...',capReached:'Este chat atingiu o limite de hoje. Volte amanh\\u00E3.',rateLimited:'Voc\\u00EA est\\u00E1 enviando mensagens muito r\\u00E1pido. Aguarde um momento e tente novamente.'},
  fr:{connecting:'Connexion du chat…',connected:'Chat connecté',disconnected:'Chat déconnecté',sessionError:'Impossible de démarrer le chat. Réessayez.',formTitle:'Avant de commencer',formSub:'Remplissez vos informations pour que nous puissions mieux vous aider.',field_name:'Nom',field_email:'E-mail',field_phone:'T\\u00E9l\\u00E9phone',ph_name:'Votre nom',ph_email:'vous@email.com',ph_phone:'+33 6 12 34 56 78',start:'D\\u00E9marrer le chat',placeholder:'\\u00C9crivez un message...',capReached:'Ce chat a atteint sa limite pour aujourd\\'hui. Revenez demain.',rateLimited:'Vous envoyez des messages trop rapidement. Attendez un instant et r\\u00E9essayez.'}
};
function getT(k){var l=(st.cfg&&st.cfg.locale)||'es';return(T[l]||T.es)[k]||k}

/* Proactive triggers: local browser effects only. This engine never starts a
 * session, reconnects a socket, sends a message, or treats a notice as history.
 * Session identity comes only from the existing normal session callback.
 */
function triggerNow(){return window.performance.now()}
function triggerInteger(value,min,max){return typeof value==='number'&&Number.isFinite(value)&&Math.floor(value)===value&&value>=min&&(max===undefined||value<=max)}
function triggerRead(key){try{var raw=localStorage.getItem(key);return{ok:true,raw:raw,value:raw===null?null:JSON.parse(raw)}}catch(e){return{ok:false,raw:null,value:null}}}
function triggerWrite(key,value){try{var raw=JSON.stringify(value);localStorage.setItem(key,raw);return localStorage.getItem(key)===raw}catch(e){return false}}
function triggerCondition(condition){
  if(!condition||typeof condition!=='object'||Array.isArray(condition))return null;
  var type=condition.type,value=condition.value,operator=condition.operator;
  if(type==='page_url'){
    if(['contains','equals','starts_with'].indexOf(operator)<0||typeof value!=='string'||!value.trim())return null;
    return{type:type,operator:operator,value:value}
  }
  if(type==='visit_count'){
    if(['gte','eq','lte'].indexOf(operator)<0||!triggerInteger(value,1,Number.MAX_SAFE_INTEGER))return null;
    return{type:type,operator:operator,value:value}
  }
  if(operator!==undefined&&operator!==null&&operator!=='')return null;
  if(type==='time_on_page'&&triggerInteger(value,1,Number.MAX_SAFE_INTEGER))return{type:type,value:value};
  if(type==='scroll_depth'&&triggerInteger(value,1,100))return{type:type,value:value};
  if(type==='exit_intent'&&(value===undefined||value===null))return{type:type};
  return null
}
function triggerRule(input){
  if(!input||!Array.isArray(input.conditions)||!input.conditions.length||['AND','OR'].indexOf(input.condition_operator)<0)return null;
  if(!triggerInteger(input.frequency_minutes,0,Number.MAX_SAFE_INTEGER)||!triggerInteger(input.priority,-Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER))return null;
  var conditions=[],seen=Object.create(null);
  for(var i=0;i<input.conditions.length;i++){
    var condition=triggerCondition(input.conditions[i]);if(!condition)return null;
    var serial=JSON.stringify(condition);if(!seen[serial]){seen[serial]=true;conditions.push(condition)}
  }
  conditions.sort(function(a,b){var x=JSON.stringify(a),y=JSON.stringify(b);return x<y?-1:x>y?1:0});
  var action=input.action_type,source=input.action_config,config={};
  if(!source||typeof source!=='object'||Array.isArray(source))return null;
  if(action==='show_bubble_message'||action==='show_banner'){
    if(typeof source.message!=='string'||!source.message.trim())return null;config.message=source.message.trim();
    if(action==='show_banner'){
      if(['top','bottom'].indexOf(source.position)<0||typeof source.bgColor!=='string'||!/^#[0-9a-f]{6}$/i.test(source.bgColor))return null;
      config.position=source.position;config.bgColor=source.bgColor.toLowerCase()
    }
  }else if(action!=='open_widget')return null;
  var canonical=JSON.stringify({conditions:conditions,condition_operator:input.condition_operator,action_type:action,action_config:config});
  return{conditions:conditions,operator:input.condition_operator,action:action,config:config,canonical:canonical,frequency:input.frequency_minutes,priority:input.priority,hash:null}
}
function triggerCloseLabel(){var locale=(st.cfg&&st.cfg.locale)||'es';return({es:'Cerrar aviso',en:'Close notice',pt:'Fechar aviso',fr:'Fermer l’avis'})[locale]||'Cerrar aviso'}
function triggerNoticeRemove(engine,type){
  var old=engine.notices[type];if(!old)return;
  var root=st.el.wrap&&st.el.wrap.getRootNode(),active=root&&root.activeElement;
  var restore=active&&old.node.contains(active);old.node.remove();engine.notices[type]=null;
  if(restore){var target=st.el.bubble||st.el.input||st.el.panel;if(target&&typeof target.focus==='function')target.focus()}
}
function triggerNotice(engine,rule){
  var type=rule.action,old=engine.notices[type];
  if(old&&old.canonical===rule.canonical&&old.node.parentNode)return false;
  var notice=document.createElement('div');notice.setAttribute('role','status');
  notice.style.boxSizing='border-box';notice.style.padding='12px 40px 12px 14px';notice.style.borderRadius='10px';
  notice.style.font='14px/1.45 system-ui,sans-serif';notice.style.boxShadow='0 4px 24px rgba(0,0,0,.18)';notice.style.color='#fff';
  notice.style.zIndex='2147483646';notice.style.overflowWrap='anywhere';
  if(type==='show_banner'){
    notice.style.position='fixed';notice.style.left='0';notice.style.right='0';notice.style[rule.config.position]='0';
    notice.style.backgroundColor=rule.config.bgColor;notice.style.borderRadius='0';
  }else{
    notice.style.backgroundColor=st.cfg.primaryColor||'#6c5ce7';notice.style.maxWidth='280px';
    if(st.page){notice.style.position='relative';notice.style.marginBottom='10px'}
    else{notice.style.position='absolute';notice.style.width='280px';notice.style.maxWidth='calc(100vw - 40px)';notice.style.bottom='76px';notice.style[st.cfg.position==='bottom-left'?'left':'right']='0'}
  }
  var message=document.createElement('span');message.textContent=rule.config.message;notice.appendChild(message);
  var close=document.createElement('button');close.type='button';close.setAttribute('aria-label',triggerCloseLabel());close.textContent='×';
  close.style.position='absolute';close.style.right='8px';close.style.top='8px';close.style.border='0';close.style.background='transparent';
  close.style.color='inherit';close.style.fontSize='20px';close.style.cursor='pointer';
  close.onclick=function(event){if(event)event.stopPropagation();triggerNoticeRemove(engine,type)};notice.appendChild(close);
  triggerNoticeRemove(engine,type);
  if(st.page&&type==='show_bubble_message')st.el.wrap.insertBefore(notice,st.el.panel);else st.el.wrap.appendChild(notice);
  engine.notices[type]={node:notice,canonical:rule.canonical};return true
}
function bindTriggerSession(session){if(triggerEngine&&session&&typeof session.sessionId==='string'&&session.sessionId)triggerEngine.bindSession(session.sessionId)}
function startTriggers(){
  if(!st.cfg||!Array.isArray(st.cfg.triggers)||!st.cfg.triggers.length)return;
  var scope=String(location.origin||'')+'|'+API+'|'+WID;
  var registry=window.__paralllyTriggerDocuments||(window.__paralllyTriggerDocuments=Object.create(null));
  var documentState=registry[scope];
  if(!documentState){
    var visitKey='parallly_trigger_v1:'+encodeURIComponent(scope)+':visits',prior=triggerRead(visitKey),visits=null;
    if(prior.ok&&(prior.value===null||(prior.value.v===1&&triggerInteger(prior.value.count,0,Number.MAX_SAFE_INTEGER-1)))){
      var count=prior.value===null?1:prior.value.count+1;if(triggerWrite(visitKey,{v:1,count:count}))visits=count;
    }
    documentState=registry[scope]={visits:visits,provisional:'provisional:'+Date.now().toString(36)+':'+Math.random().toString(36).slice(2),engine:null};
  }
  if(documentState.engine&&!documentState.engine.dead)return;
  if(!window.performance||typeof window.performance.now!=='function')return;
  var saved=getSess(),engine={dead:false,ready:false,rules:[],scope:'parallly_trigger_v1:'+encodeURIComponent(scope),
    session:documentState.provisional,provisional:true,waiting:!st.cfg.preChatEnabled||!!(saved&&saved.token),
    start:triggerNow(),href:String(location.href),scroll:0,exit:false,pending:null,timeTimer:null,hrefTimer:null,
    frequency:Object.create(null),migrationBlocked:Object.create(null),notices:Object.create(null),listeners:[]};
  triggerEngine=engine;documentState.engine=engine;
  function key(rule,session){return engine.scope+':frequency:'+encodeURIComponent(session)+':'+rule.hash}
  function recordValid(record,rule){return record&&record.v===1&&record.hash===rule.hash&&record.canonical===rule.canonical&&typeof record.at==='number'&&Number.isFinite(record.at)}
  function frequencyState(rule){
    var name=key(rule,engine.session);if(engine.migrationBlocked[name])return{ok:false};
    if(engine.frequency[name])return engine.frequency[name];
    var record=triggerRead(name),state={ok:record.ok,raw:record.raw,record:record.value,deadline:0};
    if(record.value!==null&&!recordValid(record.value,rule))state.ok=false;
    if(state.ok&&record.value!==null&&rule.frequency>0){
      var period=rule.frequency*60000;
      state.deadline=triggerNow()+Math.max(0,Math.min(period,period-(Date.now()-record.value.at)));
    }
    engine.frequency[name]=state;return state
  }
  function frequencyAllows(rule){var state=frequencyState(rule);return state.ok&&(state.record===null||(rule.frequency>0&&triggerNow()>=state.deadline))}
  function reserve(rule){
    var state=frequencyState(rule);if(!frequencyAllows(rule))return null;
    var reservation={v:1,hash:rule.hash,canonical:rule.canonical,at:Date.now()},name=key(rule,engine.session);
    if(!triggerWrite(name,reservation)){state.ok=false;return null}
    var previous={raw:state.raw,record:state.record,deadline:state.deadline};
    state.raw=JSON.stringify(reservation);state.record=reservation;state.deadline=triggerNow()+rule.frequency*60000;
    return{state:state,previous:previous,key:name}
  }
  function release(reservation){
    if(!reservation)return;
    try{
      if(reservation.previous.raw===null)localStorage.removeItem(reservation.key);else localStorage.setItem(reservation.key,reservation.previous.raw);
      if(localStorage.getItem(reservation.key)!==reservation.previous.raw){reservation.state.ok=false;return}
      reservation.state.raw=reservation.previous.raw;reservation.state.record=reservation.previous.record;reservation.state.deadline=reservation.previous.deadline;
    }catch(e){reservation.state.ok=false}
  }
  engine.bindSession=function(session){
    if(engine.dead)return;
    if(!engine.provisional&&engine.session===session){engine.waiting=false;queue();return}
    if(engine.provisional){
      engine.rules.forEach(function(rule){
        var old=triggerRead(key(rule,engine.session)),nextKey=key(rule,session),next=triggerRead(nextKey);
        if(!old.ok||!next.ok||(old.value!==null&&!recordValid(old.value,rule))||(next.value!==null&&!recordValid(next.value,rule))){engine.migrationBlocked[nextKey]=true;return}
        if(old.value!==null){
          var merged=next.value&&next.value.at>old.value.at?next.value:old.value;
          if(!triggerWrite(nextKey,merged))engine.migrationBlocked[nextKey]=true;
        }
      });
    }
    engine.session=session;engine.provisional=false;engine.waiting=false;engine.frequency=Object.create(null);queue()
  };
  function sampleScroll(){
    var html=document.documentElement,body=document.body;
    var height=Math.max(html?html.scrollHeight:0,body?body.scrollHeight:0),viewport=window.innerHeight||(html?html.clientHeight:0);
    var denominator=height-viewport,top=Math.max(window.scrollY||0,window.pageYOffset||0,html?html.scrollTop:0,body?body.scrollTop:0);
    var percent=denominator>0?Math.min(100,Math.max(0,100*top/denominator)):0;engine.scroll=Math.max(engine.scroll,percent)
  }
  function matches(condition){
    if(condition.type==='page_url'){
      var href=String(location.href),value=condition.value;
      return condition.operator==='equals'?href===value:condition.operator==='starts_with'?href.indexOf(value)===0:href.indexOf(value)>=0
    }
    if(condition.type==='time_on_page')return triggerNow()-engine.start>=condition.value*1000;
    if(condition.type==='scroll_depth')return engine.scroll>=condition.value;
    if(condition.type==='exit_intent')return engine.exit;
    if(condition.type==='visit_count'){
      var count=documentState.visits;if(count===null)return false;
      return condition.operator==='eq'?count===condition.value:condition.operator==='lte'?count<=condition.value:count>=condition.value
    }
    return false
  }
  function ruleMatches(rule){return rule.operator==='AND'?rule.conditions.every(matches):rule.conditions.some(matches)}
  function applicable(rule){
    if(rule.action==='open_widget')return !st.page&&!st.open;
    var old=engine.notices[rule.action];return !(old&&old.node.parentNode&&old.canonical===rule.canonical)
  }
  function armTime(){
    if(engine.timeTimer!==null){clearTimeout(engine.timeTimer);engine.timeTimer=null}
    var next=Infinity,elapsed=triggerNow()-engine.start;
    engine.rules.forEach(function(rule){rule.conditions.forEach(function(condition){if(condition.type==='time_on_page'&&condition.value*1000>elapsed)next=Math.min(next,condition.value*1000-elapsed)})});
    // Native browser timers clamp very large delays; chunk them conservatively
    // rather than turning a valid far-future threshold into a1ms busy loop.
    if(next!==Infinity)engine.timeTimer=setTimeout(function(){engine.timeTimer=null;queue()},Math.min(next,2147483647))
  }
  function evaluate(){
    engine.pending=null;if(engine.dead||!engine.ready)return;
    // A host pushState need not emit popstate. Reconcile before reading any
    // time/scroll/exit condition, even if another event beats the500ms poll.
    resetContextIfChanged();
    sampleScroll();
    if(!engine.waiting){
      for(var i=0;i<engine.rules.length;i++){
        var rule=engine.rules[i];if(!ruleMatches(rule)||!applicable(rule)||!frequencyAllows(rule))continue;
        var reservation=reserve(rule);if(!reservation)continue;
        var changed=false;
        try{changed=rule.action==='open_widget'?setWidgetOpen(true,false):triggerNotice(engine,rule)}catch(e){changed=false}
        if(changed)break;release(reservation)
      }
    }
    armTime()
  }
  function queue(){if(!engine.dead&&engine.ready&&engine.pending===null)engine.pending=setTimeout(evaluate,0)}
  function resetContextIfChanged(){
    var href=String(location.href);if(href===engine.href)return false;
    engine.href=href;engine.start=triggerNow();engine.scroll=0;engine.exit=false;return true
  }
  function context(){resetContextIfChanged();queue()}
  function listen(target,name,handler){target.addEventListener(name,handler);engine.listeners.push([target,name,handler])}
  function stop(){
    if(engine.dead)return;engine.dead=true;
    if(engine.pending!==null)clearTimeout(engine.pending);if(engine.timeTimer!==null)clearTimeout(engine.timeTimer);if(engine.hrefTimer!==null)clearInterval(engine.hrefTimer);
    engine.listeners.forEach(function(item){item[0].removeEventListener(item[1],item[2])});engine.listeners=[];
    triggerNoticeRemove(engine,'show_bubble_message');triggerNoticeRemove(engine,'show_banner');
    if(documentState.engine===engine)documentState.engine=null;
    if(triggerEngine===engine)triggerEngine=null
  }
  listen(window,'pagehide',stop);
  var cryptoApi=window.crypto,Encoder=window.TextEncoder;
  if(!cryptoApi||!cryptoApi.subtle||typeof cryptoApi.subtle.digest!=='function'||typeof Encoder!=='function')return;
  var validated=st.cfg.triggers.map(triggerRule).filter(Boolean);
  Promise.all(validated.map(function(rule){return cryptoApi.subtle.digest('SHA-256',new Encoder().encode(rule.canonical)).then(function(buffer){
    rule.hash=Array.prototype.map.call(new Uint8Array(buffer),function(value){return value.toString(16).padStart(2,'0')}).join('');return rule
  })})).then(function(hashed){
    if(engine.dead)return;
    var byHash=Object.create(null),collisions=Object.create(null);
    hashed.forEach(function(rule){var old=byHash[rule.hash];if(old&&old.canonical!==rule.canonical){collisions[rule.hash]=true;return}if(!old||rule.priority<old.priority)byHash[rule.hash]=rule});
    engine.rules=Object.keys(byHash).filter(function(hash){return !collisions[hash]}).map(function(hash){return byHash[hash]}).sort(function(a,b){return a.priority-b.priority||(a.hash<b.hash?-1:a.hash>b.hash?1:0)});
    engine.ready=true;sampleScroll();
    if(st.sess&&typeof st.sess.sessionId==='string'&&st.sess.sessionId)engine.bindSession(st.sess.sessionId);
    var has=function(type){return engine.rules.some(function(rule){return rule.conditions.some(function(condition){return condition.type===type})})};
    if(has('scroll_depth')){listen(document,'scroll',function(){resetContextIfChanged();sampleScroll();queue()});listen(window,'scroll',function(){resetContextIfChanged();sampleScroll();queue()});listen(window,'resize',function(){resetContextIfChanged();sampleScroll();queue()})}
    if(has('exit_intent'))listen(document,'mouseout',function(event){if(event.relatedTarget===null&&event.clientY<=0){resetContextIfChanged();engine.exit=true;queue()}});
    if(engine.rules.some(function(rule){return rule.conditions.some(function(condition){return condition.type!=='visit_count'})})){
      listen(window,'popstate',context);listen(window,'hashchange',context);
      engine.hrefTimer=setInterval(function(){if(String(location.href)!==engine.href)context()},500)
    }
    listen(document,'visibilitychange',function(){if(!document.hidden)context()});
    queue()
  }).catch(function(){if(!engine.dead)console.warn('Parallly widget: proactive rules unavailable')})
}

/* ─── INIT ─── */
function init(){
  fetchCfg(function(err,cfg){
    if(err){releaseWidgetOwner();return console.warn('Parallly widget: config error')}
    if(cfg.preChatEnabled){
      build();
      startTriggers();
      var saved=getSess();
      if(saved&&saved.token){st.pcDone=true}
      if(st.pcDone){initSess(null,function(e){if(!e)loadIO(connectWS)})}
    }else{
      build();
      startTriggers();
      initSess(null,function(e){if(!e)loadIO(connectWS)})
    }
  })
}

if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',init)}else{init()}
})();`;
}
