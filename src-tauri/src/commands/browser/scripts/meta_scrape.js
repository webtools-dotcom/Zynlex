(function() {
  try {
    var metas = Array.from(document.querySelectorAll('meta')).map(function(m) {
      return {
        name: m.getAttribute('name') || m.getAttribute('property') || m.getAttribute('http-equiv') || '',
        content: m.getAttribute('content') || '',
        charset: m.getAttribute('charset'),
        httpEquiv: m.getAttribute('http-equiv')
      };
    });
    var canonical = (document.querySelector('link[rel="canonical"]') || {}).href || null;
    var ldJson = [];
    var ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < ldScripts.length; i++) {
      try {
        ldJson.push(JSON.parse(ldScripts[i].textContent));
      } catch(e) {
        // skip invalid JSON-LD
      }
    }
    return {
      metas: metas,
      title: document.title,
      canonical: canonical,
      url: location.href,
      ldJson: ldJson.length > 0 ? ldJson : undefined
    };
  } catch(e) {
    return { error: String(e), metas: [], title: '', canonical: null, url: location.href };
  }
})()
