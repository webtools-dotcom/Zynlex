(function() {
    try {
        var scrollX = window.scrollX || document.documentElement.scrollLeft || 0;
        var scrollY = window.scrollY || document.documentElement.scrollTop || 0;
        var inputs = document.querySelectorAll('input, textarea, select');
        var formState = [];
        for (var i = 0; i < inputs.length; i++) {
            var el = inputs[i];
            var s = { i: i, tag: el.tagName, type: el.type || '', name: el.name || '' };
            if (el.type === 'checkbox' || el.type === 'radio') {
                s.checked = el.checked;
            } else if (el.tagName === 'SELECT') {
                s.selectedIndex = el.selectedIndex;
            } else {
                s.value = el.value;
            }
            if (el.isContentEditable) {
                s.html = el.innerHTML;
            }
            formState.push(s);
        }
        var stateJson = JSON.stringify({ scrollX: scrollX, scrollY: scrollY, formState: formState });
        if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {
            window.__TAURI_INTERNALS__.invoke('browser_tab_state_saved', {
                tabId: window.__XEVO_TAB_ID || '',
                stateJson: stateJson
            }).catch(function(){});
        }
    } catch(e) {}
})()
