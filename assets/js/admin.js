/* IServe admin panel. Talks to Supabase Auth + REST with the signed-in admin's token. All authorization is enforced by database RLS. */
(() => {
  const C = window.ISERVE, app = document.getElementById('app'), $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ST = ['new', 'contacted', 'pending', 'confirmed', 'completed', 'cancelled'];
  let S = null, tab = 'dashboard', cache = {};
  try { S = JSON.parse(sessionStorage.getItem('iserve_admin')); } catch (e) {}
  const save = () => { try { S ? sessionStorage.setItem('iserve_admin', JSON.stringify(S)) : sessionStorage.removeItem('iserve_admin'); } catch (e) {} };
  const msg = (t, ok) => { const m = $('#msg'); if (m) { m.textContent = t; m.className = 'mb-3 rounded-lg p-3 text-sm ' + (ok ? 'bg-green-100 text-green-900' : 'bg-red-100 text-red-900'); m.scrollIntoView({ block: 'nearest' }); } };

  async function raw(url, opt = {}, retry = true) {
    const r = await fetch(C.supabaseUrl + url, { ...opt, headers: { apikey: C.supabaseAnonKey, 'Content-Type': 'application/json', ...(!opt.anon && S ? { Authorization: 'Bearer ' + S.token } : C.supabaseAnonKey.startsWith('eyJ') ? { Authorization: 'Bearer ' + C.supabaseAnonKey } : {}), ...(opt.headers || {}) } });
    if (r.status === 401 && S && S.refresh && retry) { if (await refresh()) return raw(url, opt, false); logout(true); throw new Error('Session expired. Sign in again.'); }
    const txt = await r.text(); let b = null; try { b = txt ? JSON.parse(txt) : null; } catch (e) {}
    if (!r.ok) throw new Error((b && (b.message || b.error_description || b.msg)) || 'Request failed (' + r.status + ')');
    return b;
  }
  const api = (p, o) => raw('/rest/v1/' + p, o);
  const rows = (p) => api(p);
  async function refresh() {
    try { const b = await raw('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: S.refresh }), anon: true }, false); S.token = b.access_token; S.refresh = b.refresh_token; save(); return true; } catch (e) { return false; }
  }
  function logout(expired) {
    if (S) fetch(C.supabaseUrl + '/auth/v1/logout', { method: 'POST', headers: { apikey: C.supabaseAnonKey, Authorization: 'Bearer ' + S.token } }).catch(() => {});
    S = null; save(); cache = {}; login(expired ? 'Your session ended. Please sign in again.' : '');
  }

  function login(note) {
    if (!C.supabaseUrl || !C.supabaseAnonKey) { app.innerHTML = '<div class="card mt-10"><h1 class="text-2xl">Admin not configured</h1><p class="mt-2 text-muted">Set supabaseUrl and supabaseAnonKey in data/site.json and rebuild. See README.</p></div>'; return; }
    app.innerHTML = `<form id="lf" class="card mx-auto mt-10 max-w-sm" novalidate><h1 class="text-2xl">IServe admin</h1><p id="msg" class="mt-3 text-sm text-red-800">${esc(note)}</p>
<label class="label mt-3" for="em">Email</label><input class="input" id="em" type="email" autocomplete="username" required>
<label class="label mt-3" for="pw">Password</label><input class="input" id="pw" type="password" autocomplete="current-password" required>
<button class="btn btn-navy mt-4 w-full" type="submit">Sign in</button></form>`;
    $('#lf').onsubmit = async (e) => {
      e.preventDefault(); const b = $('#lf button'); b.disabled = true;
      try {
        const t = await raw('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email: $('#em').value.trim(), password: $('#pw').value }), anon: true }, false);
        S = { token: t.access_token, refresh: t.refresh_token, email: t.user && t.user.email };
        const ok = await api('rpc/is_admin', { method: 'POST', body: '{}' });
        if (ok !== true) { logout(); $('#msg').textContent = 'This account is not an administrator.'; return; }
        const r = await rows('admin_users?select=role'); S.role = r[0] ? r[0].role : 'staff'; save(); shell();
      } catch (x) { S = null; save(); $('#msg').textContent = x.message.includes('Invalid') ? 'Wrong email or password.' : x.message; b.disabled = false; }
    };
  }

  const TABS = [['dashboard', 'Dashboard'], ['bookings', 'Bookings'], ['services', 'Services'], ['prices', 'Prices'], ['settings', 'Settings']];
  function shell() {
    app.innerHTML = `<header class="flex flex-wrap items-center justify-between gap-2 py-3"><b class="text-xl text-navy">IServe admin</b><span class="text-sm text-muted">${esc(S.email)} (${esc(S.role)}) <button class="btn btn-line ml-2 px-3 py-1" id="lo">Log out</button></span></header>
<nav class="mb-4 flex flex-wrap gap-2">${TABS.map(([k, t]) => `<button class="btn ${k === tab ? 'btn-navy' : 'btn-line'} px-4 py-2" data-tab="${k}">${t}</button>`).join('')}</nav><p id="msg"></p><div id="view">Loading...</div>`;
    $('#lo').onclick = () => logout();
    $$('[data-tab]').forEach((b) => b.onclick = () => { tab = b.dataset.tab; shell(); });
    ({ dashboard, bookings, services, prices, settings })[tab]().catch((e) => msg(e.message));
  }
  const meta = async () => cache.meta || (cache.meta = { cities: await rows('cities?select=*&order=id'), cats: await rows('service_categories?select=*&order=sort_order'), svcs: await rows('services?select=*&order=sort_order') });
  const fmtd = (d) => d ? new Date(d).toLocaleString() : '';

  async function dashboard() {
    const b = await rows('bookings?select=id,ref,name,phone,status,created_at,services(name)&archived_at=is.null&order=created_at.desc&limit=1000'), n = (s) => b.filter((x) => x.status === s).length;
    const cards = [['Total inquiries', b.length], ['New', n('new')], ['Pending', n('pending')], ['Confirmed', n('confirmed')], ['Completed', n('completed')], ['Cancelled', n('cancelled')]];
    $('#view').innerHTML = `<div class="grid grid-cols-2 gap-3 md:grid-cols-6">${cards.map(([t, v]) => `<div class="card"><p class="text-sm text-muted">${t}</p><p class="text-3xl font-bold text-navy">${v}</p></div>`).join('')}</div>
<h2 class="mt-6 text-xl">Recent inquiries</h2>${b.length ? `<ul class="mt-2 divide-y divide-line rounded-xl border border-line bg-white">${b.slice(0, 8).map((x) => `<li class="flex flex-wrap justify-between gap-2 px-4 py-3"><span><b>${esc(x.name)}</b> ${esc(x.phone)} <span class="text-muted">${esc(x.services && x.services.name)}</span></span><span class="text-sm text-muted">${esc(x.ref)} | ${esc(x.status)} | ${esc(fmtd(x.created_at))}</span></li>`).join('')}</ul>` : '<p class="card mt-2 text-muted">No inquiries yet. New requests from the website will appear here.</p>'}
<p class="mt-6 rounded-lg bg-white p-4 text-sm text-muted">Changes to services, prices and settings are saved to the database immediately, but the public pages only change after the site is rebuilt and deployed (see README, "Publishing changes"). Booking inquiries appear here at once.</p>`;
  }

  async function bookings() {
    const m = await meta(), b = await rows('bookings?select=*,services(name),cities(name)&order=created_at.desc&limit=500');
    $('#view').innerHTML = `<div class="mb-3 grid gap-2 sm:grid-cols-5"><input class="input sm:col-span-2" id="q" placeholder="Search phone or booking ID"><select class="input" id="fs"><option value="">All statuses</option>${ST.map((s) => `<option>${s}</option>`).join('')}</select>
<select class="input" id="fc"><option value="">All cities</option>${m.cities.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select><select class="input" id="fv"><option value="">All services</option>${m.svcs.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>
<div class="mb-3 flex flex-wrap items-center gap-4"><label class="text-sm"><input type="checkbox" id="fa"> Show archived</label><button class="btn btn-line px-4 py-2" id="csv" type="button">Download CSV (shown bookings)</button></div><div id="bl"></div>`;
    let cur = [];
    const draw = () => {
      const q = $('#q').value.replace(/[\s-]/g, '').toLowerCase(), f = (id) => $(id).value;
      const l = b.filter((x) => (!q || x.phone.includes(q) || x.ref.replace(/-/g, '').toLowerCase().includes(q) || x.id.startsWith(q)) && (!f('#fs') || x.status === f('#fs')) && (!f('#fc') || String(x.city_id) === f('#fc')) && (!f('#fv') || String(x.service_id) === f('#fv')) && ($('#fa').checked || !x.archived_at));
      cur = l;
      $('#bl').innerHTML = l.length ? l.map((x) => `<details class="card mb-2" data-id="${esc(x.id)}"><summary class="cursor-pointer"><b>${esc(x.name)}</b> ${esc(x.phone)} <span class="pill">${esc(x.status)}</span> <span class="text-sm text-muted">${esc(x.ref)} | ${esc(x.cities && x.cities.name)} | ${esc(x.services && x.services.name)} | ${esc(fmtd(x.created_at))}${x.archived_at ? ' | archived' : ''}</span></summary>
<dl class="mt-3 grid gap-1 text-sm"><div><b>Service:</b> ${esc(x.item_label || 'Not specified')}</div><div><b>Problem:</b> ${esc(x.problem || 'None given')}</div><div><b>Preferred:</b> ${esc(x.preferred_date || 'No date')} ${esc(x.preferred_time || '')}</div></dl>
<label class="label mt-3">Status</label><select class="input" data-f="status">${ST.map((s) => `<option ${s === x.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
<label class="label mt-3">Private notes (never shown publicly)</label><textarea class="input" rows="3" maxlength="2000" data-f="admin_notes">${esc(x.admin_notes)}</textarea>
<div class="mt-3 flex flex-wrap gap-2"><button class="btn btn-navy px-4 py-2" data-a="save">Save</button><button class="btn btn-line px-4 py-2" data-a="arch">${x.archived_at ? 'Unarchive' : 'Archive'}</button>${S.role === 'owner' ? '<button class="btn btn-line px-4 py-2 text-red-800" data-a="del">Delete</button>' : ''}</div></details>`).join('') : '<p class="card text-muted">No bookings match. When customers submit the form they appear here.</p>';
    };
    $$('#q,#fs,#fc,#fv,#fa').forEach((e) => e.oninput = draw); draw();
    $('#csv').onclick = () => {
      const cell = (v) => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
      const head = ['Reference', 'Status', 'Name', 'Phone', 'City', 'Service', 'Specific service', 'Problem', 'Preferred date', 'Preferred time', 'Received at', 'Archived', 'Private notes'];
      const lines = [head.map(cell).join(',')].concat(cur.map((x) => [x.ref, x.status, x.name, x.phone, x.cities && x.cities.name, x.services && x.services.name, x.item_label, x.problem, x.preferred_date, x.preferred_time, x.created_at, x.archived_at ? 'yes' : 'no', x.admin_notes].map(cell).join(',')));
      const url = URL.createObjectURL(new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })), a = document.createElement('a');
      a.href = url; a.download = 'iserve-bookings-' + new Date().toISOString().slice(0, 10) + '.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    $('#bl').onclick = async (e) => {
      const a = e.target.dataset.a; if (!a) return; const d = e.target.closest('details'), x = b.find((y) => y.id === d.dataset.id), u = 'bookings?id=eq.' + encodeURIComponent(x.id);
      try {
        if (a === 'save') { const body = { status: $('[data-f=status]', d).value, admin_notes: $('[data-f=admin_notes]', d).value.trim() || null }; await api(u, { method: 'PATCH', body: JSON.stringify(body) }); Object.assign(x, body); msg('Saved ' + x.ref, true); }
        if (a === 'arch') { const v = x.archived_at ? null : new Date().toISOString(); await api(u, { method: 'PATCH', body: JSON.stringify({ archived_at: v }) }); x.archived_at = v; draw(); msg('Updated ' + x.ref, true); }
        if (a === 'del' && confirm('Permanently delete ' + x.ref + '? This cannot be undone.')) { await api(u, { method: 'DELETE' }); b.splice(b.indexOf(x), 1); draw(); msg('Deleted', true); }
      } catch (err) { msg(err.message); }
    };
  }

  async function services() {
    const m = await meta(), sc = await rows('service_cities?select=*');
    const card = (s) => `<details class="card mb-2" data-id="${s ? s.id : ''}"><summary class="cursor-pointer font-semibold">${s ? esc(s.name) + (s.is_active ? '' : ' (inactive)') : 'Add a service'}</summary><div class="mt-3 grid gap-3 sm:grid-cols-2">
${s ? '' : `<div><label class="label">Slug (letters, numbers, hyphens)</label><input class="input" data-f="slug" placeholder="water-tank-cleaning"></div>`}<div><label class="label">Name</label><input class="input" data-f="name" maxlength="120" value="${esc(s && s.name)}"></div>
<div><label class="label">Category</label><select class="input" data-f="category_id">${m.cats.map((c) => `<option value="${c.id}" ${s && s.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
<div><label class="label">Sort order</label><input class="input" type="number" data-f="sort_order" value="${s ? s.sort_order : 99}"></div>
<div class="sm:col-span-2"><label class="label">Short description (cards)</label><textarea class="input" rows="2" maxlength="300" data-f="short_description">${esc(s && s.short_description)}</textarea></div>
<div><label class="label">SEO title (max 70)</label><input class="input" maxlength="70" data-f="seo_title" value="${esc(s && s.seo_title)}"></div><div><label class="label">Meta description (max 170)</label><input class="input" maxlength="170" data-f="seo_description" value="${esc(s && s.seo_description)}"></div>
<div class="sm:col-span-2 flex flex-wrap gap-4"><label><input type="checkbox" data-f="is_active" ${s && s.is_active ? 'checked' : ''}> Active (published)</label><label><input type="checkbox" data-f="is_featured" ${s && s.is_featured ? 'checked' : ''}> Featured</label>
${s ? m.cities.map((c) => `<label><input type="checkbox" data-city="${c.id}" ${sc.some((r) => r.service_id === s.id && r.city_id === c.id && r.is_available) ? 'checked' : ''}> ${esc(c.name)}</label>`).join('') : ''}</div></div>
<button class="btn btn-navy mt-3 px-4 py-2" data-a="save">${s ? 'Save service' : 'Create service'}</button></details>`;
    $('#view').innerHTML = card(null) + m.svcs.map(card).join('');
    $('#view').onclick = async (e) => {
      if (e.target.dataset.a !== 'save') return; const d = e.target.closest('details'), v = (k) => { const el = $(`[data-f=${k}]`, d); return el.type === 'checkbox' ? el.checked : el.value.trim(); }, id = d.dataset.id;
      const body = { name: v('name'), category_id: +v('category_id'), sort_order: +v('sort_order') || 0, short_description: v('short_description') || null, seo_title: v('seo_title') || null, seo_description: v('seo_description') || null, is_active: v('is_active'), is_featured: v('is_featured') };
      if (body.name.length < 2) return msg('Enter a service name (at least 2 characters).');
      if (!id && !/^[a-z0-9-]+$/.test(v('slug'))) return msg('Slug may only contain lowercase letters, numbers and hyphens.');
      try {
        let sid = id; if (id) await api('services?id=eq.' + id, { method: 'PATCH', body: JSON.stringify(body) });
        else { const r = await api('services', { method: 'POST', body: JSON.stringify({ ...body, slug: v('slug') }), headers: { Prefer: 'return=representation' } }); sid = r[0].id; await api('service_cities', { method: 'POST', body: JSON.stringify(m.cities.map((c) => ({ service_id: sid, city_id: c.id, is_available: true }))) }); }
        if (id) await api('service_cities?on_conflict=service_id,city_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify($$('[data-city]', d).map((c) => ({ service_id: +id, city_id: +c.dataset.city, is_available: c.checked }))) });
        cache = {}; msg('Service saved. Rebuild the site to publish page changes.', true); setTimeout(shell, 900);
      } catch (err) { msg(err.message); }
    };
  }

  async function prices() {
    const m = await meta(); const sid = cache.sid || (m.svcs[0] && m.svcs[0].id); cache.sid = sid;
    const p = await rows('price_items?select=*&service_id=eq.' + sid + '&order=sort_order,id');
    const row = (x) => `<div class="card mb-2" data-id="${x ? x.id : ''}"><div class="grid gap-2 sm:grid-cols-4"><div class="sm:col-span-2"><label class="label">Label</label><input class="input" data-f="label" value="${esc(x && x.label)}"></div>
<div><label class="label">Type</label><select class="input" data-f="price_type">${['range', 'fixed', 'quote'].map((t) => `<option ${x && x.price_type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
<div><label class="label">Unit</label><select class="input" data-f="unit">${['job', 'unit'].map((t) => `<option ${x && x.unit === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
<div><label class="label">Min (PKR)</label><input class="input" type="number" min="0" step="1" data-f="price_min" value="${esc(x && x.price_min)}"></div><div><label class="label">Max (PKR)</label><input class="input" type="number" min="0" step="1" data-f="price_max" value="${esc(x && x.price_max)}"></div>
<div><label class="label">Materials</label><select class="input" data-f="includes_materials">${['unknown', 'included', 'excluded'].map((t) => `<option ${x && x.includes_materials === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
<div><label class="label">City</label><select class="input" data-f="city_id"><option value="">All cities</option>${m.cities.map((c) => `<option value="${c.id}" ${x && x.city_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
<div class="sm:col-span-2"><label class="label">Note (labor, materials, what is included)</label><input class="input" maxlength="200" data-f="cost_note" value="${esc(x && x.cost_note)}"></div><div class="sm:col-span-2"><label class="label">Unit description (for per-unit prices)</label><input class="input" maxlength="60" data-f="unit_label" value="${esc(x && x.unit_label)}"></div></div>
<div class="mt-2 flex flex-wrap items-center gap-4"><label><input type="checkbox" data-f="is_published" ${x && x.is_published ? 'checked' : ''}> Show publicly</label><label><input type="checkbox" data-f="is_estimate" ${!x || x.is_estimate ? 'checked' : ''}> Indicative estimate</label>
<button class="btn btn-navy px-4 py-2" data-a="save">${x ? 'Save price' : 'Add price'}</button>${x ? '<button class="btn btn-line px-4 py-2" data-a="del">Delete</button>' : ''}</div></div>`;
    $('#view').innerHTML = `<label class="label" for="sv">Service</label><select class="input mb-4 max-w-md" id="sv">${m.svcs.map((s) => `<option value="${s.id}" ${s.id === sid ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>${row(null)}${p.map(row).join('')}`;
    $('#sv').onchange = (e) => { cache.sid = +e.target.value; shell(); };
    $('#view').onclick = async (e) => {
      const a = e.target.dataset.a; if (!a) return; const d = e.target.closest('[data-id]'), id = d.dataset.id, old = p.find((y) => String(y.id) === id), v = (k) => { const el = $(`[data-f=${k}]`, d); return el.type === 'checkbox' ? el.checked : el.value.trim(); };
      try {
        if (a === 'del') { if (!confirm('Delete this price?')) return; await api('price_items?id=eq.' + id, { method: 'DELETE' }); }
        else {
          const t = v('price_type'), mn = v('price_min') === '' ? null : +v('price_min'), mx = v('price_max') === '' ? null : +v('price_max');
          if (v('label').length < 2) return msg('Enter a label.');
          if (t === 'range' && (mn === null || mx === null || mn < 0 || mx < mn)) return msg('A range needs a minimum, and a maximum that is not lower than the minimum.');
          if (t === 'fixed' && (mn === null || mn < 0 || (mx !== null && mx !== mn))) return msg('A fixed price needs one amount (leave maximum empty).');
          const body = { service_id: sid, label: v('label'), price_type: t, price_min: t === 'quote' ? null : mn, price_max: t === 'quote' ? null : (t === 'fixed' ? null : mx), unit: v('unit'), unit_label: v('unit_label') || null, includes_materials: v('includes_materials'), cost_note: v('cost_note') || null, city_id: v('city_id') ? +v('city_id') : null, is_published: v('is_published'), is_estimate: v('is_estimate') };
          const big = old && old.price_min && mn && Math.abs(mn - old.price_min) / old.price_min > 0.25, vis = old ? old.is_published !== body.is_published : body.is_published;
          if ((big || vis || !body.is_estimate) && !confirm(`Publish this change?\n\n${body.label}: ${t === 'quote' ? 'quotation only' : 'PKR ' + mn + (mx !== null && t === 'range' ? ' to ' + mx : '')}\nShown publicly: ${body.is_published ? 'yes' : 'no'}\nLabeled as indicative estimate: ${body.is_estimate ? 'yes' : 'NO (shown as a firm price)'}`)) return;
          await api(id ? 'price_items?id=eq.' + id : 'price_items', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(body) });
        }
        msg('Price saved. Rebuild the site to publish it.', true); setTimeout(shell, 700);
      } catch (err) { msg(err.message); }
    };
  }

  async function settings() {
    const m = await meta(), r = await rows('site_settings?select=*'), g = (k) => (r.find((x) => x.key === k) || {}).value || '';
    const F = [['phone', 'Business phone (03XXXXXXXXX)'], ['phone_display', 'Phone as shown (for example 0311 7420474)'], ['whatsapp', 'WhatsApp number, international format (92311...)'], ['business_hours', 'Business hours (leave empty if not published)'],
      ['facebook', 'Facebook URL'], ['instagram', 'Instagram URL'], ['tiktok', 'TikTok URL'], ['youtube', 'YouTube URL'], ['linkedin', 'LinkedIn URL'], ['pinterest', 'Pinterest URL']];
    $('#view').innerHTML = `<form id="sf" class="card grid gap-3 sm:grid-cols-2" novalidate>${F.map(([k, t]) => `<div><label class="label">${t}</label><input class="input" data-k="${k}" value="${esc(g(k))}"></div>`).join('')}
<div class="sm:col-span-2"><label class="label">Pricing disclaimer</label><textarea class="input" rows="3" maxlength="600" data-k="price_notice">${esc(g('price_notice'))}</textarea></div>
<div class="sm:col-span-2"><p class="label">Service cities (active)</p>${m.cities.map((c) => `<label class="mr-4"><input type="checkbox" data-city="${c.id}" ${c.is_active ? 'checked' : ''}> ${esc(c.name)}</label>`).join('')}</div>
<div class="sm:col-span-2"><button class="btn btn-navy" type="submit">Save settings</button></div></form>`;
    $('#sf').onsubmit = async (e) => {
      e.preventDefault(); const v = {}; $$('[data-k]').forEach((i) => v[i.dataset.k] = i.value.trim());
      if (!/^03\d{9}$/.test(v.phone)) return msg('Phone must look like 03117420474.');
      if (!/^92\d{10}$/.test(v.whatsapp)) return msg('WhatsApp must be digits only, starting 92, for example 923117420474.');
      for (const k of ['facebook', 'instagram', 'tiktok', 'youtube', 'linkedin', 'pinterest']) if (v[k] && !/^https:\/\/\S+$/.test(v[k])) return msg(k + ' must be a full https:// link or empty.');
      if (v.price_notice.length < 20) return msg('The pricing disclaimer cannot be empty.');
      if (g('price_notice') !== v.price_notice && !confirm('Change the public pricing disclaimer?')) return;
      try {
        await api('site_settings?on_conflict=key', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(Object.entries(v).map(([key, value]) => ({ key, value }))) });
        await Promise.all($$('[data-city]').map((c) => api('cities?id=eq.' + c.dataset.city, { method: 'PATCH', body: JSON.stringify({ is_active: c.checked }) })));
        cache = {}; msg('Settings saved. Rebuild the site to publish them.', true);
      } catch (err) { msg(err.message); }
    };
  }

  if (S && S.token) shell(); else login();
})();
