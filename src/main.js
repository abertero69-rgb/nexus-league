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
let leagueRules = null, rulesEditing = false, rulesLoading = false;
let mySubmissions = [];
let editingMatchId = null;
let registrationsOpen = true, settingsLoaded = false;
const submissionFor = id => mySubmissions.find(x => Number(x.match_id) === Number(id));

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
    a.pts += m.score1; b.pts += m.score2;
    if (m.score1 > m.score2) { a.pg++; b.pp++; }
    else { b.pg++; a.pp++; }
  }
  return rows.sort((a,b) => b.pts-a.pts || (b.gf-b.gc)-(a.gf-a.gc) || b.gf-a.gf || a.name.localeCompare(b.name));
}

function setNotice(message) { notice = message; render(); }
async function refresh() {
  if (!db) return;
  const [p,m,a,r,settings] = await Promise.all([
    db.from('profiles').select('*').order('created_at'),
    db.from('matches').select('*').order('round_no').order('id'),
    user ? db.from('admins').select('id').eq('id',user.id) : Promise.resolve({data:[]}),
    user ? db.rpc('my_match_submissions') : Promise.resolve({data:[]}),
    db.from('league_settings').select('registrations_open').eq('id',1).single(),
  ]);
  if (p.error || m.error) notice = p.error?.message || m.error?.message;
  profiles = p.data || []; matches = m.data || []; admin = !!a.data?.length;
  mySubmissions = r.data || [];
  settingsLoaded = !settings.error && !!settings.data;
  if (settingsLoaded) registrationsOpen = settings.data.registrations_open === true;
  else notice = 'No se pudo consultar el estado de las inscripciones: ' + (settings.error?.message || 'Sin datos');
  if (r.error) notice = 'Error al cargar los resultados individuales: ' + r.error.message;
  if (a.error) notice = 'Error al verificar administrador: ' + a.error.message;
  render();
}

async function loadRules() {
  if (!db) return;
  rulesLoading = true;
  const {data,error} = await db.from('league_rules')
    .select('id,title,content,updated_at').eq('id',1).maybeSingle();
  rulesLoading = false;
  if (error) notice = 'No se pudo cargar el reglamento: ' + error.message;
  else leagueRules = data;
  if (tab === 'reglamento') render();
}

