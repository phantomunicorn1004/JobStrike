/* AutoGen Chat/Work experience detector v0.2.27 */
(function(){
 function norm(v){return String(v||'').replace(/\s+/g,' ').trim().toLowerCase();}
 function selected(el){
  if(!el) return false;
  const attrs=[el.getAttribute?.('aria-pressed'),el.getAttribute?.('aria-selected'),el.getAttribute?.('data-selected')];
  if(attrs.some(v=>norm(v)==='true')) return true;
  const state=norm(el.getAttribute?.('data-state'));
  return state==='active'||state==='checked'||state==='on'||state==='selected';
 }
 function selectedExperience(){
  const nodes=document.querySelectorAll('button,[role="tab"],[role="radio"],[aria-pressed],[aria-selected],[data-state]');
  for(const el of nodes){
   if(!selected(el)) continue;
   const text=norm([el.getAttribute?.('aria-label'),el.textContent].filter(Boolean).join(' '));
   if(text==='work'||text.startsWith('work ')) return 'work';
   if(text==='chat'||text.startsWith('chat ')) return 'chat';
  }
  return '';
 }
 function detect(){
  const fromControl=selectedExperience();
  if(fromControl) return fromControl;
  try{
   const u=new URL(location.href);
   const hint=norm(u.searchParams.get('experience')||u.searchParams.get('mode'));
   if(hint==='work') return 'work';
   if(hint==='chat') return 'chat';
   if(/^\/work(?:\/|$)/i.test(u.pathname)) return 'work';
  }catch(_e){}
  // Projects can host either Chat or Work, so do not infer Work from /project or page text.
  return 'chat';
 }
 window.AutoGenModeDetector={detect};
})();
