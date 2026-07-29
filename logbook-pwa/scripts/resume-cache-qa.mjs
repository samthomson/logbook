import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer'
import { createServer } from 'vite'

const root = fileURLToPath(new URL('..', import.meta.url))
const pubkey = '3c457108865e05d95ce3848aa0bc51cd64f984c5c61689a3d49809ab71fa1d64'
const sectionId = 'sec-lead-stories-cached-chapter-32'
const issueEvent = {
  id: '1'.repeat(64), pubkey: '775954f7314112489a4a29ec692b72386fd60bcceb0308d423101ea979c57a80',
  created_at: 1_700_000_000, kind: 30023, tags: [['d', 'newsletter-32'], ['title', 'Cached Compass issue']],
  content: '## Lead stories\n### Cached chapter\nCached issue content', sig: '2'.repeat(128),
}
const issue = {
  issueNumber: 32, title: 'Cached Compass issue', event: issueEvent,
  sections: [{ id: 'sec-lead-stories-32', title: 'Lead stories', items: [{ id: sectionId, title: 'Cached chapter', body: 'Cached issue content' }] }],
}
const segmentEvent = {
  id: '3'.repeat(64), pubkey, created_at: 1_700_000_100, kind: 4200,
  tags: [['section', sectionId], ['t', 'logbook-32'], ['x', '4'.repeat(64)]], content: '{}', sig: '5'.repeat(128),
}
const modules = new Map([
  ['compass', `
    export async function fetchIssueByDTag(){globalThis.__qaIssueRequests=(globalThis.__qaIssueRequests||0)+1;return new Promise(()=>{})}
    export async function fetchLatestIssue(){return new Promise(()=>{})}
    export async function fetchLatestIssueWithSegments(){globalThis.__qaIssueRequests=(globalThis.__qaIssueRequests||0)+1;return new Promise(()=>{})}
    export async function fetchAllIssues(){return new Promise(()=>{})}
    export function extractIssueNumber(){return 32}
    export function parseIssue(){throw new Error('network issue must not replace cache')}
  `],
  ['whitelist', `
    export async function fetchAccessLists(){globalThis.__qaAccessRequests=(globalThis.__qaAccessRequests||0)+1;return new Promise(()=>{})}
  `],
  ['segment', `
    globalThis.__qaSegmentRequests=0
    export async function fetchSegmentsForIssue(){globalThis.__qaSegmentRequests+=1;if(!globalThis.__qaAllowSegmentRetry)throw new Error('relay offline');return new Promise(resolve=>{globalThis.__qaResolveSegments=(value)=>{globalThis.__qaSegmentFetchResolved=true;resolve(value)}})}
    export async function fetchTranscripts(){return new Map()}
    export function mergeSegmentEventGroups(base,additions){const merged=new Map([...base].map(([id,events])=>[id,[...events]]));const seen=new Set([...merged.values()].flat().map(event=>event.id));for(const event of additions){if(seen.has(event.id))continue;const section=event.tags?.find(tag=>tag[0]==='section')?.[1];if(!section)continue;merged.set(section,[...(merged.get(section)||[]),event]);seen.add(event.id)}return merged}
    export function parseSegment(event){return {event,sectionId:'${sectionId}',respondingTo:null,isIntro:false,audio:{url:'https://example.test/audio.webm',sha256:'${'4'.repeat(64)}',mime:'audio/webm',duration:7,waveform:[0.2,0.4]}}}
    export function selectTrustedSegmentEvents(events){return events}
    export async function publishSegment(){throw new Error('unexpected publish')}
  `],
  ['manifest', `export async function fetchManifest(){throw new Error('relay offline')}`],
  ['profiles', `export async function fetchProfiles(){return new Map()}`],
  ['pool', `export function getPool(){return {subscribeMany(_relays,_filter,handlers){globalThis.__qaSegmentEvent=handlers.onevent;return {close(){}}}}}`],
  ['blossom', `
    globalThis.__qaUploadCalls=0
    export async function uploadBlob(){globalThis.__qaUploadCalls+=1;throw new Error('cached access attempted a remote upload')}
  `],
  ['issue-cache', `
    export async function loadCachedIssue(){const raw=localStorage.getItem('qa_issue_cache');return raw?JSON.parse(raw):null}
    export async function saveCachedIssue(_issue,segments){const ids=segments.flatMap(([,events])=>events.map(event=>event.id));if(ids.includes('live-during-retry')&&!ids.includes('query-during-retry'))return new Promise(resolve=>{globalThis.__qaResolveLiveCacheWrite=()=>{globalThis.__qaSavedSegments=segments;resolve()}});globalThis.__qaSavedSegments=segments}
  `],
])
const fixturePlugin = {
  name: 'resume-cache-fixtures', enforce: 'pre',
  resolveId(source) { for (const name of modules.keys()) if (source.endsWith('/lib/' + name)) return '\0resume-' + name },
  load(id) { return modules.get(id.replace('\0resume-', '')) },
}
const server = await createServer({root,logLevel:'error',plugins:[fixturePlugin],server:{host:'127.0.0.1',port:0}})
let browser
try {
  await server.listen(); const address=server.httpServer?.address(); if(!address||typeof address==='string') throw new Error('no port')
  browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-gpu']})
  const page=await browser.newPage()
  page.on('pageerror',(error)=>console.error('PAGEERROR',error.message))
  page.on('console',(message)=>{if(message.type()==='error') console.error('CONSOLE',message.text())})
  await page.evaluateOnNewDocument((identity)=>{
    Object.defineProperty(window,'nostr',{configurable:true,value:{getPublicKey:async()=>identity,signEvent:async(event)=>event}})
    const stream={getTracks:()=>[{stop(){}}]}
    Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>stream}})
    class FakeAudioContext {
      state='running'; createMediaStreamSource(){return {connect(){}}}
      createAnalyser(){return {fftSize:256,frequencyBinCount:128,connect(){},getByteFrequencyData(data){data.fill(20)}}}
      createMediaStreamDestination(){return {stream}}; async resume(){}; async close(){}
    }
    class FakeMediaRecorder {
      static isTypeSupported(){return true}; state='inactive'; mimeType='audio/webm'
      start(){this.state='recording'}
      stop(){this.state='inactive';this.ondataavailable?.({data:new Blob([new Uint8Array(200)],{type:this.mimeType})});this.onstop?.()}
    }
    Object.defineProperty(window,'AudioContext',{configurable:true,value:FakeAudioContext})
    Object.defineProperty(window,'MediaRecorder',{configurable:true,value:FakeMediaRecorder})
  },pubkey)
  const url=`http://127.0.0.1:${address.port}/`
  await page.goto(url,{waitUntil:'domcontentloaded'})
  await page.evaluate(({owner,issue,segmentEvent,sectionId})=>{
    localStorage.setItem('logbook_auth',JSON.stringify({method:'extension'}))
    localStorage.setItem('logbook_selected_issue','32')
    sessionStorage.setItem('logbook_access_snapshot',JSON.stringify({issueNumber:32,pubkey:owner,allowed:[owner],admins:[],cachedAt:Date.now()}))
    localStorage.setItem('qa_issue_cache',JSON.stringify({issue,segments:[[sectionId,[segmentEvent]]]}))
  },{owner:pubkey,issue,segmentEvent,sectionId})
  const started=Date.now(); await page.reload({waitUntil:'domcontentloaded'})
  await page.waitForSelector('.timeline__issue-title',{timeout:1500})
  await page.waitForSelector('.app-identity',{timeout:1500})
  await page.waitForSelector('[aria-label="Record a voice note"]',{timeout:1500})
  await page.waitForSelector(`#voice-note-${segmentEvent.id}`,{timeout:1500})
  await page.waitForFunction(()=>document.body.textContent?.includes('Showing saved voice notes — relays unavailable.'),{timeout:1500})
  await page.evaluate(()=>{globalThis.__qaAllowSegmentRetry=true})
  await page.click('.notice--episode button')
  await page.waitForFunction(()=>typeof globalThis.__qaResolveSegments==='function',{timeout:1500})
  const liveEvent={...segmentEvent,id:'live-during-retry',created_at:segmentEvent.created_at+1}
  const queryEvent={...segmentEvent,id:'query-during-retry',created_at:segmentEvent.created_at+2}
  await page.evaluate(({liveEvent,queryEvent,sectionId})=>{globalThis.__qaSegmentEvent(liveEvent);globalThis.__qaResolveSegments(new Map([[sectionId,[queryEvent]]]))},{liveEvent,queryEvent,sectionId})
  await page.waitForFunction(()=>globalThis.__qaSegmentFetchResolved&&!document.body.textContent?.includes('relays unavailable'),{timeout:1500})
  await page.waitForSelector('#voice-note-live-during-retry',{timeout:1500})
  await page.waitForSelector('#voice-note-query-during-retry',{timeout:1500})
  await page.evaluate(()=>globalThis.__qaResolveLiveCacheWrite())
  await page.waitForFunction(()=>{const ids=(globalThis.__qaSavedSegments||[]).flatMap(([,events])=>events.map(event=>event.id));return ids.includes('live-during-retry')&&ids.includes('query-during-retry')},{timeout:1500})
  const restoredMs=Date.now()-started
  await page.click('[aria-label="Record a voice note"]')
  await page.waitForSelector('.irec--live')
  await page.click('[aria-label="Stop and keep recording"]')
  await page.waitForSelector('.irec--review')
  await page.evaluate(()=>[...document.querySelectorAll('button')].find((button)=>button.textContent?.trim()==='Publish')?.click())
  await page.waitForFunction(()=>document.body.textContent?.includes('Recording saved locally'))
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})))
  await page.waitForFunction(()=>globalThis.__qaAccessRequests>=2,{timeout:1500})
  const result=await page.evaluate(()=>({
    title:document.querySelector('.timeline__issue-title')?.textContent,
    cachedContent:document.body.textContent?.includes('Cached issue content'),
    cachedSegment:Boolean(document.querySelector('[id^="voice-note-"]')),
    liveRetrySegment:Boolean(document.querySelector('#voice-note-live-during-retry')),
    liveRetryCached:['live-during-retry','query-during-retry'].every((id)=>(globalThis.__qaSavedSegments||[]).flatMap(([,events])=>events).some((event)=>event.id===id)),
    recorders:document.querySelectorAll('[aria-label="Record a voice note"]').length,
    accessRequests:globalThis.__qaAccessRequests,
    issueRequests:globalThis.__qaIssueRequests,
    segmentRequests:globalThis.__qaSegmentRequests,
    uploadCalls:globalThis.__qaUploadCalls,
  }))
  if(restoredMs>1500||!result.cachedContent||!result.cachedSegment||!result.liveRetrySegment||!result.liveRetryCached||result.recorders===0||result.accessRequests<2||result.segmentRequests<2||result.uploadCalls!==0) throw new Error(`resume cache failed ${JSON.stringify({restoredMs,...result})}`)
  console.log(`Resume/cache QA passed: ${JSON.stringify({restoredMs,...result})}`)
} finally {await browser?.close().catch(()=>{});await server.close().catch(()=>{})}