async function saveRules(e) {
  e.preventDefault();
  if (!admin || !user) return setNotice('Solo el administrador puede editar el reglamento.');
  const form = e.currentTarget;
  const title = form.elements.title.value.trim();
  const content = form.elements.content.value.trim();
  if (!title || !content) return setNotice('Completá el título y el contenido del reglamento.');
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  const {data,error} = await db.from('league_rules').update({
    title, content, updated_at: new Date().toISOString(), updated_by: user.id
  }).eq('id',1).select('id,title,content,updated_at').single();
  if (error) {
    button.disabled = false;
    return setNotice('No se pudo guardar el reglamento: ' + error.message);
  }
  leagueRules = data;
  rulesEditing = false;
  notice = 'Reglamento publicado correctamente.';
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
  if (authMode === 'signup' && (!registrationsOpen || !settingsLoaded)) authMode = 'signin';
  app.innerHTML = `<header><div class="shell top"><div class="brand">    </div><img src="/images/logo-transparente.png" alt="SALTY LEAGUE" class="logo-central"><div>${authenticated ? `<span class="small">${esc(displayName())}</span> <button data-act="logout" class="secondary">Salir</button>` : `<button data-act="loginTab">Ingresar / Registrarse</button>`}</div></div></header>
  <main class="shell"><section class="hero"><span class="tag">TEMPORADA 1 · LIGA INDIVIDUAL</span><h1>SALTY LEAGUE</h1><p>Liga del Salty Chat por los puntos, como se juega en la villa. El primero en llegar a 5 gana. Si no llegas a 5 pierde la familia.</p><div class="stats"><div><b>${profiles.length}</b><small>Jugadores</small></div><div><b>${matches.length}</b><small>Enfrentamientos</small></div><div><b>${matches.filter(x=>x.status==='confirmed').length}</b><small>Confirmados</small></div></div></section>
  ${notice ? `<div class="notice">${esc(notice)} <button data-act="clear" class="secondary">×</button></div>` : ''}
  <nav>${ [['tabla','Clasificación'],['partidas','Partidas'],['jugadores','Jugadores'],['reglamento','Reglamento'],['cuenta','Mi cuenta']].map(([id,label])=>`<button class="${tab===id?'active':'secondary'}" data-tab="${id}">${label}</button>`).join('')}</nav>
  ${tab==='tabla' ? `<section class="panel"><h2>Tabla de posiciones</h2><div class="overflow"><table><thead><tr><th>#</th><th>Jugador</th><th>Sets Jugados</th><th>Peleas Ganadas</th><th>Peleas Perdidas</th><th>Puntos</th></tr></thead><tbody>${standings().map((r,i)=>`<tr><td>${i+1}</td><td>${esc(r.name.charAt(0).toUpperCase() + r.name.slice(1))}</td><td>${r.pj}</td><td>${r.gf}</td><td>${r.gc}</td><td><strong>${r.pts}</strong></td></tr>`).join('')||'<tr><td colspan="6">Todavía no hay participantes.</td></tr>'}</tbody></table></div></section>` : ''}
  ${tab==='jugadores' ? `<section class="panel"><h2>Jugadores inscriptos</h2><div class="tiles">${profiles.map(p=>`<div class="tile">${esc(p.nickname.charAt(0).toUpperCase() + p.nickname.slice(1))}</div>`).join('')||'Todavía no hay jugadores.'}</div></section>` : ''}
  ${tab==='partidas' ? `<section class="panel"><h2>Calendario y resultados</h2>${admin ? `<button data-act="generate">Generar calendario todos contra todos</button><p class="muted">Solo se puede generar una vez por temporada. Inscribí a todos antes de generarlo.</p>` : ''}${matches.map(m=>{
    const mine = authenticated && [m.player1,m.player2].includes(user.id);
    const sub = submissionFor(m.id);
    const conflict = sub?.my_score1 != null && sub.rival_submitted && (sub.my_score1 !== sub.rival_score1 || sub.my_score2 !== sub.rival_score2);
    const label = m.status === 'confirmed' ? '✓ Confirmado y bloqueado' : m.status === 'pending' ? '⏳ Pendiente (sistema anterior)' : conflict ? '⚠️ Resultados diferentes: revisar' : sub?.my_score1 != null ? (sub.rival_submitted ? '⏳ Revisando resultados' : '⏳ Esperando al rival') : sub?.rival_submitted ? '⏳ Tu rival ya informó su resultado' : 'Por jugar';
    return `<article class="match"><div><small>Fecha ${m.round_no} · ${label}</small><h3>${esc(nick(m.player1))} <span class="versus">${m.status === 'confirmed' || m.status === 'pending' ? `${m.score1} — ${m.score2}` : 'VS'}</span> ${esc(nick(m.player2))}</h3>${mine && m.status === 'scheduled' ? `<p class="muted">${sub?.my_score1 != null ? `Tu resultado: ${sub.my_score1}-${sub.my_score2}. ` : ''}${conflict ? `⚠️ El rival informó ${sub.rival_score1}-${sub.rival_score2}. No coincide: revisen y corrijan el marcador.` : sub?.rival_submitted ? 'Tu rival ya cargó su resultado.' : ''}</p>` : ''}</div><div>${mine && m.status === 'scheduled' ? `<button data-act="report" data-id="${m.id}">${sub?.my_score1 != null ? 'Corregir mi resultado' : 'Cargar mi resultado'}</button>` : ''}${mine && m.status === 'scheduled' && editingMatchId === m.id ? `<form class="result-form" data-match-id="${m.id}" style="margin-top:16px;padding:16px;border:1px solid #555;border-radius:10px;display:grid;gap:12px;max-width:420px">
      <strong>Informar mi resultado</strong>
      <label>¿Ganaste o perdiste el set?
        <select name="outcome" required style="display:block;width:100%;padding:10px;margin-top:5px">
          <option value="win" ${sub?.my_score1 != null && (user.id === m.player1 ? sub.my_score1 : sub.my_score2) < 5 ? '' : 'selected'}>🏆 Gané el set</option>
          <option value="loss" ${sub?.my_score1 != null && (user.id === m.player1 ? sub.my_score1 : sub.my_score2) < 5 ? 'selected' : ''}>❌ Perdí el set</option>
        </select>
      </label>
      <label>¿Cuántas peleas ganaste? (0 a 5)
        <input name="wins" type="number" min="0" max="5" step="1" required value="${sub?.my_score1 != null ? (user.id === m.player1 ? sub.my_score1 : sub.my_score2) : 5}" style="display:block;width:100%;box-sizing:border-box" />
      </label>
      <label>¿Cuántas peleas perdiste? (0 a 5)
        <input name="losses" type="number" min="0" max="5" step="1" required value="${sub?.my_score1 != null ? (user.id === m.player1 ? sub.my_score2 : sub.my_score1) : 0}" style="display:block;width:100%;box-sizing:border-box" />
      </label>
      <div class="actions"><button type="submit">Guardar resultado</button><button type="button" class="secondary" data-act="cancelReport">Cancelar</button></div>
      <p class="muted">El ganador debe tener 5 peleas ganadas y el perdedor 5 peleas ganadas por su rival. El resultado quedará pendiente hasta que ambos jugadores coincidan.</p>
    </form>` : ''}</div></article>`;
  }).join('')||'<p>El administrador todavía no generó el calendario.</p>'}</section>` : ''}
  ${tab==='reglamento' ? `<section class="panel"><h2>📜 Reglamento oficial</h2>
    ${rulesLoading ? '<p class="muted">Cargando reglamento...</p>' :
      rulesEditing && admin ? `<form id="rules-form">
        <label>Título<input name="title" type="text" maxlength="150" required value="${esc(leagueRules?.title || 'Reglamento oficial de SALTY LEAGUE')}" /></label>
        <label>Contenido<textarea name="content" rows="20" maxlength="50000" required style="width:100%;box-sizing:border-box;min-height:320px;resize:vertical;white-space:pre-wrap">${esc(leagueRules?.content || '')}</textarea></label>
        <div class="actions"><button type="submit">💾 Guardar y publicar</button><button type="button" data-act="cancelRules" class="secondary">Cancelar</button></div>
        <p class="muted">Usá líneas en blanco para separar artículos. Los cambios se publican al guardar.</p>
      </form>` : `<h3>${esc(leagueRules?.title || 'Reglamento oficial de SALTY LEAGUE')}</h3>
        ${leagueRules?.content ? `<div style="white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.7">${esc(leagueRules.content)}</div>` : '<p class="muted">El reglamento todavía no fue publicado.</p>'}
        ${leagueRules?.updated_at ? `<p class="muted">Última actualización: ${esc(new Date(leagueRules.updated_at).toLocaleString('es-AR'))}</p>` : ''}
        ${admin ? '<button data-act="editRules">✏️ Editar reglamento</button>' : ''}`}
    </section>` : ''}
  ${tab==='cuenta' ? `<section class="panel"><h2>${authenticated?'Mi cuenta':'Ingresá a la liga'}</h2>${!authenticated ? `<div class="actions"><button data-act="showSignin" class="${authMode==='signin'?'':'secondary'}">Iniciar sesión</button>${registrationsOpen && settingsLoaded ? `<button data-act="showSignup" class="${authMode==='signup'?'':'secondary'}">Crear cuenta</button>` : ''}</div><form id="auth"><label>Nombre de usuario<input name="username" type="text" minlength="3" maxlength="24" pattern="[A-Za-z0-9_]{3,24}" required autocomplete="username" placeholder="Ej.: Adruagtz" /></label><label>Contraseña (mínimo 8 caracteres)<input name="password" type="password" minlength="8" maxlength="128" required autocomplete="${authMode==='signup'?'new-password':'current-password'}" /></label>${authMode==='signup' && registrationsOpen && settingsLoaded ? '<div id="turnstile-container"></div>' : ''}<div class="actions"><button type="submit">${authMode==='signup'?'Crear mi cuenta':'Ingresar'}</button></div></form><p class="muted">No necesitás correo electrónico. Recordá tu usuario y contraseña.</p>` : registered ? `<p>¡Bienvenido, <strong>${esc(profile().nickname)}</strong>! Ya estás inscripto.</p>` : `<p>Sesión iniciada como <strong>${esc(displayName())}</strong>. Si es una cuenta anterior, todavía no tiene inscripción en esta temporada.</p>`}</section>` : ''}
  ${tab==='cuenta' && admin ? `<section class="panel"><h2>🔐 Administración de inscripciones</h2>
    <p><strong>Estado actual:</strong> ${!settingsLoaded ? 'No disponible' : registrationsOpen ? '🟢 Inscripciones abiertas' : '🔴 Inscripciones cerradas'}</p>
    <p class="muted">Solo los administradores pueden modificar este estado. Los jugadores existentes podrán seguir ingresando.</p>
    <button data-act="toggleRegistrations" ${!settingsLoaded ? 'disabled' : ''}>${registrationsOpen ? '🔒 Cerrar inscripciones' : '🔓 Reabrir inscripciones'}</button>
  </section>` : ''}
  </main><footer class="shell">SALTY LEAGUE · Proyecto independiente para la comunidad de Street Fighter 6.</footer>`;
  app.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; notice = ''; render(); });
  app.querySelectorAll('[data-act]').forEach(b => b.onclick = () => handle(b.dataset.act,b.dataset.id));
  app.querySelectorAll('.result-form').forEach(form => form.onsubmit = submitResult);
  const rulesForm = app.querySelector('#rules-form');
  if (rulesForm) rulesForm.onsubmit = saveRules;
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
  if (authMode === 'signup' && (!settingsLoaded || !registrationsOpen)) return setNotice('Las inscripciones están cerradas o su estado no está disponible.');
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

async function submitResult(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const matchId = Number(form.dataset.matchId);
  const m = matches.find(x => x.id === matchId);
  if (!m || !user || ![m.player1,m.player2].includes(user.id) || m.status !== 'scheduled') {
    return setNotice('No podés informar el resultado de esta partida.');
  }
  const outcome = form.elements.outcome.value;
  const wins = Number(form.elements.wins.value);
  const losses = Number(form.elements.losses.value);
  if (!Number.isInteger(wins) || !Number.isInteger(losses) ||
      !['win','loss'].includes(outcome) ||
      !(outcome === 'win' ? wins === 5 && losses >= 0 && losses <= 4 :
        losses === 5 && wins >= 0 && wins <= 4)) {
    return setNotice('El resultado no coincide con la opción Gané/Perdí. El ganador debe tener 5 peleas y el perdedor entre 0 y 4.');
  }
  // La función SQL recibe siempre los marcadores en orden player1, player2.
  const s1 = user.id === m.player1 ? wins : losses;
  const s2 = user.id === m.player1 ? losses : wins;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  const {data,error} = await action('submit_match_score', {
    p_match_id: matchId, p_score1: s1, p_score2: s2
  });
  if (error) {
    button.disabled = false;
    return setNotice('No se pudo guardar el resultado: ' + error.message);
  }
  editingMatchId = null;
  notice = data === 'confirmed' ? '¡Ambos resultados coinciden! Partida confirmada y bloqueada.' :
    data === 'disputed' ? '⚠️ Los resultados no coinciden. Revisá tu marcador y corregilo si es necesario.' :
    'Resultado guardado. Esperando que tu rival cargue el suyo.';
  await refresh();
}

async function handle(act,id) {
  if (act==='toggleRegistrations') {
    if (!admin || !user || !settingsLoaded) return setNotice('No tenés permiso para modificar las inscripciones.');
    const next = !registrationsOpen;
    if (!confirm(next ? '¿Reabrir las inscripciones?' : '¿Cerrar las inscripciones? Los jugadores existentes podrán seguir ingresando.')) return;
    const {data,error} = await action('set_registrations_open',{p_open:next});
    if (error) return setNotice('No se pudo cambiar el estado: ' + error.message);
    registrationsOpen = data === true;
    notice = registrationsOpen ? 'Inscripciones reabiertas.' : 'Inscripciones cerradas. No se aceptan nuevas cuentas.';
    await refresh(); return;
  }
  if (act==='editRules') { if (!admin) return; rulesEditing=true; notice=''; render(); return; }
  if (act==='cancelRules') { rulesEditing=false; render(); return; }
  if (act==='clear') { notice=''; render(); return; }
  if (act==='loginTab') { tab='cuenta'; render(); return; }
  if (act==='showSignin' || act==='showSignup') { if (act==='showSignup' && (!registrationsOpen || !settingsLoaded)) return setNotice('Las inscripciones están cerradas.'); authMode=act==='showSignup'?'signup':'signin'; turnstileToken=''; turnstileWidget=null; notice=''; render(); return; }
  if (act==='logout') { const {error}=await db.auth.signOut(); if(error) setNotice(error.message); return; }
  if (act==='generate') {
    if (!confirm('¿Generar todos los enfrentamientos? No podrás agregar nuevos jugadores a esta temporada automáticamente.')) return;
    const {data,error}=await action('create_round_robin'); notice=error?error.message:`Calendario generado: ${data} partidas.`; await refresh(); return;
  }
  if (act==='report') {
    const m = matches.find(x => x.id === Number(id));
    if (!m || m.status !== 'scheduled' || !user || ![m.player1,m.player2].includes(user.id)) return;
    editingMatchId = m.id;
    notice = '';
    render();
    return;
  }
  if (act==='cancelReport') { editingMatchId = null; render(); return; }

}

if (db) {
  loadRules();
  db.auth.onAuthStateChange((_event,session) => { user=session?.user||null; refresh(); });
  db.auth.getSession().then(({data}) => { user=data.session?.user||null; refresh(); });
}

// Easter egg de SALTY LEAGUE: 10% de probabilidad por carga de página.
// No depende de render() para que no reaparezca al cambiar de sección.
function initializeSaltyEasterEgg() {
  if (Math.random() >= 0.1) return;

  const style = document.createElement('style');
  style.textContent = `
    .salty-easter-egg {
      position: fixed;
      right: 16px;
      bottom: 12px;
      z-index: 9999;
      width: min(230px, 40vw);
      border: 0;
      padding: 0;
      margin: 0;
      background: transparent;
      cursor: pointer;
      filter: drop-shadow(0 8px 12px rgba(0,0,0,.45));
      animation: salty-egg-enter .35s ease-out both;
    }
    .salty-easter-egg img { display: block; width: 100%; height: auto; }
    .salty-easter-egg:focus-visible { outline: 3px solid #b795ff; border-radius: 12px; }
    @keyframes salty-egg-enter {
      from { opacity: 0; transform: translateY(35px) scale(.85); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @media (max-width: 600px) {
      .salty-easter-egg { right: 8px; bottom: 8px; width: min(165px, 43vw); }
    }
    @media (prefers-reduced-motion: reduce) {
      .salty-easter-egg { animation: none; }
    }
  `;
  document.head.appendChild(style);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'salty-easter-egg';
 button.setAttribute('aria-label', 'Reproducir sorpresa');
button.title = '¡Tocá para escuchar!';

  const img = document.createElement('img');
  img.src = '/images/easter-egg.png';
  img.alt = 'Sorpresa de SALTY LEAGUE';
  button.appendChild(img);

  const audio = new Audio('/images/easter-egg.mp3');
  audio.preload = 'auto';

button.addEventListener('click', () => {
  if (audio.paused) {
    audio.play().catch(console.error);
  }
});

audio.addEventListener('ended', () => {
  button.remove();
});

  // Solo mostrar cuando la imagen esté disponible.
  img.addEventListener('load', () => {
    document.body.appendChild(button);
    audio.play().catch(() => {
      // Algunos navegadores exigen una interacción para reproducir audio.
      // En ese caso, la imagen actúa como botón para escucharlo.
    });
window.setTimeout(() => {
  if (audio.paused) {
    button.remove();
  }
}, 20000);
  }, { once: true });
  img.addEventListener('error', () => {
    console.warn('No se encontró /images/easter-egg.png');
  }, { once: true });
}

initializeSaltyEasterEgg();

// Segundo Easter Egg - Pispu
function initializePispuEasterEgg() {
  if (Math.random() >= 0.1) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'salty-easter-egg';
  button.style.position = 'fixed';
  button.style.left = '15px';
  button.style.right = 'auto';
  button.style.bottom = '15px';
  button.style.zIndex = '9999';
  button.style.background = 'transparent';
  button.style.border = 'none';
  button.style.padding = '0';
  button.style.cursor = 'pointer';
  button.title = '¡Tocá para escuchar!';
  button.setAttribute('aria-label', 'Reproducir sorpresa Pispu');

  const img = document.createElement('img');
  img.alt = 'Sorpresa Pispu';
  img.style.width = '200px';
  img.style.maxWidth = '35vw';
  img.style.height = 'auto';
  button.appendChild(img);

  const audio = new Audio('/images/pispu.mp3');
  audio.preload = 'auto';

  button.addEventListener('click', () => {
    if (audio.paused) {
      audio.play().catch(console.error);
    }
  });

  audio.addEventListener('ended', () => {
    button.remove();
  });

  img.addEventListener('load', () => {
    document.body.appendChild(button);
    audio.play().catch(() => {});

    window.setTimeout(() => {
      if (audio.paused) {
        button.remove();
      }
    }, 20000);
  }, { once: true });

  img.src = '/images/pispu.png';
}

initializePispuEasterEgg();
function initializeMotoEasterEgg() {
  if (Math.random() >= 0.10) return;

  const button = document.createElement('button');

  button.id = 'moto-easter-egg';
  button.setAttribute('aria-label', 'Jugar Moto Exitada');

  Object.assign(button.style, {
    position: 'fixed',
    bottom: '0px',
    left: '50%',
    transform: 'translateX(-50%)',
    width: 'clamp(90px, 18vw, 150px)',
    padding: '0',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    zIndex: '9999',
    touchAction: 'manipulation'
  });

  const img = document.createElement('img');

  img.src = '/images/moto-cara.png';
  img.alt = 'Moto Exitada';
  img.style.width = '100%';
  img.style.display = 'block';

  button.appendChild(img);

  button.addEventListener('click', async () => {
  button.remove();

  const { data: { session } } = await db.auth.getSession();

  if (!session) {
    alert('Debes iniciar sesión para jugar.');
    return;
  }

  sessionStorage.setItem('moto_game_access', '1');
sessionStorage.setItem('moto_game_config', JSON.stringify({
  url: import.meta.env.VITE_SUPABASE_URL,
  key: import.meta.env.VITE_SUPABASE_ANON_KEY
}));
  window.location.href = '/moto-exitada.html';
});

  document.body.appendChild(button);

  window.setTimeout(() => {
    button.remove();
  }, 20000);
}

initializeMotoEasterEgg();
