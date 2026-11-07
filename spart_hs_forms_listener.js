// SPART HubSpot Forms Listener - v1.2
//
// Módulo 1: preenchimento do campo oculto "marketing_tracker_cookies"
// com o conteúdo do cookie spart_mkt_tracker.
// Módulo 2: captura da conversão e push no dataLayer (evento hubspot_form_submit).
// Módulo 3: identificação do usuário para Meta e Google (dados com hash SHA-256
//           guardados no cookie spart_ud e aplicados nas próximas páginas).
//
// Cobre:
//  - Forms do editor novo (v4), inclusive dentro do iframe cross-origin do
//    HubSpot, via API oficial HubSpotFormsV4. Vale tanto para embeds
//    "hs-form-frame" quanto para hbspt.forms.create com form do editor novo.
//  - Forms do editor legado (v2), inline ou em iframe same-origin.
(function () {
    'use strict';

    if (window.__spartHsFormsListener) return;
    window.__spartHsFormsListener = true;

    var VERSION = '1.2';

    var CONFIG = {
        trackerCookie: 'spart_mkt_tracker',
        fieldSuffix: 'marketing_tracker_cookies',
        v4FieldName: '0-1/marketing_tracker_cookies',
        dataLayerEvent: 'hubspot_form_submit',
        phoneFields: ['phone', 'mobilephone', 'hs_whatsapp_phone_number', 'whatsapp', 'celular', 'telefone'],
        defaultCountryCode: '55',
        userCookie: 'spart_ud',
        userCookieDays: 90,
        debug: /[?&]spart_debug=1/.test(window.location.search)
    };

    var FIELD_SELECTOR = 'input[name$="' + CONFIG.fieldSuffix + '"]';

    function log() {
        if (!CONFIG.debug) return;
        var args = Array.prototype.slice.call(arguments);
        args.unshift('[SPART HS Forms]');
        console.log.apply(console, args);
    }

    function getCookie(name) {
        var value = '; ' + document.cookie;
        var parts = value.split('; ' + name + '=');
        if (parts.length === 2) return parts.pop().split(';').shift();
    }

    // Promise com limite de tempo (resolve null se estourar)
    function withTimeout(p, ms) {
        return Promise.race([
            Promise.resolve(p).catch(function () { return null; }),
            new Promise(function (r) { setTimeout(function () { r(null); }, ms); })
        ]);
    }

    function getPageEventId() {
        var api = window.spartMktTracker;
        if (api && typeof api.getEventId === 'function') return api.getEventId() || null;
        return null;
    }

    // =================================================================
    // MÓDULO 1: PREENCHIMENTO DO CAMPO OCULTO
    // =================================================================

    // Valor a gravar no campo: o JSON do cookie, com o event_id da página
    // (window.spartMktTracker) para não sofrer interferência de outras abas.
    function getTrackerValue() {
        var raw = getCookie(CONFIG.trackerCookie);
        var data = {};
        if (raw) {
            try {
                data = JSON.parse(raw) || {};
            } catch (e) {
                return raw; // formato inesperado: envia como está
            }
        }
        var eventId = getPageEventId();
        if (eventId) data.event_id = eventId;
        return Object.keys(data).length ? JSON.stringify(data) : '';
    }

    // ---------- v4 (editor novo): API oficial ----------
    var v4Forms = [];

    function rememberV4(form) {
        if (form && typeof form.setFieldValue === 'function' && v4Forms.indexOf(form) === -1) {
            v4Forms.push(form);
        }
    }

    function collectV4Forms() {
        var api = window.HubSpotFormsV4;
        if (!api || typeof api.getForms !== 'function') return;
        try {
            api.getForms().forEach(rememberV4);
        } catch (e) { /* ignora */ }
    }

    // setFieldValue em form sem o campo é ignorado silenciosamente pelo HubSpot
    function fillV4(value) {
        collectV4Forms();
        v4Forms.forEach(function (form) {
            try {
                form.setFieldValue(CONFIG.v4FieldName, value);
            } catch (e) {
                log('Erro no setFieldValue', e);
            }
        });
        return v4Forms.length;
    }

    // ---------- v2 (editor legado): DOM, inline ou iframe same-origin ----------

    // Define o valor de forma compatível com React (forms v2 são React)
    function setNativeValue(input, value) {
        if (input.value === value) return false;
        var proto = Object.getPrototypeOf(input);
        var desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && desc.set) {
            desc.set.call(input, value);
        } else {
            input.value = value;
        }
        input.setAttribute('value', value);
        var win = (input.ownerDocument && input.ownerDocument.defaultView) || window;
        ['input', 'change'].forEach(function (type) {
            try {
                input.dispatchEvent(new win.Event(type, { bubbles: true }));
            } catch (e) { /* ignora */ }
        });
        return true;
    }

    function getSameOriginDocs() {
        var docs = [document];
        var frames = document.querySelectorAll('iframe');
        for (var i = 0; i < frames.length; i++) {
            try {
                var d = frames[i].contentDocument;
                if (d && d.documentElement) {
                    docs.push(d);
                    hookSubmit(d);
                }
            } catch (e) { /* cross-origin: tratado pela API v4 */ }
        }
        return docs;
    }

    function fillDom(value) {
        var count = 0;
        getSameOriginDocs().forEach(function (doc) {
            var inputs;
            try {
                inputs = doc.querySelectorAll(FIELD_SELECTOR);
            } catch (e) {
                return;
            }
            for (var i = 0; i < inputs.length; i++) {
                setNativeValue(inputs[i], value);
                count++;
            }
        });
        return count;
    }

    function fillAll(reason) {
        var value = getTrackerValue();
        if (!value) {
            log('Cookie ainda indisponível (' + reason + ')');
            return;
        }
        var v4 = fillV4(value);
        var dom = fillDom(value);
        log('Preenchido (' + reason + '): v4 forms=' + v4 + ', inputs DOM=' + dom);
    }

    var fillTimer = null;
    function scheduleFill(reason) {
        clearTimeout(fillTimer);
        fillTimer = setTimeout(function () { fillAll(reason); }, 50);
    }

    // =================================================================
    // MÓDULO 2: CAPTURA DA CONVERSÃO
    // =================================================================

    // Normaliza valores para um mapa { nome_curto: valor }.
    // Aceita array [{name, value}] (v4 e v2 onFormSubmit) ou objeto (v2 submissionValues).
    // Nomes "0-1/email" viram "email". Só campos de contato (0-1 ou sem prefixo)
    // são considerados: "0-2/name" (nome da empresa) não pode virar nome da pessoa.
    function toMap(values) {
        var out = {};
        var list = [];
        if (Array.isArray(values)) {
            list = values;
        } else if (values && typeof values === 'object') {
            Object.keys(values).forEach(function (k) { list.push({ name: k, value: values[k] }); });
        }
        list.forEach(function (f) {
            if (!f || f.name === undefined) return;
            var full = String(f.name);
            var key = full.split('/').pop().toLowerCase();
            var isContact = full.indexOf('/') === -1 || full.indexOf('0-1/') === 0;
            if (!isContact) return;
            var v = f.value;
            if (Array.isArray(v)) v = v.join(';');
            out[key] = (v === null || v === undefined) ? '' : String(v);
        });
        return out;
    }

    function hasEmail(values) {
        var m = toMap(values);
        return !!(m.email && m.email.trim());
    }

    // Telefone em E.164 (padrão Brasil quando não há código do país)
    function normalizePhone(p) {
        if (!p) return '';
        var s = String(p).trim();
        var hasPlus = s.charAt(0) === '+';
        var d = s.replace(/\D/g, '');
        if (!d) return '';
        if (hasPlus) return '+' + d;
        d = d.replace(/^0+/, '');
        if (d.length >= 12 && d.indexOf(CONFIG.defaultCountryCode) === 0) return '+' + d;
        if (d.length === 10 || d.length === 11) return '+' + CONFIG.defaultCountryCode + d;
        return '+' + d;
    }

    function pickPhone(m) {
        for (var i = 0; i < CONFIG.phoneFields.length; i++) {
            var v = m[CONFIG.phoneFields[i]];
            if (v && String(v).trim()) return v;
        }
        return '';
    }

    function eventIdFromValues(m) {
        var raw = m[CONFIG.fieldSuffix];
        if (!raw) return null;
        try {
            var data = JSON.parse(raw);
            return (data && data.event_id) || null;
        } catch (e) {
            return null;
        }
    }

    // =================================================================
    // MÓDULO 3: IDENTIFICAÇÃO DO USUÁRIO (Meta + Google)
    // Os dados ficam no cookie spart_ud apenas com hash SHA-256.
    //  - Google: aplicado via gtag('set', 'user_data') na página atual e nas próximas.
    //  - Meta: o Pixel só aceita dados no init, então a tag base do Pixel no GTM
    //    deve ler o cookie spart_ud (variável JS personalizada) no init.
    // =================================================================

    function sha256(str) {
        if (!str || !window.crypto || !window.crypto.subtle || typeof TextEncoder === 'undefined') {
            return Promise.resolve(null);
        }
        return window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)).then(function (buf) {
            return Array.prototype.map.call(new Uint8Array(buf), function (b) {
                return ('0' + b.toString(16)).slice(-2);
            }).join('');
        }).catch(function () { return null; });
    }

    // Grava no domínio raiz (descobre automaticamente, ex.: .cliente.com.br),
    // para valer em todos os subdomínios.
    function setRootCookie(name, value, days) {
        var expires = '; expires=' + new Date(Date.now() + days * 864e5).toUTCString();
        var tail = '; path=/; SameSite=Lax';
        var parts = window.location.hostname.split('.');
        for (var i = parts.length - 2; i >= 0; i--) {
            var domain = parts.slice(i).join('.');
            document.cookie = name + '=' + value + expires + '; domain=.' + domain + tail;
            if (getCookie(name) === value) return;
        }
        document.cookie = name + '=' + value + expires + tail;
    }

    // Respeita o Consent Mode do Google quando existir (ad_user_data negado = não identifica)
    function hasAdsConsent() {
        try {
            var e = window.google_tag_data && window.google_tag_data.ics &&
                window.google_tag_data.ics.entries && window.google_tag_data.ics.entries.ad_user_data;
            if (!e) return true;
            if (e.update === false) return false;
            if (e.update === undefined && e.default === false) return false;
        } catch (x) { /* ignora */ }
        return true;
    }

    function readStoredUser() {
        var raw = getCookie(CONFIG.userCookie);
        if (!raw) return null;
        try {
            return JSON.parse(decodeURIComponent(raw));
        } catch (e) {
            return null;
        }
    }

    // em/fn/ln: mesmo hash para Meta e Google.
    // ph: Meta (só dígitos com DDI) | phg: Google (E.164 com +)
    function buildHashedUser(email, phoneE164, firstName, lastName) {
        var phDigits = phoneE164 ? phoneE164.replace(/\D/g, '') : '';
        return Promise.all([
            sha256(email),
            sha256(phDigits),
            sha256(phoneE164),
            sha256((firstName || '').trim().toLowerCase()),
            sha256((lastName || '').trim().toLowerCase())
        ]).then(function (h) {
            var u = {};
            if (h[0]) u.em = h[0];
            if (h[1]) u.ph = h[1];
            if (h[2]) u.phg = h[2];
            if (h[3]) u.fn = h[3];
            if (h[4]) u.ln = h[4];
            return u;
        });
    }

    function toGoogleUserData(u) {
        if (!u) return null;
        var ud = {};
        if (u.em) ud.sha256_email_address = u.em;
        if (u.phg) ud.sha256_phone_number = u.phg;
        var addr = {};
        if (u.fn) addr.sha256_first_name = u.fn;
        if (u.ln) addr.sha256_last_name = u.ln;
        if (Object.keys(addr).length) ud.address = addr;
        return Object.keys(ud).length ? ud : null;
    }

    function toMetaUserData(u) {
        if (!u) return null;
        var md = {};
        ['em', 'ph', 'fn', 'ln'].forEach(function (k) { if (u[k]) md[k] = u[k]; });
        return Object.keys(md).length ? md : null;
    }

    function applyGoogle(u) {
        if (!hasAdsConsent() || typeof window.gtag !== 'function') return;
        var ud = toGoogleUserData(u);
        if (!ud) return;
        window.gtag('set', 'user_data', ud);
        log('Google user_data aplicado');
    }

    function identifyUser(email, phoneE164, firstName, lastName) {
        if (!email && !phoneE164) return;
        if (!hasAdsConsent()) {
            log('Sem consentimento ad_user_data: identificação não aplicada');
            return;
        }
        buildHashedUser(email, phoneE164, firstName, lastName).then(function (u) {
            if (!u.em && !u.ph) return;
            // Mesmo email: mantém campos antigos que não vieram neste envio
            var stored = readStoredUser();
            if (stored && stored.em && stored.em === u.em) {
                Object.keys(stored).forEach(function (k) { if (!u[k]) u[k] = stored[k]; });
            }
            u.v = 1;
            u.ts = Date.now();
            setRootCookie(CONFIG.userCookie, encodeURIComponent(JSON.stringify(u)), CONFIG.userCookieDays);
            applyGoogle(u);
            log('Usuário identificado e salvo', u);
        });
    }

    var recentCaptures = {};

    function capture(info) {
        var m = toMap(info.values);

        var email = (m.email || '').trim().toLowerCase();
        var firstName = (m.firstname || '').trim();
        var lastName = (m.lastname || '').trim();
        if (!firstName && (m.name || m.nome)) {
            var parts = String(m.name || m.nome).trim().split(/\s+/);
            firstName = parts.shift() || '';
            if (!lastName) lastName = parts.join(' ');
        }

        // Deduplicação: o mesmo envio pode gerar mais de um sinal
        var key = info.conversionId || ((info.instanceId || info.formId) + '|' + email);
        var now = Date.now();
        if (recentCaptures[key] && now - recentCaptures[key] < 10000) {
            log('Envio duplicado ignorado', key);
            return;
        }
        recentCaptures[key] = now;

        // event_id: prioridade para o valor que foi de fato enviado ao HubSpot
        var eventId = eventIdFromValues(m) || getPageEventId();

        var payload = {
            event: CONFIG.dataLayerEvent,
            event_id: eventId,
            hs_form: {
                id: info.formId || null,
                instance_id: info.instanceId || null,
                conversion_id: info.conversionId || null,
                embed: info.embed,
                page_url: window.location.href,
                page_path: window.location.pathname
            },
            user_data: {
                email: email,
                phone_number: normalizePhone(pickPhone(m)),
                address: {
                    first_name: firstName,
                    last_name: lastName
                }
            }
        };

        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push(payload);
        log('dataLayer push', payload);

        // Identificação para próximas conversões neste navegador
        identifyUser(email, payload.user_data.phone_number, firstName, lastName);

        // Novo event_id para um eventual próximo envio na mesma página
        var api = window.spartMktTracker;
        if (api && typeof api.rotateEventId === 'function') {
            try { api.rotateEventId(); } catch (e) { /* ignora */ }
        }
    }

    // ---------- Snapshots (cópia dos valores antes do envio) ----------
    var v4Snapshots = {};  // instanceId -> values
    var v2Snapshots = {};  // formId -> values

    function snapshotV4() {
        collectV4Forms();
        v4Forms.forEach(function (form) {
            var id;
            try { id = form.getInstanceId(); } catch (e) { return; }
            withTimeout(form.getFormFieldValues(), 1000).then(function (vals) {
                if (vals && hasEmail(vals)) v4Snapshots[id] = vals;
            });
        });
    }

    // Enquanto o foco está dentro do iframe do HubSpot (usuário preenchendo),
    // tira uma cópia dos valores a cada segundo.
    var pollTimer = null;
    function isHsFrame(el) {
        return el && el.tagName === 'IFRAME' && /hsforms|hubspot/i.test(el.src || '');
    }
    function startPolling() {
        if (pollTimer) return;
        snapshotV4();
        pollTimer = setInterval(function () {
            if (!isHsFrame(document.activeElement)) {
                clearInterval(pollTimer);
                pollTimer = null;
                return;
            }
            snapshotV4();
        }, 1000);
    }
    window.addEventListener('blur', function () {
        setTimeout(function () {
            if (isHsFrame(document.activeElement)) startPolling();
        }, 0);
    });

    function snapshotDomForm(form) {
        if (!form || !form.elements) return;
        var id = form.getAttribute('data-form-id') ||
            String(form.id || '').replace(/^hsForm_/, '').replace(/_\d+$/, '');
        var arr = [];
        for (var i = 0; i < form.elements.length; i++) {
            var el = form.elements[i];
            if (!el.name || el.type === 'file' || el.type === 'password') continue;
            if ((el.type === 'checkbox' || el.type === 'radio') && !el.checked) continue;
            arr.push({ name: el.name, value: el.value });
        }
        if (!arr.length) return;
        v2Snapshots[id] = arr;
        v2Snapshots.__last = arr;
    }

    // ---------- Sinais de envio ----------

    // Logo antes do envio (forms no DOM): preenche o campo e copia os valores
    function hookSubmit(doc) {
        if (!doc || doc.__spartSubmitHooked) return;
        doc.__spartSubmitHooked = true;
        doc.addEventListener('submit', function (e) {
            fillAll('submit');
            snapshotDomForm(e.target);
        }, true);
    }
    hookSubmit(document);

    // v4: envio concluído com sucesso
    window.addEventListener('hs-form-event:on-submission:success', function (e) {
        var form = null;
        try { form = window.HubSpotFormsV4.getFormFromEvent(e); } catch (err) { /* ignora */ }
        var detail = e.detail || {};
        var formId = detail.formId || (form && form.getFormId && form.getFormId()) || null;
        var instanceId = detail.instanceId || (form && form.getInstanceId && form.getInstanceId()) || null;

        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }

        var valuesP = form ? withTimeout(form.getFormFieldValues(), 1500) : Promise.resolve(null);
        var convP = (form && form.getConversionId) ? withTimeout(form.getConversionId(), 1000) : Promise.resolve(null);

        Promise.all([valuesP, convP]).then(function (r) {
            var vals = r[0];
            if (!hasEmail(vals) && instanceId && v4Snapshots[instanceId]) {
                log('Usando cópia dos valores (form já limpo)');
                vals = v4Snapshots[instanceId];
            }
            capture({
                embed: 'v4',
                formId: formId,
                instanceId: instanceId,
                conversionId: r[1] || null,
                values: vals || []
            });
        });
    });

    // v4: form pronto e navegação entre etapas (forms multi-step)
    window.addEventListener('hs-form-event:on-ready', function (e) {
        try {
            rememberV4(window.HubSpotFormsV4.getFormFromEvent(e));
        } catch (err) { /* ignora */ }
        fillAll('v4 on-ready');
    });
    window.addEventListener('hs-form-event:on-interaction:navigate', function () {
        fillAll('v4 navigate');
        snapshotV4();
    });

    // v2: callbacks globais via postMessage
    function isTrustedOrigin(origin) {
        return origin === window.location.origin || /(^|\.)(hsforms|hubspot|hs-sites)\.(com|net)$/i.test(String(origin).replace(/^https?:\/\//, ''));
    }

    window.addEventListener('message', function (e) {
        var d = e.data;
        if (!d || d.type !== 'hsFormCallback') return;
        if (!isTrustedOrigin(e.origin)) return;

        if (d.eventName === 'onFormReady' || d.eventName === 'onBeforeFormSubmit') {
            fillAll('v2 ' + d.eventName);
        }
        // Versões antigas enviam os valores no onFormSubmit
        if (d.eventName === 'onFormSubmit' && Array.isArray(d.data) && d.data.length) {
            v2Snapshots[d.id] = d.data;
        }
        if (d.eventName === 'onFormSubmitted') {
            var data = d.data || {};
            var vals = data.submissionValues;
            if (!hasEmail(vals)) vals = v2Snapshots[d.id] || v2Snapshots.__last || vals;
            capture({
                embed: 'v2',
                formId: d.id,
                instanceId: null,
                conversionId: data.conversionId || null,
                values: vals || {}
            });
        }
    });

    // Cookie atualizado pelo spart_mkt_tracker (dados do gtag chegam depois,
    // ou event_id rotacionado após uma conversão)
    window.addEventListener('spart_mkt_tracker:updated', function () {
        scheduleFill('tracker atualizado');
    });

    // Forms renderizados depois (popups, lazy load, SPAs)
    if (typeof MutationObserver === 'function') {
        var observer = new MutationObserver(function (mutations) {
            for (var i = 0; i < mutations.length; i++) {
                var added = mutations[i].addedNodes;
                for (var j = 0; j < added.length; j++) {
                    var node = added[j];
                    if (node.nodeType !== 1) continue;
                    if (node.tagName === 'IFRAME') {
                        node.addEventListener('load', function () { scheduleFill('iframe load'); });
                        scheduleFill('iframe adicionado');
                        return;
                    }
                    if ((node.matches && node.matches(FIELD_SELECTOR)) ||
                        (node.querySelector && node.querySelector(FIELD_SELECTOR + ', iframe'))) {
                        scheduleFill('form adicionado');
                        return;
                    }
                }
            }
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    // Execução inicial (forms que já existiam antes deste script carregar)
    fillAll('inicial');

    // Usuário já identificado em visita anterior: aplica no Google
    applyGoogle(readStoredUser());
    if (document.readyState !== 'complete') {
        window.addEventListener('load', function () { fillAll('window load'); });
    }

    // API pública para depuração
    window.spartHsForms = {
        version: VERSION,
        fill: function () { fillAll('manual'); },
        getTrackerValue: getTrackerValue,
        getMetaUserData: function () { return toMetaUserData(readStoredUser()); },
        getGoogleUserData: function () { return toGoogleUserData(readStoredUser()); }
    };
})();
