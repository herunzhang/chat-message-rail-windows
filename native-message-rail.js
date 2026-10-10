// SPDX-License-Identifier: MIT
// Experimental native-component adapter for Codex Windows 26.1002.7124.0.
// All imports/styles use installed app:// resources. No HTTP requests.
// Bookmarks persist locally as conversation/message IDs; chat text is never stored.
(async () => {
  const PUBLIC='__localNativeChatRail', INSTANCE='__localNativeChatRailMounted';
  window[PUBLIC]?.destroy();
  let stopped=false,busy=false,pending=0,error=null;
  const monitor=new MutationObserver(scheduleMount);
  function activeThread(){return [...document.querySelectorAll('[data-app-shell-active-page="true"] [data-chatgpt-conversation-selection-target="true"]')].find(e=>e.getBoundingClientRect().width>0)||null;}
  function scheduleMount(){if(!stopped&&!pending)pending=setTimeout(syncMount,120);}
  async function syncMount(){
    pending=0;if(stopped||busy)return;
    const thread=activeThread(),mounted=window[INSTANCE];
    if(mounted?.thread===thread&&thread)return;
    mounted?.destroy();
    if(!thread)return;
    busy=true;
    try{await installNativeChatRail();error=null;}catch(e){error=String(e.message);}
    finally{busy=false;if(stopped)window[INSTANCE]?.destroy();else if(!error&&window[INSTANCE]?.thread!==activeThread())scheduleMount();}
  }
  function destroy(){
    stopped=true;clearTimeout(pending);monitor.disconnect();window.removeEventListener('pagehide',destroy);window[INSTANCE]?.destroy();
    window.__localRailPreviewCache?.clear();delete window.__localRailPreviewCache;delete window[PUBLIC];
  }
  const status=()=>window[INSTANCE]?.status()||{implementation:'installed native rail',waitingForChat:!activeThread(),mounting:busy,error};
  window[PUBLIC]={destroy,status};
  monitor.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['data-app-shell-active-page']});
  window.addEventListener('pagehide',destroy);
  await syncMount();return status();

