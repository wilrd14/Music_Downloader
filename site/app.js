(function () {
  'use strict';
  var KEY = 'tunedrop-theme';
  var root = document.documentElement;

  /* Tema */
  var toggle = document.getElementById('theme-toggle');
  function syncToggle() {
    if (!toggle) return;
    var dark = root.getAttribute('data-theme') !== 'light';
    toggle.setAttribute('aria-pressed', dark ? 'false' : 'true');
    toggle.setAttribute('aria-label', dark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#0b0720' : '#faf7ff');
  }
  if (toggle) {
    toggle.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem(KEY, next); } catch (e) {}
      syncToggle();
    });
  }
  syncToggle();

  /* Detección ligera de sistema: solo informa, nunca oculta contenido */
  var note = document.getElementById('platform-note');
  var text = document.getElementById('platform-text');
  if (note && text) {
    var ua = navigator.userAgent || '';
    var plat = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
    var mobile = /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(ua) ||
      (/Mac/i.test(plat) && navigator.maxTouchPoints > 1);
    var msg = '';
    if (mobile) {
      msg = 'Abre esta página desde tu PC. tunedrop no funciona en móviles ni tablets.';
    } else if (/Mac/i.test(plat)) {
      msg = 'Parece que usas macOS. Todavía no hay versión para Mac (próximamente). Puedes leer cómo funciona y volver cuando esté lista.';
    } else if (/Linux|X11|CrOS/i.test(plat + ' ' + ua) && !/Win/i.test(plat)) {
      msg = 'Parece que usas Linux. Todavía no hay versión para Linux (próximamente). El botón descarga la versión de Windows.';
    }
    if (msg) {
      text.textContent = msg;
      note.hidden = false;
      var btn = document.getElementById('dl-btn');
      if (btn && mobile) {
        btn.setAttribute('aria-describedby', 'platform-text');
      }
    }
  }

  /* Copiar comando */
  function fallbackCopy(str) {
    var ta = document.createElement('textarea');
    ta.value = str;
    ta.setAttribute('readonly', '');
    ta.className = 'visually-live';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
    return ok;
  }
  var status = document.getElementById('copy-status');
  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var src = document.querySelector(btn.getAttribute('data-copy'));
      if (!src) return;
      var str = src.textContent.trim();
      var done = function (ok) {
        var old = btn.getAttribute('data-label') || btn.textContent;
        btn.setAttribute('data-label', old);
        btn.textContent = ok ? '¡Copiado!' : 'Selecciona y copia';
        if (status) status.textContent = ok ? 'Comando copiado al portapapeles' : 'No se pudo copiar automáticamente';
        setTimeout(function () { btn.textContent = old; }, 2000);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(str).then(function () { done(true); }, function () { done(fallbackCopy(str)); });
      } else {
        done(fallbackCopy(str));
      }
    });
  });
})();
