(() => {
  'use strict';
  const card = document.querySelector('.card');
  function fit() {
    card.style.setProperty('--scale', Math.min(window.innerWidth / 1920, window.innerHeight / 1080));
  }
  fit();
  if (new URLSearchParams(location.search).has('export')) document.documentElement.classList.add('exporting');
  window.addEventListener('resize', fit);
  const filename = decodeURIComponent(location.pathname.split('/').pop());
  const stem = filename.replace(/\.html$/i, '');
  const actions = document.createElement('div');
  actions.className = 'top-actions';
  const exports = document.createElement('nav');
  exports.className = 'export-actions';
  exports.setAttribute('aria-label', '导出当前卡片');
  let exportDataPromise;
  function loadExportData() {
    if (!exportDataPromise) {
      exportDataPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `exports/${stem}.data.js`;
        script.onload = () => window.cardExportData ? resolve(window.cardExportData) : reject(new Error('Export data missing'));
        script.onerror = () => { script.remove(); reject(new Error('Export data unavailable')); };
        document.head.append(script);
      }).catch(error => { exportDataPromise = undefined; throw error; });
    }
    return exportDataPromise;
  }
  for (const [format, label] of [['pdf', '导出 PDF'], ['png', '导出图片']]) {
    const link = document.createElement('a');
    link.className = 'export-button';
    link.href = `exports/${stem}.${format}`;
    link.download = `${stem}.${format}`;
    link.textContent = label;
    link.title = format === 'png' ? '下载当前卡片，PNG，1920×1080' : '下载当前卡片，单页横版 PDF';
    link.addEventListener('click', async event => {
      event.preventDefault();
      if (link.getAttribute('aria-busy') === 'true') return;
      link.setAttribute('aria-busy', 'true');
      link.textContent = '正在导出…';
      try {
        const data = await loadExportData();
        const binary = atob(data[format]);
        const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: format === 'pdf' ? 'application/pdf' : 'image/png' }));
        const download = document.createElement('a');
        download.href = url;
        download.download = `${stem}.${format}`;
        document.body.append(download);
        download.click();
        download.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } catch (_) {
        window.alert('导出资源未能加载。请保留完整的 exports 文件夹，再重试。');
      } finally {
        link.removeAttribute('aria-busy');
        link.textContent = label;
      }
    });
    exports.append(link);
  }
  const chapter = document.querySelector('.top .tag');
  chapter.before(actions);
  actions.append(exports, chapter);
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (_) { /* Browser-level fullscreen remains available. */ }
  }
  document.querySelector('[data-fullscreen]').addEventListener('click', toggleFullscreen);
  document.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
    let target;
    if (event.key === 'ArrowRight' || event.key === 'PageDown') target = document.querySelector('a[rel="next"]');
    if (event.key === 'ArrowLeft' || event.key === 'PageUp') target = document.querySelector('a[rel="prev"]');
    if (target) { event.preventDefault(); target.click(); }
    if (event.key.toLowerCase() === 'f') { event.preventDefault(); toggleFullscreen(); }
  });
})();
