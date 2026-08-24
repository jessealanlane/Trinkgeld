(function () {
  async function boot() {
    const source = document.getElementById('trinkgeld-main') || document.getElementById('notizen-main');
    if (!source || !window.cloud || !window.cloud.hydrateCurrentStore) return;

    const banner = document.createElement('div');
    banner.id = 'cloud-boot-banner';
    banner.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:99999;padding:10px 14px;background:#2c3e50;color:#fff;font:600 14px/1.4 system-ui,sans-serif;text-align:center;';
    banner.textContent = 'Lade Standort…';
    document.body.appendChild(banner);

    try {
      const result = await window.cloud.hydrateCurrentStore();
      banner.textContent = result.found
        ? ('Geladen: ' + (result.storeId || ''))
        : ('Keine Cloud-Daten für ' + (result.storeId || ''));
    } catch (e) {
      banner.textContent = e && e.message ? e.message : 'Cloud-Laden fehlgeschlagen.';
      banner.style.background = '#c0392b';
    }

    const code = source.textContent;
    const script = document.createElement('script');
    script.textContent = code;
    source.remove();
    document.body.appendChild(script);

    setTimeout(() => {
      if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    }, 1600);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();


  const banner = document.createElement('div');
  banner.id = 'cloud-boot-banner';
  banner.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:99999;padding:10px 14px;background:#2c3e50;color:#fff;font:600 14px/1.4 system-ui,sans-serif;text-align:center;';
  banner.textContent = 'Lade Standort…';
  document.body.appendChild(banner);

  try {
    const result = await window.cloud.hydrateCurrentStore();
    banner.textContent = result.found
      ? ('Geladen: ' + (result.storeId || ''))
      : ('Keine Cloud-Daten für ' + (result.storeId || ''));
  } catch (e) {
    banner.textContent = e && e.message ? e.message : 'Cloud-Laden fehlgeschlagen.';
    banner.style.background = '#c0392b';
  }

  const code = source.textContent;
  const script = document.createElement('script');
  script.textContent = code;
  source.remove();
  document.body.appendChild(script);

  setTimeout(() => {
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
  }, 1200);
})();
