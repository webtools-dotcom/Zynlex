(function(){
            var e=document.getElementById('__xevo_toast');
            if(e)e.remove();
            e=document.createElement('div');
            e.id='__xevo_toast';
            e.textContent='Screenshot saved';
            e.style.cssText='position:fixed;bottom:16px;right:16px;background:#1a1a2e;color:#e0e0e0;padding:10px 16px;border-radius:6px;z-index:999999;font-size:13px;font-family:monospace;box-shadow:0 4px 16px rgba(0,0,0,0.4);border:1px solid #2a2a4e;pointer-events:none;opacity:1;transition:opacity 0.2s ease';
            document.body.appendChild(e);
            setTimeout(function(){e.style.opacity='0';setTimeout(function(){if(e.parentNode)e.parentNode.removeChild(e)},200)},2500)
        })()
