import os,tempfile,unittest
from types import SimpleNamespace
from multidict import CIMultiDict
os.environ['HARBOR_DATA']=tempfile.mkdtemp()
import server
class GatewayTests(unittest.TestCase):
 def test_cookie_isolation(self):
  headers=CIMultiDict([('Set-Cookie','session=one; Domain=app.local; Path=/; HttpOnly; SameSite=Lax'),('Set-Cookie','prefs=two; Path=/')])
  result=server.response_headers(headers,'http://172.20.0.2:80',9301)
  self.assertIn('h9301_session=one',result.getall('Set-Cookie')[0]); self.assertNotIn('Domain=',str(result));self.assertIn('HttpOnly',str(result))
  request=SimpleNamespace(headers=CIMultiDict({'Cookie':'h9301_session=one; h9302_session=other; portal=secret'}))
  self.assertEqual(server.request_headers(request,'http://172.20.0.2:80',9301)['Cookie'],'session=one')
 def test_policy_preserves_script_restrictions(self):
  result=server.response_headers(CIMultiDict({'Content-Security-Policy':"default-src 'self'; frame-ancestors 'none'",'X-Frame-Options':'DENY'}),'http://upstream',9301)
  self.assertIn("default-src 'self'",result['Content-Security-Policy']);self.assertIn(server.PORTAL,result['Content-Security-Policy']);self.assertNotIn('X-Frame-Options',result)
 def test_redirect_and_hop_headers(self):
  result=server.response_headers(CIMultiDict({'Location':'http://upstream/login?next=%2F','Connection':'keep-alive','Content-Encoding':'gzip'}),'http://upstream',9301)
  self.assertEqual(result['Location'],f'https://{server.HOST}:9301/login?next=%2F');self.assertNotIn('Connection',result);self.assertEqual(result['Content-Encoding'],'gzip')
 def test_origin_translation(self):
  req=SimpleNamespace(headers=CIMultiDict({'Origin':f'https://{server.HOST}:9301','Host':'evil','X-Forwarded-Host':'evil'}))
  h=server.request_headers(req,'http://172.20.0.2:80',9301)
  self.assertEqual(h['Origin'],'http://172.20.0.2:80');self.assertEqual(h['X-Forwarded-Host'],'172.20.0.2:80');self.assertEqual(h['Host'],'172.20.0.2:80')
 def test_null_ports(self):
  c={'Names':['/a'],'Labels':None,'Ports':None,'Id':'123','Image':'x','State':'running','Status':'Up (unhealthy)','Created':1}
  result=server.clean_container(c);self.assertEqual(result['ports'],[]);self.assertEqual(result['health'],'unhealthy')
 def test_stable_port_allocation(self):
  a=server.allocate('one');b=server.allocate('two');self.assertEqual(server.allocate('one'),a);self.assertNotEqual(a,b)
if __name__=='__main__':unittest.main()

class ProxyIntegrationTests(unittest.IsolatedAsyncioTestCase):
 async def asyncSetUp(self):
  from aiohttp import web,ClientSession,DummyCookieJar
  self.web=web
  async def echo(req):
   if req.path=='/ws':
    ws=web.WebSocketResponse();await ws.prepare(req)
    async for msg in ws:await ws.send_str(msg.data)
    return ws
   r=web.json_response({'host':req.host,'cookie':req.headers.get('Cookie'),'body':await req.text()})
   r.set_cookie('session','fixture',httponly=True)
   r.headers['X-Frame-Options']='DENY'
   return r
  app=web.Application();app.router.add_route('*','/{path:.*}',echo)
  self.origin_runner=web.AppRunner(app);await self.origin_runner.setup();origin=web.TCPSite(self.origin_runner,'127.0.0.1',0);await origin.start()
  self.upstream='http://127.0.0.1:'+str(origin._server.sockets[0].getsockname()[1])
  proxy_app=web.Application();proxy_app.router.add_route('*','/{path:.*}',server.proxy)
  self.proxy_runner=web.AppRunner(proxy_app);await self.proxy_runner.setup();proxy=web.TCPSite(self.proxy_runner,'127.0.0.1',0);await proxy.start();self.port=proxy._server.sockets[0].getsockname()[1]
  server.routes[self.port]={'upstream':self.upstream,'sourceOrigin':self.upstream}
  server.session=ClientSession(cookie_jar=DummyCookieJar(),auto_decompress=False)
  self.client=ClientSession(cookie_jar=DummyCookieJar());self.url='http://127.0.0.1:'+str(self.port);self.headers={'Host':server.HOST+':'+str(self.port)}
 async def asyncTearDown(self):
  await self.client.close();await server.session.close();await self.proxy_runner.cleanup();await self.origin_runner.cleanup();server.routes.pop(self.port)
 async def test_post_cookie_and_frame_policy(self):
  headers={**self.headers,'Cookie':f'h{self.port}_session=mine; h9300_session=foreign'}
  async with self.client.post(self.url+'/echo',data='hello',headers=headers) as r:
   data=await r.json();self.assertEqual(data['body'],'hello');self.assertEqual(data['cookie'],'session=mine');self.assertIn(f'h{self.port}_session=fixture',r.headers['Set-Cookie']);self.assertNotIn('X-Frame-Options',r.headers)
 async def test_websocket_roundtrip(self):
  async with self.client.ws_connect(self.url+'/ws',headers=self.headers) as ws:
   await ws.send_str('ping');response=await ws.receive(timeout=3);self.assertEqual(response.data,'ping')
 async def test_unrecognized_host_denied(self):
  async with self.client.get(self.url,headers={'Host':'evil.invalid'}) as r:self.assertEqual(r.status,403)
