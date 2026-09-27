// Deterministic loopback pages for browser workflow benchmarks. The server
// binds only to localhost and serves no third-party assets or account data.
import http from 'node:http';
import { randomUUID } from 'node:crypto';

const html = (title, body, script = '') => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}<script>${script}</script></body></html>`;

export async function startFixtureServer() {
  const downloadName = `helium-benchmark-${randomUUID()}.txt`;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    if (url.pathname === '/form') {
      res.end(html('Local form fixture', `<form id="profile"><label>Name <input name="name" required></label><label>Email <input name="email" type="email" required></label><label>Plan <select name="plan"><option>Basic</option><option>Plus</option><option>Pro</option></select></label><label><input name="updates" type="checkbox"> Updates</label><button type="submit">Save profile</button></form><output id="result"></output>`, `document.querySelector('form').addEventListener('submit',e=>{e.preventDefault();const d=new FormData(e.currentTarget);document.querySelector('#result').textContent=JSON.stringify({name:d.get('name'),email:d.get('email'),plan:d.get('plan'),updates:d.has('updates')})})`));
    } else if (url.pathname === '/catalog') {
      const items = Array.from({ length: 37 }, (_, i) => `<li data-category="${i % 3 === 0 ? 'books' : i % 3 === 1 ? 'music' : 'film'}">Item ${String(i + 1).padStart(2, '0')}</li>`).join('');
      res.end(html('Local catalog fixture', `<label>Category <select id="category"><option value="all">All</option><option value="books">Books</option><option value="music">Music</option><option value="film">Film</option></select></label><ul id="items">${items}</ul><button id="next">Next page</button><output id="page">1</output>`, `let page=1;const render=()=>{const rows=[...document.querySelectorAll('#items li')];const filtered=rows.filter(x=>document.querySelector('#category').value==='all'||x.dataset.category===document.querySelector('#category').value);rows.forEach((x,i)=>x.hidden=!filtered.slice((page-1)*5,page*5).includes(x));document.querySelector('#page').textContent=String(page)};document.querySelector('#category').onchange=()=>{page=1;render()};document.querySelector('#next').onclick=()=>{page++;render()};render()`));
    } else if (url.pathname === '/delayed') {
      res.end(html('Local delayed UI fixture', '<button id="start">Load status</button><output id="status">Idle</output>', `document.querySelector('#start').onclick=()=>{document.querySelector('#status').textContent='Loading';setTimeout(async()=>{const data=await(await fetch('/status')).json();document.querySelector('#status').textContent=data.status},300)}`));
    } else if (url.pathname === '/status') {
      res.setHeader('Content-Type', 'application/json');
      setTimeout(() => res.end(JSON.stringify({status:'Ready'})), 600);
    } else if (url.pathname === '/download') {
      const requestedName = url.searchParams.get('name');
      const filename = /^helium-benchmark-[a-z0-9-]+\.txt$/.test(requestedName || '') ? requestedName : downloadName;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(html('Local download fixture', `<a id="download" href="/document.txt?name=${encodeURIComponent(filename)}" download="${filename}">Download document</a>`));
    } else if (url.pathname === '/document.txt') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      const requestedName = url.searchParams.get('name');
      const filename = /^helium-benchmark-[a-z0-9-]+\.txt$/.test(requestedName || '') ? requestedName : downloadName;
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.end('helium-local-document-fixture-v1\nExpected content for download verification.\n');
    } else { res.statusCode = 404; res.end('Not found'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const { port } = server.address();
  return { downloadName, origin: `http://127.0.0.1:${port}`, close: () => new Promise(resolve => server.close(resolve)) };
}
