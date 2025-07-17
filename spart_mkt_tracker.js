function spart_mkt_tracker(domain, measurementId, useJQuery = false) {

    function set_cookie(name, value, days, domain) {
        var expires = "";
        if (days) {
            var date = new Date();
            date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
            expires = "; expires=" + date.toUTCString();
        }
        document.cookie = name + "=" + (value || "") + expires + "; domain=." + domain + "; path=/";
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

    // Executa a leitura da URL e gravação de cookies imediatamente
    processUrlParameters();

    if (typeof window.gtag !== 'function') {
        window.dataLayer = window.dataLayer || [];
        window.gtag = function () { dataLayer.push(arguments); };
    
        var script = document.createElement('script');
        script.async = true;
        script.src = 'https://www.googletagmanager.com/gtag/js?id=' + measurementId;
        script.onload = function () {
            gtag('js', new Date());
            gtag('config', measurementId);
        };
        document.head.appendChild(script);
    }
    
    function fetchGtagFields(measurementId) {
        function gtag(command, measurementId, field, callback) {
            if (typeof window.gtag === 'function') {
                window.gtag(command, measurementId, field, callback);
            } else {
                console.error('gtag não está definido');
                callback(null);
            }
        }

        let fields = ['client_id', 'session_id', 'gclid'];
        const dataObj = {};

        return new Promise((resolve) => {
            function gtagGet() {
                gtag('get', measurementId, fields[0], val => {
                    dataObj[fields[0]] = val;
                    fields.shift();
                    if (fields.length) {
                        gtagGet();
                    } else {
                        resolve(dataObj);
                    }
                });
            }

            if (fields.length) {
                gtagGet();
            } else {
                resolve(dataObj);
            }
        });
    }

    function getCookie(name) {
        var value = "; " + document.cookie;
        var parts = value.split("; " + name + "=");
        if (parts.length === 2) return parts.pop().split(";").shift();
    }

    function getParameterByName(name) {
        name = name.replace(/[\[]/, "\\[").replace(/[\]]/, "\\]");
        var regex = new RegExp("[\\?&]" + name + "=([^&#]*)"),
            results = regex.exec(location.search);
        return results === null ? null : decodeURIComponent(results[1].replace(/\+/g, " "));
    }

    fetchGtagFields(measurementId).then(dataObj => {
        console.log('Dados obtidos:', dataObj);
        var client_id = dataObj.client_id;
        var session_id = dataObj.session_id;

        // Check if client_id and session_id are not null before proceeding
        if (client_id !== null && session_id !== null) {
            var cookies = {
                client_id: client_id,
                session_id: session_id,
                fbp: getCookie("_fbp"),
                fbc: getCookie("_fbc"),
                gclid: getCookie("_gcl_aw"),
                ttclid: getCookie("_ttclid"),
                hubspotutk: getCookie("hubspotutk"),
                ua: btoa(navigator.userAgent)
            };

            var cookiesJson = JSON.stringify(cookies);
            set_cookie("spart_mkt_tracker", cookiesJson, 365, domain);
        } else {
            console.log('Skipping spart_mkt_tracker cookie creation: client_id or session_id is null');
        }
    });

}
