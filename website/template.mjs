export const pages = {
  index: { title: 'Home', description: 'Own your music again. Share, find and keep music directly with other people — private transfers, verified files, no accounts.' },
  download: { title: 'Download', description: 'Download Deadwax for Windows, Linux, and macOS.' },
  mobile: { title: 'Mobile', description: 'Listen to your Deadwax library on another computer or phone.' },
  nostr: { title: 'Discovery', description: 'How Deadwax finds shared music without a central server.' },
  tor: { title: 'Privacy', description: 'How Deadwax keeps every transfer between people private.' }
};

export const siteOrigin = 'https://deadwax.rip';
export function pageUrl(slug, language) {
  return `${siteOrigin}/${language === 'en' ? '' : language + '/'}${slug === 'index' ? '' : slug + '.html'}`;
}
const socialLocales = { en: 'en_GB', zh: 'zh_CN', hi: 'hi_IN', es: 'es_ES', ar: 'ar_SA', fr: 'fr_FR', bn: 'bn_BD', pt: 'pt_BR', id: 'id_ID', ur: 'ur_PK' };

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

// One shared shell; content fragments contain only the unique body of each page.
export function template({ slug, language, languages, direction, content, t, catalog }) {
  const base = language === 'en' ? './' : '../';
  const canonical = pageUrl(slug, language);
  // The share images are still the forked artwork and keep their file names until
  // new ones are drawn; only the words around them changed.
  const socialImage = `${siteOrigin}/assets/${slug === 'mobile' ? 'companion' : 'desktop'}-share.png`;
  const nav = Object.entries(pages).map(([name, page]) => `<a href="${name}.html"${slug === name ? ' class="active" aria-current="page"' : ''}>${t(page.title)}</a>`).join('');
  const languageLinks = languages.map(({ code, name }) =>
    `<a href="${base}${code === 'en' ? '' : code + '/'}${slug}.html" lang="${code}" dir="${directionForLanguage(code)}"${code === language ? ' aria-current="page"' : ''}>${escapeHtml(name)}</a>`).join('\n            ');
  return `<!doctype html>
<html lang="${language}" dir="${direction}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${t(pages[slug].description)}">
  <meta name="color-scheme" content="dark">
  <meta name="theme-color" content="#05070a">
  <meta name="github-repository" content="StateAntigen/deadwax">
  <link rel="canonical" href="${canonical}">
  ${languages.map(({ code }) => `<link rel="alternate" hreflang="${code}" href="${pageUrl(slug, code)}">`).join('\n  ')}
  <link rel="alternate" hreflang="x-default" href="${pageUrl(slug, 'en')}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Deadwax">
  <meta property="og:title" content="Deadwax — ${t(pages[slug].title)}">
  <meta property="og:description" content="${t(pages[slug].description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:locale" content="${socialLocales[language]}">
  ${languages.filter(({ code }) => code !== language).map(({ code }) => `<meta property="og:locale:alternate" content="${socialLocales[code]}">`).join('\n  ')}
  <meta property="og:image" content="${socialImage}">
  <meta property="og:image:secure_url" content="${socialImage}">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="Deadwax">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Deadwax — ${t(pages[slug].title)}">
  <meta name="twitter:description" content="${t(pages[slug].description)}">
  <meta name="twitter:image" content="${socialImage}">
  <meta name="twitter:image:alt" content="Deadwax">
  <title>Deadwax — ${t(pages[slug].title)}</title>
  <link rel="icon" type="image/png" href="${base}assets/favicon.png">
  <link rel="stylesheet" href="${base}styles.css">
  <link rel="stylesheet" href="${base}i18n/styles.css">
  <script id="page-translations" type="application/json">${JSON.stringify(catalog).replace(/</g, '\\u003c')}</script>
  <script type="module" src="${base}site.js"></script>
</head>
<body data-page="${slug}" data-release-product="${slug === 'mobile' ? 'companion' : 'desktop'}">
  <a class="skip-link" href="#main">${t('Skip to content')}</a>
  <header class="site-header">
    <div class="header-inner">
      <a class="brand" href="index.html" aria-label="${t('Deadwax home')}">
        <img class="brand-mark" src="${base}assets/favicon.png" alt="" width="30" height="30">
        <span class="brand-word">deadwax</span>
      </a>
      <nav class="site-nav" aria-label="${t('Main navigation')}">${nav}</nav>
      <div class="header-tools">
        <p class="language-suggestion" data-language-suggestion hidden>${t('Language')}: <a data-suggested-language></a></p>
        <details class="language-links">
          <summary aria-label="${t('Language')}"><span aria-hidden="true">◍</span><span class="lang-label">${t('Language')}</span></summary>
          <div class="language-menu">
            ${languageLinks}
          </div>
        </details>
        <a class="button button-primary button-compact" href="download.html">${t('Download')}</a>
      </div>
    </div>
  </header>
  <main id="main" class="page-main">
    <div class="content-body">${content}</div>
  </main>
  <footer class="site-footer">
    <div class="footer-inner">
      <div class="footer-brand">
        <span class="brand-word">deadwax</span>
        <p class="footer-quote">${t('Owning something means you are free to share and pass it on.')}</p>
      </div>
      <nav class="footer-nav" aria-label="${t('Footer navigation')}">${nav}</nav>
      <div class="footer-links">
        <a href="https://github.com/StateAntigen/deadwax">${t('Source code')}</a>
        <a href="https://github.com/StateAntigen/deadwax/blob/main/LICENSE">${t('MIT License')}</a>
        <a href="https://github.com/StateAntigen/deadwax/releases">${t('Releases')}</a>
        <a href="nostr.html">${t('Nostr')}</a>
        <a href="tor.html">${t('Tor')}</a>
      </div>
    </div>
    <div class="footer-baseline">
      <span class="mono">DEADWAX.RIP</span>
      <span>${t('No tracker. No account. No master.')}</span>
      <span class="footer-badges"><span>${t('Community Build')}</span><span>${t('Privacy First')}</span></span>
    </div>
  </footer>
</body>
</html>`;
}

function directionForLanguage(code) { return code === 'ar' || code === 'ur' ? 'rtl' : 'ltr'; }
