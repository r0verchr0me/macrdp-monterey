/* global angular, Guacamole */
(() => {
    'use strict';

    // Substitute the base64url ID from the Guacamole connection URL when packaging.
    const connectionId = '@MACRDP_CONNECTION_ID@';

    angular.module('client').run(['$window', '$location', 'guacClientManager',
        function ($window, $location, manager) {
            const document = $window.document;
            const sink = document.createElement('textarea');
            sink.setAttribute('aria-label', 'Paste text into macOS');
            sink.tabIndex = -1;
            sink.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
            document.body.appendChild(sink);
            let armed = null;
            let restoreFocus = null;
            let pasteTimer;

            function activeClient() {
                if ($location.path() !== '/client/' + connectionId)
                    return null;
                const client = manager.getManagedClients()[connectionId];
                return client?.clientProperties.focused &&
                    client.clientState.connectionState === 'CONNECTED' ? client : null;
            }

            function disarm() {
                armed = null;
                if (document.activeElement === sink)
                    (restoreFocus?.isConnected ? restoreFocus : document.body).focus();
                restoreFocus = null;
            }

            $window.addEventListener('keydown', event => {
                if (!event.isTrusted || !event.metaKey || event.ctrlKey || event.altKey ||
                    event.shiftKey || event.key.toLowerCase() !== 'v')
                    return;
                const client = activeClient();
                const target = event.target;
                // Guacamole deliberately focuses its zero-sized textarea to
                // receive keyboard input. Leave visible local fields alone.
                const isGuacSink = target.tagName === 'TEXTAREA' &&
                    target.style.position === 'fixed' && target.style.width === '0px' &&
                    target.style.height === '0px' && target.parentElement === document.body;
                if (!client || (!isGuacSink && target !== sink &&
                    target.closest?.('input,textarea,select,[contenteditable],.menu')))
                    return;

                // Leave the browser's default paste action enabled. A focused
                // textarea also gives WebKit an editable target for that action.
                event.stopImmediatePropagation();
                restoreFocus = document.activeElement;
                armed = client;
                sink.focus({ preventScroll: true });
            }, true);

            $window.addEventListener('keyup', event => {
                if (armed && event.key.toLowerCase() === 'v')
                    disarm();
            }, true);
            $window.addEventListener('blur', () => {
                disarm();
                $window.clearTimeout(pasteTimer);
            });

            sink.addEventListener('paste', event => {
                event.preventDefault();
                event.stopPropagation();
                const client = armed;
                disarm();
                const text = event.clipboardData?.getData('text/plain');
                if (!event.isTrusted || !text || !client || client !== activeClient())
                    return;

                $window.clearTimeout(pasteTimer);
                const stream = client.client.createClipboardStream('text/plain');
                const writer = new Guacamole.StringWriter(stream);
                writer.sendText(text);
                writer.sendEnd();

                // guacd still needs to transfer the data over CLIPRDR after
                // the web stream ends. Allow that exchange to complete before
                // sending the guest's Command+V shortcut on this LAN setup.
                pasteTimer = $window.setTimeout(() => {
                    if (client !== activeClient())
                        return;
                    const cmd = 0xFFEB; // Super_L, mapped to Command by macrdp
                    client.client.sendKeyEvent(1, cmd);
                    client.client.sendKeyEvent(1, 0x76);
                    client.client.sendKeyEvent(0, 0x76);
                    client.client.sendKeyEvent(0, cmd);
                }, 250);
            });
        }]);
})();
