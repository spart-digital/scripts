// SPART Mkt Tracker - v2.0
function spart_mkt_tracker(domain, measurementId, useJQuery = false) {

    var TRACKER_COOKIE = "spart_mkt_tracker";
    var GTAG_TIMEOUT_MS = 4000;   // tempo máximo esperando o gtag responder
    var FBC_DAYS = 90;            // validade padrão do _fbc (Meta)

    function set_cookie(name, value, days, domain) {
        var expires = "";
        if (days) {
            var date = new Date();
            date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
            expires = "; expires=" + date.toUTCString();
        }
        document.cookie = name + "=" + (value || "") + expires + "; domain=." + domain + "; path=/";
    }

    function getCookie(name) {
        var value = "; " + document.cookie;
        var parts = value.split("; " + name + "=");
        if (parts.length === 2) return parts.pop().split(";").shift();
    }

    function isFilled(v) {
        return v !== null && v !== undefined && v !== "";
    }

    // Função para ler parâmetros da URL e gravar cookies
    function processUrlParameters() {
        var urlParams = new URLSearchParams(window.location.search);
        var parametersToTrack = ['ttclid', 'msclkid'];

        parametersToTrack.forEach(function(param) {
            var value = urlParams.get(param);
            if (value) {
                // Grava o cookie com o valor da URL
                set_cookie('_' + param, value, 365, domain);
                console.log('Cookie gravado:', '_' + param, '=', value);
            }
        });
    }

    // =====================================================================
    // FBC A PARTIR DO FBCLID
    // Se o visitante chega com ?fbclid= e o Pixel ainda não criou o _fbc
    // (Pixel bloqueado, sem consentimento, carregado depois etc.), montamos
    // o valor no formato oficial: fb.{subdomainIndex}.{timestampMs}.{fbclid}
    // subdomainIndex = 1 porque o cookie é gravado no domínio raiz (.dominio)
    // =====================================================================
    function processFbclid() {
        var fbclid = new URLSearchParams(window.location.search).get('fbclid');
        if (!fbclid) return;

        var current = getCookie('_fbc');
        // Mesmo fbclid já registrado: mantém o timestamp original
        if (current && current.split('.').slice(3).join('.') === fbclid) return;

        var fbc = 'fb.1.' + Date.now() + '.' + fbclid;
        set_cookie('_fbc', fbc, FBC_DAYS, domain);
        console.log('Cookie gravado: _fbc =', fbc);
    }

    // Executa a leitura da URL e gravação de cookies imediatamente
    processUrlParameters();
    processFbclid();

    // =====================================================================
    // EVENT ID (deduplicação Pixel x CAPI)
    // Gerado de forma síncrona no carregamento, antes de qualquer chamada
    // assíncrona, para que o campo oculto do form já encontre o valor.
    // =====================================================================

    function generateEventId() {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return window.crypto.randomUUID();
        }
        if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
            var b = new Uint8Array(16);
            window.crypto.getRandomValues(b);
            b[6] = (b[6] & 0x0f) | 0x40; // UUID v4
            b[8] = (b[8] & 0x3f) | 0x80;
            var h = Array.prototype.map.call(b, function (x) {
                return ('0' + x.toString(16)).slice(-2);
            }).join('');
            return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
        }
        return 'ev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
    }

    function readTrackerCookie() {
        var raw = getCookie(TRACKER_COOKIE);
        if (!raw) return {};
        try {
            var parsed = JSON.parse(raw);
            return (parsed && typeof parsed === 'object') ? parsed : {};
        } catch (e) {
            return {};
        }
    }

    // Atualiza só o event_id, preservando os demais campos já gravados
    function writeEventIdToCookie(eventId) {
        var data = readTrackerCookie();
        data.event_id = eventId;
        set_cookie(TRACKER_COOKIE, JSON.stringify(data), 365, domain);
    }

    // API global usada pelo listener de formulários
    var state = window.spartMktTracker = window.spartMktTracker || {};

    // Se a tag disparar mais de uma vez na mesma página (ex.: History Change),
    // mantém o mesmo event_id da página.
    if (!state.eventId) {
        state.eventId = generateEventId();
    }
    writeEventIdToCookie(state.eventId);

    // Retorna o event_id atual da página (fonte confiável, não depende do cookie,
    // que é compartilhado entre abas)
    state.getEventId = function () {
        return state.eventId;
    };

    // Gera um novo event_id. Deve ser chamado pelo listener APÓS enviar o evento
    // de conversão, para que um segundo envio não reutilize o mesmo ID.
    state.rotateEventId = function () {
        state.eventId = generateEventId();
        writeEventIdToCookie(state.eventId);
        return state.eventId;
    };

    // =====================================================================
    // GTAG
    // =====================================================================

    if (typeof window.gtag !== 'function') {
        window.dataLayer = window.dataLayer || [];
        window.gtag = function () { dataLayer.push(arguments); };

        var script = document.createElement('script');
        script.async = true;
        script.src = 'https://www.googletagmanager.com/gtag/js?id=' + measurementId;
        script.onload = function () {
            gtag('js', new Date());
            // send_page_view: false -> este config serve só para permitir o
            // gtag('get'), sem gerar page_view duplicado no GA4
            gtag('config', measurementId, { send_page_view: false });
        };
        document.head.appendChild(script);
    }

    // Lê os campos via gtag('get') com limite de tempo.
    // Se o gtag não responder (bloqueado, consentimento negado, measurementId
    // não configurado), resolve com o que tiver sido obtido até o momento.
    function fetchGtagFields(measurementId) {
        var fields = ['client_id', 'session_id', 'gclid'];
        var dataObj = {};

        return new Promise(function (resolve) {
            var settled = false;

            function finish(reason) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                if (reason) console.log('spart_mkt_tracker: gtag', reason, '- usando fallback dos cookies');
                resolve(dataObj);
            }

            var timer = setTimeout(function () { finish('timeout'); }, GTAG_TIMEOUT_MS);

            if (typeof window.gtag !== 'function') {
                finish('indisponível');
                return;
            }

            var i = 0;
            function next() {
                if (settled) return;
                if (i >= fields.length) { finish(); return; }
                var field = fields[i++];
                try {
                    window.gtag('get', measurementId, field, function (val) {
                        if (settled) return;
                        dataObj[field] = val;
                        next();
                    });
                } catch (e) {
                    finish('erro');
                }
            }
            next();
        });
    }

    // Fallback: client_id a partir do cookie _ga (GA1.1.XXXXXXXXXX.YYYYYYYYYY)
    function clientIdFromCookie() {
        var ga = getCookie('_ga');
        if (!ga) return null;
        var parts = ga.split('.');
        return parts.length >= 4 ? parts.slice(-2).join('.') : null;
    }

    // Fallback: session_id a partir do cookie _ga_<ID>
    // Suporta os formatos GS1 (GS1.1.1794054424.3.1...) e GS2 (GS2.1.s1794054424$o3$g1...)
    function sessionIdFromCookie(measurementId) {
        if (!measurementId) return null;
        var raw = getCookie('_ga_' + String(measurementId).replace(/^G-/, ''));
        if (!raw) return null;

        if (raw.indexOf('GS2.') === 0) {
            var segs = raw.split('.').slice(2).join('.').split('$');
            for (var i = 0; i < segs.length; i++) {
                if (segs[i].charAt(0) === 's') return segs[i].slice(1);
            }
            return null;
        }
        var parts = raw.split('.');
        return parts.length >= 3 ? parts[2] : null;
    }

    function getParameterByName(name) {
        name = name.replace(/[\[]/, "\\[").replace(/[\]]/, "\\]");
        var regex = new RegExp("[\\?&]" + name + "=([^&#]*)"),
            results = regex.exec(location.search);
        return results === null ? null : decodeURIComponent(results[1].replace(/\+/g, " "));
    }

    fetchGtagFields(measurementId).then(function (dataObj) {
        console.log('Dados obtidos:', dataObj);

        var client_id = isFilled(dataObj.client_id) ? dataObj.client_id : clientIdFromCookie();
        var session_id = isFilled(dataObj.session_id) ? dataObj.session_id : sessionIdFromCookie(measurementId);

        var fresh = {
            client_id: client_id,
            session_id: session_id,
            fbp: getCookie("_fbp"),
            fbc: getCookie("_fbc"),
            gclid: getCookie("_gcl_aw"),
            ttclid: getCookie("_ttclid"),
            msclkid: getCookie("_msclkid"),
            ttp: getCookie("_ttp"),
            hubspotutk: getCookie("hubspotutk"),
            ua: btoa(navigator.userAgent),
            // Usa o valor atual da página (já pode ter sido rotacionado)
            event_id: state.getEventId()
        };

        // Mescla com o cookie existente: valores novos preenchidos substituem,
        // valores vazios não apagam o que já havia sido capturado antes.
        var merged = readTrackerCookie();
        Object.keys(fresh).forEach(function (k) {
            if (isFilled(fresh[k])) merged[k] = fresh[k];
        });

        if (!isFilled(merged.client_id) || !isFilled(merged.session_id)) {
            console.log('spart_mkt_tracker: client_id ou session_id indisponível, gravando os demais campos');
        }

        set_cookie(TRACKER_COOKIE, JSON.stringify(merged), 365, domain);
    });

}
