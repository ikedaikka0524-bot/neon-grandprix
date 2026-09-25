// App shell: service worker (sw.js, offline play), 'アプリとして追加' per platform, and 設定 → データ引き継ぎ (a home-screen
// app on iOS has its own localStorage, separate from Safari's). Node-safe at import: tools/check-pwa.mjs tests the codec.
import { getSave, persist } from './save.js';
import { CAR_BY_ID } from './data.js';
import { cleanName } from './lb.js';

/* ================= transfer code: NGP1.<base64url(gzip(save JSON))>.<FNV-1a of the rest> ================= */
const MAX_CODE = 200000, MAX_JSON = 256 * 1024;
const fnv = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193); return (h >>> 0).toString(36); };
const b64u = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };

export async function encodeSave(save) {
  const gz = await new Response(new Blob([JSON.stringify(save)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  const body = 'NGP1.' + b64u(new Uint8Array(gz));
  return `${body}.${fnv(body)}`;
}

// -> a cleaned save, or null for anything malformed / tampered / oversized (never eval'd; JSON.parse only)
export async function decodeSave(code) {
  code = String(code ?? '');
  if (code.length > MAX_CODE) return null;
  const m = /^(NGP1\.([\w-]+))\.([0-9a-z]+)$/.exec(code.replace(/\s+/g, ''));
  if (!m || fnv(m[1]) !== m[3]) return null;
  try {
    const gz = Uint8Array.from(atob(m[2].replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const rd = new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip')).getReader(), parts = [];
    for (let n = 0, x; !(x = await rd.read()).done;) {
      if ((n += x.value.length) > MAX_JSON) { rd.cancel(); return null; }   // gzip bomb
      parts.push(x.value);
    }
    return cleanSave(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await new Blob(parts).arrayBuffer())));
  } catch { return null; }
}

const obj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const count = x => Number.isSafeInteger(x) && x >= 0;
// Besides the name, a save holds only ids, hex colours, settings, numbers and booleans: a pasted code can't carry
// markup into the UI or prototype keys into the save.
function plain(x, depth = 0) {
  if (typeof x === 'string') return /^[\w#.:-]{0,64}$/.test(x);
  if (typeof x === 'number') return Number.isFinite(x);
  if (x === null || typeof x === 'boolean') return true;
  return typeof x === 'object' && depth < 8
    && Object.entries(x).every(([k, v]) => /^[\w.-]{1,64}$/.test(k) && !/^(__proto__|constructor|prototype)$/.test(k) && plain(v, depth + 1));
}
export function cleanSave(o) {
  if (!obj(o) || o.v !== 1 || typeof o.name !== 'string' || !count(o.coins) || !count(o.tickets)
    || !obj(o.cars) || !obj(o.selected) || !obj(o.stats) || !count(o.stats.races) || !count(o.stats.wins)) return null;
  const s = { ...o, name: cleanName(o.name) };
  const ids = Object.keys(s.cars);
  if (!plain({ ...s, name: '' }) || !ids.length || ids.length > 500) return null;
  // a car this build knows needs the shape the UI reads; others (a newer build's) are kept as they are, like save.js
  for (const id of ids) {
    const r = s.cars[id];
    if (!obj(r) || (Object.hasOwn(CAR_BY_ID, id) && !(Array.isArray(r.nodes) && count(r.dupes) && obj(r.look)))) return null;
  }
  return s;   // save.js getSave() normalises the rest (selection, course, CPU level, quality, old records) on reload
}

/* ================= browser side ================= */
if (typeof document !== 'undefined') {
  const $ = id => document.getElementById(id);
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* no storage */ } },
  };
  const ua = navigator.userAgent;
  const IOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  // LINE / Instagram / Facebook / X / TikTok / Android WebView: no install, often no real storage either
  const LINE = / Line\//.test(ua), INAPP = LINE || /Instagram|FBAN|FBAV|FB_IAB|FBIOS|Twitter|musical_ly|Bytedance|TikTok|; wv\)/.test(ua);
  let installed = matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone === true;
  let deferred = null;   // Android / desktop Chrome: the beforeinstallprompt event

  // service worker: GitHub Pages only (on localhost it would serve stale files while someone edits them without a
  // bump) unless localStorage ngp.sw = '1'
  const dev = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if ('serviceWorker' in navigator && (!dev || ls.get('ngp.sw') === '1')) {
    const reg = () => navigator.serviceWorker.register('sw.js').catch(e => console.warn('sw', e));
    document.readyState === 'complete' ? reg() : addEventListener('load', reg);
  }
  // offline: index.html shows a note on the online / ranking screens
  const net = () => document.documentElement.classList.toggle('ngp-offline', !navigator.onLine);
  addEventListener('online', net); addEventListener('offline', net); net();

  const SHARE = '<svg viewBox="0 0 24 24"><path d="M12 15V3M8 7l4-4 4 4M7 10H5v11h14V10h-2"/></svg>';
  const PLUS = '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/></svg>';
  const page = () => location.href.split('#')[0];
  const CARD = {
    prompt: () => '<p><b>アプリにして遊ぼう</b>ホーム画面からすぐ・全画面で遊べます</p><button class="btn primary sm" data-pwa="install">アプリとして追加</button>',
    ios: () => `<div class="pwa-ios" aria-hidden="true"><span>${SHARE}</span><i>→</i><span>${PLUS}ホーム画面に追加</span></div>`
      // Safari (WebKit tracking prevention) deletes a site's storage after 7 days of use without a visit; home-screen apps are exempt
      + '<p><b>アプリにして全画面で遊ぼう</b>共有ボタン（無いときは「…」の中）→「ホーム画面に追加」。Safariのままだと、しばらく遊ばないとデータが消えることがあります（ホーム画面のアプリなら安全）。Safariで遊んだデータは 設定 →「データ引き継ぎ」で移せます</p>',
    inapp: () => `<p><b>Safari / Chrome で開いてください</b>アプリ内ブラウザではホーム画面に追加できず、データが消えることもあります</p>`
      + `<input class="inp" readonly value="${page().replace(/"/g, '&quot;')}" aria-label="このページのURL"><button class="btn primary sm" data-pwa="link">リンクをコピー</button>`
      + (LINE ? `<a class="btn sm" href="${location.pathname}?openExternalBrowser=1">ブラウザで開く</a>`
        : /Android/.test(ua) ? `<a class="btn sm" href="intent://${location.host}${location.pathname}#Intent;scheme=https;package=com.android.chrome;end">Chromeで開く</a>` : ''),
  };
  const kind = () => (installed ? 'app' : INAPP ? 'inapp' : IOS ? 'ios' : deferred ? 'prompt' : null);
  function render() {
    const k = kind(), set = $('pwaInstall');
    if (set) set.innerHTML = CARD[k]?.() || `<p>${k === 'app' ? 'アプリとして起動中です ✓' : 'ブラウザのメニューの「ホーム画面に追加」や「アプリをインストール」で、アプリとして遊べます'}</p>`;
    // home: a dismissable card (remembered per kind: closing the LINE note doesn't hide Safari's guide later)
    let card = $('pwaCard');
    if (!CARD[k] || ls.get('ngp.pwa.closed') === k) return card?.remove();
    if (!card) {
      $('menu')?.append(card = Object.assign(document.createElement('div'), { id: 'pwaCard', className: 'panel pwa-card' }));
      // the home screen gets this much extra scroll (index.html), so nothing stays stuck under the card
      new ResizeObserver(() => document.documentElement.style.setProperty('--pwa-h', `${card.offsetHeight}px`)).observe(card);
    }
    card.innerHTML = `<div class="pwa-inst">${CARD[k]()}</div><button class="pwa-x" data-pwa="close" aria-label="閉じる">×</button>`;
  }
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; render(); });
  addEventListener('appinstalled', () => { deferred = null; installed = true; render(); });
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-pwa]');
    if (!b) return;
    const act = b.dataset.pwa;
    if (act === 'close') { ls.set('ngp.pwa.closed', kind()); render(); }
    if (act === 'install' && deferred) {
      const p = deferred;
      deferred = null;
      p.prompt();
      if ((await p.userChoice.catch(() => null))?.outcome === 'accepted') installed = true;
      render();
    }
    if (act === 'link') {
      const inp = b.parentElement.querySelector('input');
      try { await navigator.clipboard.writeText(page()); b.textContent = 'コピーしました'; } catch { inp.select(); b.textContent = '長押しでコピーしてね'; }
    }
  });
  render();

  /* ---------- 設定 → データ引き継ぎ ---------- */
  const box = $('xfCode'), ask = $('xfAsk');
  const say = (t, err = false) => { $('xfMsg').textContent = t; $('xfMsg').classList.toggle('err', err); };
  const cars = s => Object.keys(s.cars).filter(id => Object.hasOwn(CAR_BY_ID, id)).length;
  const sum = s => `コイン ${s.coins.toLocaleString()}・チケット ${s.tickets.toLocaleString()}・車 ${cars(s)}台`;
  if (box) {
    $('xfCopy').onclick = async () => {
      ask.hidden = true;
      const code = encodeSave(getSave());
      let copied = true;
      try {   // the ClipboardItem promise keeps Safari's user-gesture while the code is compressed
        await navigator.clipboard.write([new ClipboardItem({ 'text/plain': code.then(c => new Blob([c], { type: 'text/plain' })) })]);
      } catch {
        try { await navigator.clipboard.writeText(await code); } catch { copied = false; }
      }
      try { box.value = await code; } catch { return say('このブラウザではコードを作れません（iOS 16.4 以降 / 最新の Chrome で使えます）', true); }
      if (!copied) box.select();
      say(copied ? 'コピーしました。移したい先の 設定 →「データ引き継ぎ」→「コードを貼り付け」で読み込めます' : 'コードを長押しでコピーしてね');
    };
    $('xfPaste').onclick = async () => {
      ask.hidden = true;
      if (!box.value.trim()) try { box.value = await navigator.clipboard.readText(); } catch { /* pasted by hand below */ }
      if (!box.value.trim()) { box.focus(); return say('下の欄にコードを貼り付けてから、もう一度押してね'); }
      say('確認中…');
      const s = await decodeSave(box.value);
      if (!s) return say('コードが正しくありません。途中で切れていないか確かめてね', true);
      say('');
      ask.innerHTML = '<p>いまのデータを、このコードのデータに<b>置き換えます</b>。いまのデータは元に戻せません（ゴーストはそのまま）</p>'
        + `<div class="pwa-cmp"><span>いま</span><b>${sum(getSave())}</b><span>コード</span><b>${sum(s)}</b></div>`
        + '<div class="pwa-acts"><button class="btn sm" data-x="no">やめる</button><button class="btn sm danger" data-x="yes">置き換える</button></div>';
      ask.hidden = false;
      ask.onclick = e => {
        const b = e.target.closest('[data-x]');
        if (!b) return;
        ask.hidden = true;
        if (b.dataset.x !== 'yes') return say('やめました');
        const cur = getSave();   // the same object ui.js holds, so nothing can write the old data back
        for (const k of Object.keys(cur)) delete cur[k];
        Object.assign(cur, s);
        persist();
        box.value = '';
        say('引き継ぎました。読み込み直します…');
        setTimeout(() => location.reload(), 700);
      };
    };
  }
}
