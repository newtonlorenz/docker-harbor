import asyncio, json, os, ssl, time, re, hashlib, logging
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit
from http.cookies import SimpleCookie
from aiohttp import web, ClientSession, ClientTimeout, ClientWSTimeout, DummyCookieJar, WSMsgType
from multidict import CIMultiDict

ROOT=Path(__file__).parent
DATA=Path(os.getenv('HARBOR_DATA','/data')); DATA.mkdir(exist_ok=True)
HOST=os.getenv('HARBOR_HOST','localhost')
INSPECTOR=os.getenv('INSPECTOR_URL','http://inspector:9070')
PORTAL=f'https://{HOST}:8910'
PROJECT_NAME=os.getenv('HARBOR_PROJECT_NAME','docker-harbor')
PROJECT_CONFIG=Path(os.getenv('HARBOR_PROJECT_CONFIG','/config/projects.json'))
SKIP_PORTS={22,53,123,2375,2376,3306,5432,6379,8554,8555,27017}
HOP={'connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade'}
state={'projects':[], 'containers':[], 'endpoints':[], 'updated':None, 'error':'Connecting to Docker', 'host':{}}
routes={}; ports={}; runners=[]; refresh_lock=asyncio.Lock()
try: ports=json.loads((DATA/'ports.json').read_text())
except (FileNotFoundError,ValueError): pass
session=None; tls=None

def load_project_settings(path):
    """Optional non-secret display settings. Only allow safe launch schemes."""
    if not path.exists():
        return {}
    raw=json.loads(path.read_text())
    if not isinstance(raw,dict):
        raise ValueError('Project configuration must be a JSON object')
    result={}
    for project,settings in raw.items():
        if not isinstance(settings,dict):
            raise ValueError('Each project configuration must be an object')
        item={key:value for key,value in settings.items()
              if key in {'name','description','icon','palette','externalUrl'} and isinstance(value,str)}
        if item.get('externalUrl'):
            url=urlsplit(item['externalUrl'])
            if url.scheme!='https' or not url.hostname or url.username or url.password:
                raise ValueError('External launch links must be HTTPS URLs without credentials')
        result[project]=item
    return result

PROJECT_SETTINGS=load_project_settings(PROJECT_CONFIG)

def group(c):
    labels=c.get('Labels') or {}
    return labels.get('com.docker.compose.project') or labels.get('com.docker.stack.namespace') or c['Names'][0].lstrip('/')

def save_ports():
    tmp=DATA/'ports.tmp'; tmp.write_text(json.dumps(ports,indent=2)); tmp.replace(DATA/'ports.json')

def allocate(key):
    if key not in ports:
        available=next((p for p in range(9300,9400) if p not in ports.values()),None)
        if available is None: raise RuntimeError('All 100 app slots are in use')
        ports[key]=available; save_ports()
    return ports[key]

def clean_container(c):
    labels=c.get('Labels') or {}; name=c['Names'][0].lstrip('/')
    health=next((x for x in ['unhealthy','healthy','starting'] if '('+x in c['Status']),None)
    return dict(id=c['Id'],name=name,project=group(c),service=labels.get('com.docker.compose.service', name),image=c['Image'],state=c['State'],status=c['Status'],health=health,created=c['Created'],ports=(c.get('Ports') or []),networks=list(c.get('NetworkSettings',{}).get('Networks',{})),workingDir=labels.get('com.docker.compose.project.working_dir',''))

async def docker(path):
    async with session.get(INSPECTOR+path,timeout=ClientTimeout(total=20)) as r:
        r.raise_for_status(); return await r.json()

async def probe(url, host=None):
    try:
        async with session.get(url,headers={'Host':host} if host else {},ssl=False,timeout=ClientTimeout(total=3),allow_redirects=False) as r:
            return dict(status=r.status,kind='website' if r.status < 400 and 'text/html' in r.headers.get('Content-Type','') else 'service',available=True)
    except Exception: return None

