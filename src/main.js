import { createClient } from '@supabase/supabase-js';
import './style.css';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
const db = url && key ? createClient(url, key) : null;
// Copiá la clave PÚBLICA (Site Key) desde Cloudflare Turnstile.
const TURNSTILE_SITE_KEY = '0x4AAAAAAGL1t8sb3C7POIxP';
const app = document.querySelector('#app');
let user = null, profiles = [], matches = [], admin = false, tab = 'tabla', notice = '';
let authMode = 'signin', turnstileToken = '', turnstileWidget = null;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nick = id => profiles.find(p => p.id === id)?.nickname || 'Jugador';
const profile = () => profiles.find(p => p.id === user?.id);
const displayName = () => profile()?.nickname || user?.email?.split('@')[0] || 'Jugador';
const action = (name, args) => db.rpc(name, args);
const internalEmail = username => `${username}@players.salty.invalid`;

function standings() {
  const rows = profiles.map(p => ({id:p.id,name:p.nickname,pj:0,pg:0,pp:0,gf:0,gc:0,pts:0}));
  for (const m of matches.filter(m => m.status === 'confirmed')) {
    const a = rows.find(r => r.id === m.player1), b = rows.find(r => r.id === m.player2);
    if (!a || !b) continue;
    a.pj++; b.pj++; a.gf += m.score1; a.gc += m.score2;
    b.gf += m.score2; b.gc += m.score1;
    if (m.score1 > m.score2) { a.pg++; a.pts += 3; b.pp++; }
    else { b.pg++; b.pts += 3; a.pp++; }
  }
  return rows.sort((a,b) => b.pts-a.pts || (b.gf-b.gc)-(a.gf-a.gc) || b.gf-a.gf || a.name.localeCompare(b.name));
}

function setNotice(message) { notice = message; render(); }
async function refresh() {
  if (!db) return;
  const [p,m,a] = await Promise.all([
    db.from('profiles').select('*').order('created_at'),
    db.from('matches').select('*').order('round_no').order('id'),
    user ? db.from('admins').select('id').eq('id',user.id) : Promise.resolve({data:[]}),
  ]);
  if (p.error || m.error) notice = p.error?.message || m.error?.message;
  profiles = p.data || []; matches = m.data || []; admin = !!a.data?.length;
  if (a.error) notice = 'Error al verificar administrador: ' + a.error.message;
  render();
}

function loadTurnstile() {
  if (authMode !== 'signup' || user || !document.querySelector('#turnstile-container')) return;
  if (TURNSTILE_SITE_KEY.startsWith('PEGAR_')) {
    document.querySelector('#turnstile-container').textContent = 'Falta configurar la Site Key pública de Cloudflare.';
    return;
  }
  const mount = () => {
    const el = document.querySelector('#turnstile-container');
    if (!el || !window.turnstile) return;
    turnstileToken = '';
    turnstileWidget = window.turnstile.render(el, {
      sitekey: TURNSTILE_SITE_KEY,
      callback: token => { turnstileToken = token; },
      'expired-callback': () => { turnstileToken = ''; },
      'error-callback': () => { turnstileToken = ''; },
    });
  };
  if (window.turnstile) { mount(); return; }
  const script = document.createElement('script');
  script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  script.async = true;
  script.onload = mount;
  script.onerror = () => { const el = document.querySelector('#turnstile-container'); if (el) el.textContent = 'No se pudo cargar la verificación de seguridad.'; };
  document.head.appendChild(script);
}

