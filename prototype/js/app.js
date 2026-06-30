/* Niblet — prototipo visual. Solo interacción de navegación, sin datos reales. */
(function () {
  const root = document.documentElement;
  const crumb = document.getElementById('crumb-cur');
  const palette = document.getElementById('palette');

  const titles = {
    note: 'Nota de hoy',
    tasks: 'Mis tareas',
    base: 'Diario (Base)',
    settings: 'Ajustes',
  };

  /* ---- Cambiar de vista ---- */
  function showView(view) {
    document.querySelectorAll('.view').forEach(v =>
      v.classList.toggle('active', v.dataset.viewPanel === view));
    document.querySelectorAll('.nav-item').forEach(n =>
      n.classList.toggle('active', n.dataset.view === view));
    document.querySelectorAll('.seg-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.view === view));
    if (crumb && titles[view]) crumb.textContent = titles[view];
    closePalette();
  }

  /* ---- Tema claro / oscuro ---- */
  function toggleTheme() {
    const next = root.dataset.theme === 'mocha' ? 'latte' : 'mocha';
    root.dataset.theme = next;
    const name = document.getElementById('theme-name');
    if (name) name.textContent = next === 'mocha' ? 'Mocha (oscuro)' : 'Latte (claro)';
  }

  /* ---- Acento ---- */
  function setAccent(a) { root.dataset.accent = a; }

  /* ---- Paleta de comandos ---- */
  function openPalette() {
    palette.classList.add('open');
    const inp = palette.querySelector('input');
    if (inp) { inp.value = ''; setTimeout(() => inp.focus(), 30); }
  }
  function closePalette() { palette.classList.remove('open'); }

  /* ---- Delegación de clics ---- */
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-view],[data-act],[data-accent]');
    if (!el) { if (e.target === palette) closePalette(); return; }

    if (el.dataset.accent) { setAccent(el.dataset.accent); return; }

    const act = el.dataset.act;
    if (act === 'palette') { openPalette(); return; }
    if (act === 'theme') { toggleTheme(); return; }
    if (act === 'noop') return;

    if (el.dataset.view) { showView(el.dataset.view); }
  });

  /* ---- Marcar tareas (checkbox visual) ---- */
  document.addEventListener('click', (e) => {
    const task = e.target.closest('.md-task, .task');
    if (task) task.classList.toggle('done');
  });

  /* ---- Atajos de teclado ---- */
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
    if (e.key === 'Escape') closePalette();
  });

  /* Cerrar paleta al hacer clic fuera del cuadro */
  palette.addEventListener('click', (e) => { if (e.target === palette) closePalette(); });
})();