async def discover():
    async with refresh_lock:
        try:
            raw,info=await asyncio.gather(docker('/containers/json'),docker('/info'))
            containers=[clean_container(c) for c in raw]
            endpoints=[]; fresh={}
            async def inspect(c):
                if c['State']!='running' or group(c)==PROJECT_NAME: return
                labels=c.get('Labels') or {}; name=c['Names'][0].lstrip('/')
                candidates={}
                for p in (c.get('Ports') or []):
                    if p.get('Type')!='tcp' or p['PrivatePort'] in SKIP_PORTS: continue
                    candidates.setdefault(p['PrivatePort'],[]).append(p)
                for port,bindings in candidates.items():
                    published=next((p for p in bindings if p.get('PublicPort') and ':' not in p.get('IP','')),None)
                    # Prefer Docker network addresses: works even for LAN-only host binds.
                    targets=[]
                    for n in c.get('NetworkSettings',{}).get('Networks',{}).values():
                        if n.get('IPAddress'): targets.append(f"http://{n['IPAddress']}:{port}")
                    if published:
                        targets.append(f"http://host.docker.internal:{published['PublicPort']}")
                        if published.get('IP') not in ('0.0.0.0','127.0.0.1','',None): targets.append(f"http://{published['IP']}:{published['PublicPort']}")
                    source_host=None
                    if published:
                        ip=published.get('IP',''); ip='127.0.0.1' if ip in ('0.0.0.0','') else ip
                        source_host=f"{ip}:{published['PublicPort']}"
                    result=None; target=None
                    targets=[u for t in targets for u in (t,t.replace('http:','https:',1))]
                    for target in targets:
                        result=await probe(target,source_host)
                        if result: break
                    if not result: continue
                    key=group(c)+'/'+labels.get('com.docker.compose.service',name)+'/'+str(port)
                    proxy_port=allocate(key)
                    launch_path='/'
                    if result['status']==404:
                        docs=await probe(target+'/docs',source_host)
                        if docs and docs['kind']=='website': result=docs; launch_path='/docs'
                    ep=dict(id=hashlib.sha256(key.encode()).hexdigest()[:16],key=key,containerId=c['Id'],project=group(c),name=labels.get('com.docker.compose.service',name),port=port,proxyPort=proxy_port,url=f'https://{HOST}:{proxy_port}{launch_path}',**result)
                    if published:
                        ip=published.get('IP',''); ip='127.0.0.1' if ip in ('0.0.0.0','') else ip
                        ep['directUrl']=f"http://{ip}:{published['PublicPort']}/"
                    endpoints.append(ep); fresh[proxy_port]={'upstream':target,'sourceOrigin':urlsplit(target).scheme+'://'+(source_host or urlsplit(target).netloc),'endpoint':ep}
            await asyncio.gather(*(inspect(c) for c in raw))
            for port in fresh:
                if port not in routes: await start_gateway(port)
            routes.clear(); routes.update(fresh)
            projects=[]
            for name in sorted({c['project'] for c in containers}):
                cs=[c for c in containers if c['project']==name]; es=[e for e in endpoints if e['project']==name]
                settings=PROJECT_SETTINGS.get(name,{})
                projects.append(dict(id=name,name=settings.get('name') or name.replace('-',' ').title(),presentation=settings,containers=cs,endpoints=sorted(es,key=lambda e:(e['kind']!='website',e['name'])),running=sum(c['state']=='running' for c in cs),unhealthy=sum(c['health']=='unhealthy' for c in cs)))
            state.update(projects=projects,containers=containers,endpoints=endpoints,updated=time.time(),error=None,host=dict(name=info.get('Name','Docker'),version=info.get('ServerVersion'),cpus=info.get('NCPU'),memory=info.get('MemTotal'),os=info.get('OperatingSystem')))
        except Exception as e:
            logging.exception('Discovery failed'); state['error']='Docker discovery is unavailable. Retrying automatically.'

