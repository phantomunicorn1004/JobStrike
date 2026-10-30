/* AutoGen ChatGPT model adapter v0.2.27
   Finds the model/reasoning trigger using stable semantic signals before content-code fallbacks. */
(function(){
 function visible(el){
  if(!el) return false;
  const r=el.getBoundingClientRect?.();
  if(r && (r.width>0||r.height>0)) return true;
  return Boolean(el.offsetWidth||el.offsetHeight||el.getClientRects?.().length);
 }
 function semanticScore(el){
  if(!el) return -1;
  const aria=String(el.getAttribute?.('aria-label')||'').toLowerCase();
  const testid=String(el.getAttribute?.('data-testid')||'').toLowerCase();
  const effort=String(el.getAttribute?.('data-selected-reasoning-effort')||'').toLowerCase();
  const text=String(el.textContent||'').toLowerCase();
  let score=0;
  if(aria==='select chatgpt model') score+=100;
  if(aria.includes('chatgpt')&&aria.includes('model')) score+=80;
  if(aria.includes('model')&&el.getAttribute?.('aria-haspopup')) score+=55;
  if(testid.includes('model')) score+=50;
  if(effort) score+=70;
  if(/thinking effort|reasoning effort/.test(text)) score+=35;
  if(!/model|thinking|reasoning|gpt|instant|medium|high|pro/.test(`${aria} ${testid} ${effort} ${text}`)) return -1;
  if(visible(el)) score+=10;
  return score;
 }
 function findTrigger(){
  const selectors=[
   'button[aria-label="Select ChatGPT model"]',
   'button[data-selected-reasoning-effort]',
   'button[aria-label*="ChatGPT" i][aria-label*="model" i]',
   'button[data-testid*="model" i]',
   'button[aria-haspopup][aria-label*="model" i]'
  ];
  const seen=new Set();
  const nodes=[];
  for(const sel of selectors){
   for(const el of document.querySelectorAll(sel)){if(!seen.has(el)){seen.add(el);nodes.push(el);}}
  }
  if(!nodes.length){
   for(const el of document.querySelectorAll('button[aria-haspopup],button[data-selected-reasoning-effort]')) nodes.push(el);
  }
  let best=null,bestScore=-1;
  for(const el of nodes){
   const score=semanticScore(el);
   if(score>bestScore){best=el;bestScore=score;}
  }
  return bestScore>=0?best:null;
 }
 window.AutoGenModelAdapter={findTrigger};
})();