async function installNativeChatRail() {
  'use strict';
  const KEY='__localNativeChatRailMounted';
  const HYDRATED=window.__localRailHydratedConversations||(window.__localRailHydratedConversations=new Set());
  const VERSION_SCRIPT='app://-/assets/index-ee7b49945c27.js';
  if(![...document.scripts].some(s=>s.src===VERSION_SCRIPT))throw Error('App version changed; inspect native exports before updating this adapter.');
  const active=document.querySelector('[data-app-shell-active-page="true"]');
  const thread=active?.querySelector('[data-chatgpt-conversation-selection-target="true"]');
  const scroll=thread?.closest('.thread-scroll-container');
  if(!thread||!scroll||!thread.getBoundingClientRect().width)throw Error('Open an ordinary Chat first.');
  if(!window[KEY]&&scroll.parentElement.querySelector('[data-thread-user-message-navigation-rail-list]'))return {nativeAlreadyPresent:true};
  window[KEY]?.destroy();
  // Reuse the app's actual React runtime and actual exported native rail function.
  const shared=await import('app://-/assets/app-shared-40678a67f0e3.js');
  const initial=await import('app://-/assets/app-initial-25361a10f2bf.js');
  const native=await import('app://-/assets/thread-user-message-navigation-rail-cc08db8fe011.js');
  native.n();
  const React=shared.ggn(), createRoot=shared.$fn().createRoot;
  if(typeof native.t!=='function'||typeof createRoot!=='function')throw Error('Native exports incompatible.');
  const layout=scroll.parentElement, links=[];
  const originalMarker=layout.getAttribute('data-local-native-rail');
  const originalPadding=['padding-left','padding-right'].map(name=>({name,value:scroll.style.getPropertyValue(name),priority:scroll.style.getPropertyPriority(name)}));
  const properties=['--lcn-top','--lcn-height','--lcn-controls-top'].map(name=>({name,value:layout.style.getPropertyValue(name),priority:layout.style.getPropertyPriority(name)}));
  let reserved=false,dead=false,collapsed=false,timer=0,historyTimer=0,historyAbort=null,loadingHistory=false,signature='',count=0,lastError=null,bookmarkCount=0;
  // Keep previews across Chat-to-Chat remounts for this app session. The map is
  // memory-only and is cleared by Stop-ChatMessageRail or when the app exits.
  const previewCache=window.__localRailPreviewCache||(window.__localRailPreviewCache=new Map()),pendingPreviews=new Map();
  let root;
  const mount=document.createElement('div');mount.dataset.localNativeHost='true';
  const controls=document.createElement('div');controls.dataset.localNativeControls='true';
  const toggle=document.createElement('button');toggle.type='button';toggle.textContent='›';toggle.title='折叠原生提问导航';
  toggle.setAttribute('aria-label',toggle.title);
  controls.append(toggle);
  const style=document.createElement('style');
  style.textContent=`
    [data-local-native-rail] > nav:has([data-thread-user-message-navigation-rail-list]){left:16px!important;right:auto!important;top:var(--lcn-top)!important}
    [data-local-native-rail] [data-thread-user-message-navigation-rail-list]{max-height:var(--lcn-height)!important}
    [data-local-native-rail="collapsed"] > nav:has([data-thread-user-message-navigation-rail-list]){display:none!important}
    [data-local-native-controls]{position:absolute;left:16px;top:var(--lcn-controls-top);z-index:25;display:flex;gap:2px}
    [data-local-native-controls][hidden]{display:none!important}
    [data-local-native-controls] button{width:18px;height:22px;border:0;border-radius:5px;background:transparent;color:var(--color-text,#888);font:14px system-ui;cursor:pointer}
    [data-local-native-controls] button:hover{background:color-mix(in srgb,currentColor 12%,transparent)}
  `;
  function restore(node,p){p.value?node.style.setProperty(p.name,p.value,p.priority):node.style.removeProperty(p.name);}
  function destroy(reason='cleanup'){
    if(dead)return;dead=true;historyAbort?.abort();clearTimeout(timer);clearTimeout(historyTimer);observer.disconnect();resize.disconnect();
    window.removeEventListener('resize',schedule);window.removeEventListener('pagehide',destroy);
    layout.removeEventListener('pointerdown',holdForNavigation,true);layout.removeEventListener('click',holdForNavigation,true);
    root?.unmount();mount.remove();controls.remove();style.remove();links.forEach(l=>l.remove());
    if(reserved)originalPadding.forEach(p=>restore(scroll,p));properties.forEach(p=>restore(layout,p));
    originalMarker===null?layout.removeAttribute('data-local-native-rail'):layout.setAttribute('data-local-native-rail',originalMarker);
    delete window[KEY];
  }
  const observer=new MutationObserver(schedule),resize=new ResizeObserver(schedule);
  const status=()=>({implementation:'installed native rail',messages:count,renderedItems:layout.querySelectorAll('[data-thread-user-message-navigation-item-id]').length,bookmarks:bookmarkCount,loadingHistory,collapsed,error:lastError});
  window[KEY]={destroy,status,thread};
  function schedule(){if(!dead&&!timer)timer=setTimeout(refresh,100);}
  function currentFiber(){
    const key=Object.keys(thread).find(k=>k.startsWith('__reactFiber$'));
    let fiber=thread[key],top=fiber;
    while(top?.return)top=top.return;
    if(top?.stateNode?.current!==top&&fiber?.alternate)fiber=fiber.alternate;
    return fiber;
  }
  function chatData(){
    let fiber=currentFiber(),entries=null,conversationId=null,entriesFiber=null,scrollToKey=null,scrollToMessage=null,holdViewport=null;
    for(let depth=0;fiber&&depth<400;depth++,fiber=fiber.return){
      const p=fiber.memoizedProps;
      if(fiber.tag===10&&typeof p?.value?.holdViewport==='function')holdViewport=p.value.holdViewport;
      if(!entries&&Array.isArray(p?.entries)&&p.entries.every(e=>Array.isArray(e.turn?.items))){
        entries=p.entries;entriesFiber=fiber;conversationId=typeof p.conversationId==='string'?p.conversationId:null;
        if(typeof p.ref?.current?.scrollToMessage==='function')scrollToMessage=p.ref.current.scrollToMessage.bind(p.ref.current);
        for(let hook=fiber.memoizedState,n=0;hook&&n<150;hook=hook.next,n++){
          const value=hook.memoizedState;
          if(value&&typeof value.scrollToKey==='function')scrollToKey=value.scrollToKey.bind(value);
        }
      }
    }
    if(!entries)throw Error('Loaded Chat entries unavailable; refusing a partial DOM-only rail.');
    // Chat's own content-search source exposes the same background history
    // hydration callback used before persisted search. It updates the virtual
    // list without scrolling the visible transcript.
    let ensureHistory=null;
    for(const cache of entriesFiber?.updateQueue?.memoCache?.data??[]){
      if(!Array.isArray(cache))continue;
      for(const value of cache){
        if(typeof value!=='function')continue;
        const source=String(value);
        if(value.name==='Je'&&source.includes('z.get(Dc')&&source.includes('await zd(')){ensureHistory=value;break;}
      }
      if(ensureHistory)break;
    }
    return {entries,conversationId,scrollToKey,scrollToMessage,holdViewport,ensureHistory};
  }
  const BOOKMARK_STORAGE='chat-message-rail.bookmarks.v1';
  let volatileBookmarks={};
  function readBookmarkStore(){
    try {const value=JSON.parse(localStorage.getItem(BOOKMARK_STORAGE)||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}
    catch {return volatileBookmarks;}
  }
  function bookmarksFor(conversationId){
    const values=readBookmarkStore()[conversationId];
    return new Set(Array.isArray(values)?values.filter(value=>typeof value==='string'):[]);
  }
  function writeBookmark(conversationId,messageId,enabled){
    const store=readBookmarkStore(),values=new Set(Array.isArray(store[conversationId])?store[conversationId]:[]);
    enabled?values.add(messageId):values.delete(messageId);
    if(values.size)store[conversationId]=[...values];else delete store[conversationId];
    volatileBookmarks=store;
    try {localStorage.setItem(BOOKMARK_STORAGE,JSON.stringify(store));} catch {}
    signature='';schedule();
  }
  function bridge(element){
    // Read existing provider values; never alter the application's React tree or state.
    let fiber=currentFiber(),depth=0,providers=0;
    if(!fiber)throw Error('React context bridge unavailable.');
    while(fiber&&depth++<400){
      if(fiber.tag===10){element=React.createElement(fiber.type,{value:fiber.memoizedProps.value},element);providers++;}
      fiber=fiber.return;
    }
    if(!providers||fiber)throw Error('Incomplete React context bridge.');
    return element;
  }
  function position(){
    const scale=layout.getBoundingClientRect().height/layout.offsetHeight||1;
    const sr=scroll.getBoundingClientRect(),tr=thread.getBoundingClientRect();
    // Keep the original native left-side gutter and reserve room only when needed.
    if(!reserved&&tr.left-sr.left<52*scale){
      const p=originalPadding[0];scroll.style.setProperty(p.name,`${(parseFloat(getComputedStyle(scroll).getPropertyValue(p.name))||0)+56}px`,'important');
      reserved=true;
    }
    const lr=layout.getBoundingClientRect(),footer=layout.querySelector('[data-thread-scroll-footer="true"]');
    const end=(footer?footer.getBoundingClientRect().top:sr.bottom)-lr.top;
    const space=Math.max(0,end/scale-48);
    const height=Math.min(space,count*10+8);
    layout.style.setProperty('--lcn-height',`${height}px`);
    layout.style.setProperty('--lcn-top',`${24+space/2}px`);
    layout.style.setProperty('--lcn-controls-top',`${Math.max(4,24+space/2-height/2-26)}px`);
    controls.hidden=count<4||space<24;
  }
  const getScrollElement=()=>scroll;
  const revealItem=async item=>{
    const data=chatData();data.holdViewport?.();
    if(data.scrollToKey)await data.scrollToKey(item.turnKey,element=>{
      const user=[...element.querySelectorAll('[data-chatgpt-search-message-ids]')].find(node=>(node.getAttribute('data-chatgpt-search-message-ids')||'').split(' ').includes(item.messageId));
      return user?.querySelector('[data-content-search-unit-key]')||user||element.querySelector(`[data-content-search-unit-key="${CSS.escape(item.id)}"]`);
    },{align:'top'});
    else if(data.scrollToMessage&&item.messageId)await data.scrollToMessage(item.messageId);
    else throw Error('Native Chat reveal interface unavailable.');
    // Loading older history can renumber fallback-turn IDs. Keep the same message identity.
    for(const entry of chatData().entries){const index=entry.turn.items.findIndex(m=>m.type==='user-message'&&m.messageId===item.messageId);if(index>=0){item.id=`${entry.id}:${index}:user`;break;}}
  };
  const holdForNavigation=event=>{
    if(event.target instanceof Element&&event.target.closest('[data-thread-user-message-navigation-item-id]'))chatData().holdViewport?.();
  };
  const onPreviewItem=async item=>{
    const pending=pendingPreviews.get(item.id);
    if(item.previewState!=='loading')return true;
    if(!pending)return false;
    if(previewCache.has(pending.key))return true;
    // The native rail waits 150 ms before calling this callback. Populate only
    // the hovered historical item's tooltip and then rerender the open preview.
    previewCache.set(pending.key,pending.preview);
    while(previewCache.size>500)previewCache.delete(previewCache.keys().next().value);
    signature='';clearTimeout(timer);timer=setTimeout(refresh,0);
    return true;
  };
  async function hydrateHistoryInPlace(){
    // Match the native Work rail: ask the existing Chat content-search source to
    // hydrate history in the background. The virtual list preserves the latest
    // viewport; this adapter never scrolls the transcript during buffering.
    if(dead||loadingHistory||Math.abs(scroll.scrollTop)>2)return;
    const data=chatData(),conversationId=data.conversationId??data.entries.find(entry=>typeof entry.conversationId==='string')?.conversationId;
    if(!conversationId||HYDRATED.has(conversationId)||typeof data.ensureHistory!=='function')return;
    loadingHistory=true;historyAbort=new AbortController();schedule();
    try {
      await data.ensureHistory(historyAbort.signal);
      if(!dead&&!historyAbort.signal.aborted)HYDRATED.add(conversationId);
    } catch(e){if(!historyAbort.signal.aborted)lastError=`History loading stopped: ${e.message}`;}
    finally {if(!dead){loadingHistory=false;historyAbort=null;schedule();}}
  }
  const tooltipComponents={ExternalLinkIcon:initial.mA,Markdown:initial.ri};
  function refresh(){
    timer=0;if(dead)return;
    // Proof-of-concept is intentionally confined to this currently inspected Chat.
    if(!thread.isConnected||!thread.closest('[data-app-shell-active-page="true"]')){
      destroy('transcript-changed');
      scheduleMount();
      return;
    }
    const data=chatData();
    const conversationId=data.conversationId??data.entries.find(entry=>typeof entry.conversationId==='string')?.conversationId;
    if(!conversationId)throw Error('Chat conversation identity unavailable.');
    const bookmarks=bookmarksFor(conversationId);
    pendingPreviews.clear();
    const items=data.entries.flatMap(entry=>entry.turn.items.flatMap((message,index)=>{
      if(message.type!=='user-message')return [];
      const id=`${entry.id}:${index}:user`;
      const raw=(typeof message.message==='string'?message.message:'附件提问').replace(/\s+/gu,' ').trim();
      const label=Array.from(raw).slice(0,40).join('')+(Array.from(raw).length>40?'…':'');
      const assistant=entry.turn.items.filter(item=>item.type==='assistant-message'&&typeof item.content==='string').at(-1);
      const response=assistant?.content?.trim()||'';
      const isLoaded=!!thread.querySelector(`[data-content-search-unit-key="${CSS.escape(id)}"]`);
      const previewCacheKey=`${conversationId}:${message.messageId}:${assistant?.messageId||''}:${response.length}:${response.slice(-24)}`;
      const pendingPreview={response,outputs:[]};
      // Recent messages already rendered in the transcript have immediate
      // previews. Historical virtual items use the native loading skeleton and
      // are materialized only after the user hovers their rail marker.
      if(isLoaded&&!previewCache.has(previewCacheKey))previewCache.set(previewCacheKey,pendingPreview);
      const preview=previewCache.get(previewCacheKey);
      pendingPreviews.set(id,{key:previewCacheKey,preview:pendingPreview});
      return [{id,turnKey:entry.turnKey,messageId:message.messageId,bookmarkId:message.messageId,isBookmarked:bookmarks.has(message.messageId),
        isLoaded,getLabel:()=>label,getPreview:()=>preview??{response:'',outputs:[]},previewState:preview?'loaded':'loading',
        previewKey:`${previewCacheKey}:${preview?'loaded':'loading'}`}];
    }));
    count=items.length;bookmarkCount=items.filter(item=>item.isBookmarked).length;position();
    const next=items.map(i=>`${i.id}\0${i.getLabel()}\0${i.previewKey}\0${i.isBookmarked}`).join('\n');
    if(next===signature)return;signature=next;
    try {
      root.render(bridge(React.createElement(native.t,{
        getScrollElement,items,tooltipComponents,tooltipPortalContainer:layout,onRevealItem:revealItem,
        onPreviewItem,
        onBookmarkChange:(item,enabled)=>writeBookmark(conversationId,item.messageId,enabled),
        // Disables the native audio subscription branch as well as its entry fade.
        // Native click scrolling still explicitly uses behavior:'smooth'.
        prefersReducedMotion:true
        // Deliberately omit onNavigationClick; native item clicks use onRevealItem.
      })));
    } catch(e){lastError=e.message;destroy();throw e;}
  }
  try {
    for(const name of ['floating-navigation-rail-layout-17bd6c59412b.css','thread-user-message-navigation-rail-9057905bb670.css']){
      const href='app://-/assets/'+name;
      if(![...document.querySelectorAll('link[rel="stylesheet"]')].some(l=>l.href===href)){
        const link=document.createElement('link');link.rel='stylesheet';link.href=href;document.head.append(link);links.push(link);
      }
    }
    layout.setAttribute('data-local-native-rail','expanded');layout.append(mount,controls);document.head.append(style);
    root=createRoot(mount,{onUncaughtError:e=>{lastError=String(e?.message||e);queueMicrotask(destroy);},onRecoverableError:e=>{lastError=String(e?.message||e);}});
    toggle.onclick=()=>{collapsed=!collapsed;layout.setAttribute('data-local-native-rail',collapsed?'collapsed':'expanded');toggle.textContent=collapsed?'‹':'›';toggle.setAttribute('aria-expanded',String(!collapsed));};
    layout.addEventListener('pointerdown',holdForNavigation,true);layout.addEventListener('click',holdForNavigation,true);
    observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['data-app-shell-active-page']});
    resize.observe(scroll);resize.observe(thread);window.addEventListener('resize',schedule);window.addEventListener('pagehide',destroy);
    refresh();
    historyTimer=setTimeout(hydrateHistoryInPlace,350);
    await new Promise(resolve=>setTimeout(resolve,600));
    if(dead)throw Error(lastError||'Native mount was removed.');
    return status();
  } catch(e){destroy();throw e;}
}
})()