async def start_gateway(port):
    if any(p==port for p,_ in runners): return
    app=web.Application(client_max_size=1024**3); app.router.add_route('*','/{path:.*}',proxy)
    runner=web.AppRunner(app,access_log=None); await runner.setup()
    await web.TCPSite(runner,'0.0.0.0',port,ssl_context=tls).start(); runners.append((port,runner))

def request_headers(req,upstream,port,source_origin=None):
    source_origin=source_origin or upstream
    headers=CIMultiDict((k,v) for k,v in req.headers.items() if k.lower() not in HOP|{'host','cookie','accept-encoding','forwarded','x-forwarded-for','x-forwarded-host','x-forwarded-proto'})
    origin=f'https://{HOST}:{port}'
    for key in ['Origin','Referer']:
        if key in headers and headers[key].startswith(origin): headers[key]=headers[key].replace(origin,source_origin,1)
    cookies=SimpleCookie(); cookies.load(req.headers.get('Cookie','')); prefix=f'h{port}_'
    values=[]
    for name,m in cookies.items():
        if name.startswith(prefix): values.append(name[len(prefix):]+'='+m.coded_value)
    if values: headers['Cookie']='; '.join(values)
    headers['Host']=urlsplit(source_origin).netloc
    headers['X-Forwarded-Proto']=urlsplit(source_origin).scheme; headers['X-Forwarded-Host']=urlsplit(source_origin).netloc
    return headers

def response_headers(src,upstream,port,source_origin=None):
    source_origin=source_origin or upstream
    out=CIMultiDict(); origin=f'https://{HOST}:{port}'
    for k,v in src.items():
        key=k.lower()
        if key in HOP|{'x-frame-options','content-security-policy','content-security-policy-report-only','set-cookie','clear-site-data'}: continue
        if key=='location' and any(v.startswith(o) or v.startswith('//'+urlsplit(o).netloc) for o in (upstream,source_origin)):
            u=urlsplit(v); v=origin+urlunsplit(('','',u.path,u.query,u.fragment))
        out.add(k,v)
    # Retain source policy other than its frame embedding restriction.
    policy=src.get('Content-Security-Policy','')
    directives=[d.strip() for d in policy.split(';') if d.strip() and not d.strip().lower().startswith('frame-ancestors')]
    directives.append(f"frame-ancestors {PORTAL} http://localhost:8909 http://127.0.0.1:8909")
    out['Content-Security-Policy']='; '.join(directives)
    for v in src.getall('Set-Cookie',[]):
        cookie=SimpleCookie()
        try: cookie.load(v)
        except Exception: continue
        for name,m in cookie.items():
            m['domain']=''; m['secure']=True
            out.add('Set-Cookie',f'h{port}_'+m.OutputString())
    return out

async def proxy(req):
    port=req.transport.get_extra_info('sockname')[1]
    if req.host.split(':')[0] != HOST: raise web.HTTPForbidden(text='Unrecognized host')
    route=routes.get(port)
    if not route: raise web.HTTPServiceUnavailable(text='This app is stopped or no longer available. Return to Harbor and refresh.')
    upstream=route['upstream']; url=upstream+req.raw_path
    headers=request_headers(req,upstream,port,route.get('sourceOrigin'))
    try:
        if req.headers.get('Upgrade','').lower()=='websocket':
            protocols=[p.strip() for p in req.headers.get('Sec-WebSocket-Protocol','').split(',') if p.strip()]
            for k in list(headers):
                if k.lower().startswith('sec-websocket-'): del headers[k]
            async with session.ws_connect(url,headers=headers,protocols=protocols,ssl=False,timeout=ClientWSTimeout(ws_close=15)) as remote:
                ws=web.WebSocketResponse(protocols=[remote.protocol] if remote.protocol else []); await ws.prepare(req)
                async def pump(source,target):
                    async for msg in source:
                        if msg.type==WSMsgType.TEXT: await target.send_str(msg.data)
                        elif msg.type==WSMsgType.BINARY: await target.send_bytes(msg.data)
                    await target.close()
                await asyncio.gather(pump(ws,remote),pump(remote,ws)); return ws
        async with session.request(req.method,url,headers=headers,data=req.content.iter_chunked(65536),allow_redirects=False,ssl=False,timeout=ClientTimeout(total=None,sock_connect=10),auto_decompress=False) as remote:
            response=web.StreamResponse(status=remote.status,headers=response_headers(remote.headers,upstream,port,route.get('sourceOrigin'))); await response.prepare(req)
            async for chunk in remote.content.iter_chunked(65536): await response.write(chunk)
            await response.write_eof(); return response
    except Exception:
        logging.exception('App gateway error')
        raise web.HTTPBadGateway(text='Harbor could not reach this app. Check its container status and try again.')

