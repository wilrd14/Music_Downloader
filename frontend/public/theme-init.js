// Se carga antes de React para evitar el destello de tema (archivo aparte para poder usar CSP sin 'unsafe-inline' en scripts).
(function () {
  var dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  try {
    var t = localStorage.getItem('tunedrop:theme');
    if (t === 'dark') dark = true;
    else if (t === 'light') dark = false;
  } catch (e) {}
  if (dark) document.documentElement.classList.add('dark');
})();
