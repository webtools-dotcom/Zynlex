(function() {
    try {
        var scrollX = window.scrollX || document.documentElement.scrollLeft || 0;
        var scrollY = window.scrollY || document.documentElement.scrollTop || 0;
        var inputs = document.querySelectorAll('input, textarea, select');
        var formState = [];
        for (var i = 0; i < inputs.length; i++) {
            var el = inputs[i];
            // Never capture a password. Restore matches fields by index, so a page
            // that renders differently on reload would write the value into some
            // other field — and a discarded background tab is not worth that risk.
            if (el.type === 'password') continue;
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
        return JSON.stringify({ scrollX: scrollX, scrollY: scrollY, formState: formState });
    } catch (e) {
        return null;
    }
})()