@web.middleware
async def protect(req,handler):
    if req.host.split(':')[0] not in {HOST,'localhost','127.0.0.1'}: raise web.HTTPForbidden()
    if req.path.startswith('/api/') and req.headers.get('Sec-Fetch-Site')=='cross-site': raise web.HTTPForbidden()
    response=await handler(req)
    response.headers['X-Content-Type-Options']='nosniff'
    response.headers['Content-Security-Policy']=f"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src https://{HOST}:*; frame-ancestors 'none'; base-uri 'none'; object-src 'none'"
    response.headers['Referrer-Policy']='no-referrer'
    if req.path.startswith('/api/'): response.headers['Cache-Control']='no-store'
    return response

async def inventory(req): return web.json_response(state)
async def health(req): return web.json_response({'ok':state['updated'] is not None,'error':state['error']},status=200 if state['updated'] else 503)
async def stats(req):
    cid=req.match_info['id']
    if not any(c['id']==cid for c in state['containers']): raise web.HTTPNotFound()
    try:
        d=await docker(f'/containers/{cid}/stats'); cpu=d.get('cpu_stats',{}); prev=d.get('precpu_stats',{})
        delta=cpu.get('cpu_usage',{}).get('total_usage',0)-prev.get('cpu_usage',{}).get('total_usage',0); system=cpu.get('system_cpu_usage',0)-prev.get('system_cpu_usage',0)
        mem=d.get('memory_stats',{}); used=max(0,mem.get('usage',0)-mem.get('stats',{}).get('inactive_file',0))
        return web.json_response({'cpu':round(delta/system*cpu.get('online_cpus',1)*100,2) if system>0 else None,'memory':used,'limit':mem.get('limit',0),'pids':d.get('pids_stats',{}).get('current',0)})
    except Exception: raise web.HTTPServiceUnavailable(text='Resource sample unavailable')
async def static(req):
    name=req.match_info.get('path','') or 'index.html'
    path=(ROOT/'public'/name).resolve()
    if not path.is_relative_to((ROOT/'public').resolve()) or not path.is_file(): raise web.HTTPNotFound()
    response=web.FileResponse(path)
    if name=='sw.js': response.headers['Cache-Control']='no-cache'; response.headers['Service-Worker-Allowed']='/'
    return response
async def refresh_loop():
    while True:
        await discover(); await asyncio.sleep(30)
async def main():
    global session,tls
    logging.basicConfig(level=logging.INFO)
    tls=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); tls.minimum_version=ssl.TLSVersion.TLSv1_2
    tls.load_cert_chain(os.getenv('HARBOR_CERT','/certs/harbor.crt'),os.getenv('HARBOR_KEY','/certs/harbor.key'))
    session=ClientSession(cookie_jar=DummyCookieJar(),auto_decompress=False)
    app=web.Application(middlewares=[protect]); app.router.add_get('/api/inventory',inventory); app.router.add_get('/api/containers/{id}/stats',stats); app.router.add_get('/health',health); app.router.add_get('/{path:.*}',static)
    runner=web.AppRunner(app,access_log=None); await runner.setup()
    await web.TCPSite(runner,'0.0.0.0',8909).start(); await web.TCPSite(runner,'0.0.0.0',8910,ssl_context=tls).start()
    task=asyncio.create_task(refresh_loop())
    try: await asyncio.Event().wait()
    finally: task.cancel(); await session.close()
if __name__=='__main__': asyncio.run(main())
