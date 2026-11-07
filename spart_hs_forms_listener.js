// SPART HubSpot Forms Listener - v1.0
// Módulo 1: preenchimento do campo oculto "marketing_tracker_cookies"
// com o conteúdo do cookie spart_mkt_tracker.
//
// Cobre:
//  - Forms do editor novo (v4), inclusive dentro do iframe cross-origin do
//    HubSpot, via API oficial HubSpotFormsV4 (setFieldValue). Vale tanto para
//    embeds "hs-form-frame" quanto para hbspt.forms.create com form do editor novo.
//  - Forms do editor legado (v2), inline ou em iframe same-origin, via DOM.
(function () {
    'use strict';

    if (window.__spartHsFormsListener) return;
    window.__spartHsFormsListener = true;

    var CONFIG = {
        trackerCookie: 'spart_mkt_tracker',
        fieldSuffix: 'marketing_tracker_cookies',
        v4FieldName: '0-1/marketing_tracker_cookies',
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
        var api = window.spartMktTracker;
        if (api && typeof api.getEventId === 'function' && api.getEventId()) {
            data.event_id = api.getEventId();
        }
        return Object.keys(data).length ? JSON.stringify(data) : '';
    }

    // ---------------------------------------------------------------
    // v4 (editor novo): API oficial
    // ---------------------------------------------------------------
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

    // ---------------------------------------------------------------
    // v2 (editor legado): DOM, inline ou iframe same-origin
    // ---------------------------------------------------------------

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

    // ---------------------------------------------------------------
    // Orquestração
    // ---------------------------------------------------------------
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

    // Garante o valor mais recente imediatamente antes do envio (forms DOM)
    function hookSubmit(doc) {
        if (!doc || doc.__spartSubmitHooked) return;
        doc.__spartSubmitHooked = true;
        doc.addEventListener('submit', function () { fillAll('submit'); }, true);
    }
    hookSubmit(document);

    // v4: form pronto e navegação entre etapas (forms multi-step)
    window.addEventListener('hs-form-event:on-ready', function (e) {
        try {
            rememberV4(window.HubSpotFormsV4.getFormFromEvent(e));
        } catch (err) { /* ignora */ }
        fillAll('v4 on-ready');
    });
    window.addEventListener('hs-form-event:on-interaction:navigate', function () {
        fillAll('v4 navigate');
    });

    // v2: callbacks globais via postMessage
    window.addEventListener('message', function (e) {
        var d = e.data;
        if (!d || d.type !== 'hsFormCallback') return;
        if (d.eventName === 'onFormReady' || d.eventName === 'onBeforeFormSubmit') {
            fillAll('v2 ' + d.eventName);
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
    if (document.readyState !== 'complete') {
        window.addEventListener('load', function () { fillAll('window load'); });
    }

    // API pública para depuração
    window.spartHsForms = {
        version: '1.0',
        fill: function () { fillAll('manual'); },
        getTrackerValue: getTrackerValue
    };
})();
