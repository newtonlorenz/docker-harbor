"""Only this private service sees the Docker socket. No mutation routes exist."""
import asyncio, re
from aiohttp import web, ClientSession, UnixConnector, ClientTimeout

async def main():
    session = ClientSession(connector=UnixConnector(path='/var/run/docker.sock'), timeout=ClientTimeout(total=15))
    async def inspect(request):
        path = request.path
        if request.method != 'GET' or not (path in ['/containers/json', '/info'] or re.fullmatch(r'/containers/[a-f0-9]{64}/stats', path)):
            raise web.HTTPForbidden()
        params = {'all': '1'} if path == '/containers/json' else {'stream': 'false', 'one-shot': 'true'} if path.endswith('/stats') else {}
        async with session.get('http://docker'+path, params=params) as response:
            return web.Response(body=await response.read(), status=response.status, content_type='application/json')
    app=web.Application(); app.router.add_route('*', '/{path:.*}', inspect)
    runner=web.AppRunner(app); await runner.setup(); await web.TCPSite(runner, '0.0.0.0', 9070).start()
    try: await asyncio.Event().wait()
    finally: await session.close()

if __name__ == '__main__': asyncio.run(main())