function render() {
  if (!db) {
    app.innerHTML = '<main class="shell"><h1>SALTY LEAGUE</h1><section class="panel"><h2>Configuración pendiente</h2><p>Revisá VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en Vercel.</p></section></main>';
    return;
  }
  const authenticated = !!user, registered = !!profile();
  app.innerHTML = `<header><div class="shell top"><div class="brand"><span>SALTY <em>LEAGUE</em></span></div><span class="subtitle">STREET FIGHTER 6 · PRIMERO A 5</span><div>${authenticated ? `<span class="small">${esc(displayName())}</span> <button data-act="logout" class="secondary">Salir</button>` : `<button data-act="loginTab">Ingresar / Registrarse</button>`}</div></div></header>
  <main class="shell"><section class="hero"><span class="tag">TEMPORADA 1 · LIGA INDIVIDUAL</span><h1>SALTY LEAGUE</h1><p>Liga del Salty Chat por los puntos, como se juega en la villa. El primero en llegar a 5 gana. Si no llegas a 5 pierde la familia.</p><div class="stats"><div><b>${profiles.length}</b><small>Jugadores</small></div><div><b>${matches.length}</b><small>Enfrentamientos</small></div><div><b>${matches.filter(x=>x.status==='confirmed').length}</b><small>Confirmados</small></div></div></section>
  ${notice ? `<div class="notice">${esc(notice)} <button data-act="clear" class="secondary">×</button></div>` : ''}
  <nav>${[['tabla','🏆 Clasificación'],['partidas','⚔️ Partidas'],['jugadores','👥 Jugadores'],['cuenta','👤 Mi cuenta']].map(([id,label])=>`<button class="${tab===id?'active':'secondary'}" data-tab="${id}">${label}</button>`).join('')}</nav>
  ${tab==='tabla' ? `<section class="panel"><h2>Tabla de posiciones</h2><p class="muted">Victoria: 3 puntos · Derrota: 0 · Desempate: diferencia de juegos, juegos ganados.</p><div class="overflow"><table><thead><tr><th>#</th><th>Jugador</th><th>PJ</th><th>PG</th><th>PP</th><th>GF</th><th>GC</th><th>DG</th><th>PTS</th></tr></thead><tbody>${standings().map((r,i)=>`<tr><td>${i+1}</td><td>${esc(r.name)}</td><td>${r.pj}</td><td>${r.pg}</td><td>${r.pp}</td><td>${r.gf}</td><td>${r.gc}</td><td>${r.gf-r.gc}</td><td><strong>${r.pts}</strong></td></tr>`).join('')||'<tr><td colspan="9">Todavía no hay participantes.</td></tr>'}</tbody></table></div></section>` : ''}
  ${tab==='jugadores' ? `<section class="panel"><h2>Jugadores inscriptos</h2><div class="tiles">${profiles.map(p=>`<div class="tile">🥊 ${esc(p.nickname)}</div>`).join('')||'Todavía no hay jugadores.'}</div></section>` : ''}
  ${tab==='partidas' ? `<section class="panel"><h2>Calendario y resultados</h2>${admin ? `<button data-act="generate">Generar calendario todos contra todos</button><p class="muted">Solo se puede generar una vez por temporada. Inscribí a todos antes de generarlo.</p>` : ''}${matches.map(m=>`<article class="match"><div><small>Fecha ${m.round_no} · ${m.status==='confirmed'?'✓ Confirmado':m.status==='pending'?'⏳ Pendiente de confirmación':'Por jugar'}</small><h3>${esc(nick(m.player1))} <span class="versus">${m.score1===null?'VS':`${m.score1} — ${m.score2}`}</span> ${esc(nick(m.player2))}</h3></div><div>${authenticated&&[m.player1,m.player2].includes(user.id)&&m.status!=='confirmed'?`<button data-act="report" data-id="${m.id}">Cargar resultado</button> `:''}${authenticated&&m.status==='pending'&&m.reported_by!==user.id&&[m.player1,m.player2].includes(user.id)?`<button data-act="confirm" data-id="${m.id}">Confirmar</button>`:''}</div></article>`).join('')||'<p>El administrador todavía no generó el calendario.</p>'}</section>` : ''}
  ${tab==='cuenta' ? `<section class="panel"><h2>${authenticated?'Mi cuenta':'Ingresá a la liga'}</h2>${!authenticated ? `<div class="actions"><button data-act="showSignin" class="${authMode==='signin'?'':'secondary'}">Iniciar sesión</button><button data-act="showSignup" class="${authMode==='signup'?'':'secondary'}">Crear cuenta</button></div><form id="auth"><label>Nombre de usuario<input name="username" type="text" minlength="3" maxlength="24" pattern="[A-Za-z0-9_]{3,24}" required autocomplete="username" placeholder="Ej.: Adruagtz" /></label><label>Contraseña (mínimo 8 caracteres)<input name="password" type="password" minlength="8" maxlength="128" required autocomplete="${authMode==='signup'?'new-password':'current-password'}" /></label>${authMode==='signup'?'<div id="turnstile-container"></div>':''}<div class="actions"><button type="submit">${authMode==='signup'?'Crear mi cuenta':'Ingresar'}</button></div></form><p class="muted">No necesitás correo electrónico. Recordá tu usuario y contraseña.</p>` : registered ? `<p>¡Bienvenido, <strong>${esc(profile().nickname)}</strong>! Ya estás inscripto.</p>` : `<p>Sesión iniciada como <strong>${esc(displayName())}</strong>. Si es una cuenta anterior, todavía no tiene inscripción en esta temporada.</p>`}</section>` : ''}
  </main><footer class="shell">SALTY LEAGUE · Proyecto independiente para la comunidad de Street Fighter 6.</footer>`;
  app.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; notice = ''; render(); });
  app.querySelectorAll('[data-act]').forEach(b => b.onclick = () => handle(b.dataset.act,b.dataset.id));
  const auth = app.querySelector('#auth');
  if (auth) auth.onsubmit = submitAuth;
  if (tab === 'cuenta' && !authenticated && authMode === 'signup') loadTurnstile();
}

async function submitAuth(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const f = new FormData(form);
  const username = String(f.get('username')||'').trim().toLowerCase();
  const password = String(f.get('password')||'');
  if (!/^[a-z0-9_]{3,24}$/.test(username)) return setNotice('Usuario inválido: usá entre 3 y 24 letras, números o guion bajo.');
  if (password.length < 8 || password.length > 128) return setNotice('La contraseña debe tener entre 8 y 128 caracteres.');
  button.disabled = true;
  try {
    if (authMode === 'signup') {
      if (!turnstileToken) { setNotice('Completá la verificación de seguridad.'); return; }
      const response = await fetch(`${url}/functions/v1/salty-auth`, {
        method: 'POST',
        headers: {'Content-Type':'application/json', apikey:key, Authorization:`Bearer ${key}`},
        body: JSON.stringify({username,password,turnstileToken}),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) { setNotice(result.error || `No se pudo crear la cuenta (${response.status}).`); return; }
    }
    const {error} = await db.auth.signInWithPassword({email:internalEmail(username),password});
    if (error) { setNotice(authMode==='signup'?'Cuenta creada, pero no se pudo iniciar sesión. Probá ingresar con tu usuario y contraseña.':'Usuario o contraseña incorrectos.'); return; }
    tab = 'cuenta'; notice = authMode==='signup'?'¡Cuenta creada e inscripción completada!':'Sesión iniciada.';
    await refresh();
  } catch (error) {
    setNotice('Error de conexión. Revisá la red e intentá nuevamente.');
  } finally {
    button.disabled = false;
  }
}

async function handle(act,id) {
  if (act==='clear') { notice=''; render(); return; }
  if (act==='loginTab') { tab='cuenta'; render(); return; }
  if (act==='showSignin' || act==='showSignup') { authMode=act==='showSignup'?'signup':'signin'; turnstileToken=''; turnstileWidget=null; notice=''; render(); return; }
  if (act==='logout') { const {error}=await db.auth.signOut(); if(error) setNotice(error.message); return; }
  if (act==='generate') {
    if (!confirm('¿Generar todos los enfrentamientos? No podrás agregar nuevos jugadores a esta temporada automáticamente.')) return;
    const {data,error}=await action('create_round_robin'); notice=error?error.message:`Calendario generado: ${data} partidas.`; await refresh(); return;
  }
  if (act==='report') {
    const m=matches.find(x=>x.id===Number(id)); if(!m)return;
    // PENDIENTE: cambiar a primero a 5 tanto aquí como en la función SQL report_match y restricciones de la tabla.
    const a=prompt(`Juegos ganados por ${nick(m.player1)} (0 a 3):`,m.score1??'3'); if(a===null)return;
    const b=prompt(`Juegos ganados por ${nick(m.player2)} (0 a 3):`,m.score2??'0'); if(b===null)return;
    const s1=Number(a),s2=Number(b);
    if(!Number.isInteger(s1)||!Number.isInteger(s2)||!((s1===3&&s2>=0&&s2<=2)||(s2===3&&s1>=0&&s1<=2))) {setNotice('Marcador inválido. Por ahora la base admite 3-0, 3-1 o 3-2. Falta migrar a primero a 5.');return;}
    const {error}=await action('report_match',{p_match_id:Number(id),p_score1:s1,p_score2:s2}); notice=error?error.message:'Resultado enviado. Falta confirmación del rival.'; await refresh(); return;
  }
  if (act==='confirm') { if(!confirm('¿Confirmás el resultado informado por tu rival?'))return; const {error}=await action('confirm_match',{p_match_id:Number(id)}); notice=error?error.message:'¡Resultado confirmado!'; await refresh(); }
}

if (db) {
  db.auth.onAuthStateChange((_event,session) => { user=session?.user||null; refresh(); });
  db.auth.getSession().then(({data}) => { user=data.session?.user||null; refresh(); });
}
