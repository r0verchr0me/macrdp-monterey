/* global angular, Guacamole */
(() => {
    'use strict';

    // Set the connection IDs from the Guacamole URLs when packaging.
    const macConnectionId = '@MACRDP_CONNECTION_ID@';
    const windowsConnectionIds = new Set('@WINDOWS_CONNECTION_IDS@'.split(','));
    const command = 0xFFEB;
    const control = 0xFFE3;

    angular.module('client').run(['$window', '$location', 'guacClientManager',
        function ($window, $location, manager) {
            const document = $window.document;
            const sink = document.createElement('textarea');
            sink.setAttribute('aria-label', 'Paste text into remote desktop');
            sink.tabIndex = -1;
            sink.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
            document.body.appendChild(sink);
            let armed = null;
            let restoreFocus = null;
            let pendingWindowsMeta = null;
            let windowsPasteShortcut = false;
            let armTimer;
            let pasteTimer;

            function activeClient() {
                const route = $location.path().match(/^\/client\/([^/]+)$/);
                if (!route)
                    return null;
                const connectionId = route[1];
                if (connectionId !== macConnectionId && !windowsConnectionIds.has(connectionId))
                    return null;
                const client = manager.getManagedClients()[connectionId];
                return client?.clientProperties.focused &&
                    client.clientState.connectionState === 'CONNECTED' ? client : null;
            }

            function disarm() {
                $window.clearTimeout(armTimer);
                armed = null;
                if (document.activeElement === sink)
                    (restoreFocus?.isConnected ? restoreFocus : document.body)
                        .focus({ preventScroll: true });
                restoreFocus = null;
            }

            function isGuacSink(target) {
                return target.tagName === 'TEXTAREA' &&
                    target.style.position === 'fixed' && target.style.width === '0px' &&
                    target.style.height === '0px' && target.parentElement === document.body;
            }

            function isRemoteTarget(target) {
                return target === sink || isGuacSink(target) ||
                    !target.closest?.('input,textarea,select,[contenteditable],.menu');
            }

            function isPasteKey(event) {
                return event.code === 'KeyV' || event.key?.toLowerCase() === 'v';
            }

            $window.addEventListener('keydown', event => {
                if (!event.isTrusted)
                    return;
                const client = activeClient();
                const target = event.target;
                if (!client || !isRemoteTarget(target))
                    return;

                const isWindows = windowsConnectionIds.has(client.id);
                if (isWindows && event.key === 'Meta' && !event.ctrlKey && !event.altKey && !event.shiftKey) {
                    // Keep Command local until we know whether this is a paste.
                    // Guacamole infers the held modifier on other shortcuts.
                    if (!event.repeat && !windowsPasteShortcut)
                        pendingWindowsMeta = client;
                    event.stopImmediatePropagation();
                    return;
                }

                pendingWindowsMeta = null;
                if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || !isPasteKey(event)) {
                    windowsPasteShortcut = false;
                    return;
                }

                // Leave the browser's default paste action enabled. A focused
                // textarea also gives WebKit an editable target for that action.
                event.stopImmediatePropagation();
                windowsPasteShortcut = isWindows;
                if (document.activeElement !== sink)
                    restoreFocus = document.activeElement;
                armed = client;
                if (!isGuacSink(target))
                    sink.focus({ preventScroll: true });
                $window.clearTimeout(armTimer);
                armTimer = $window.setTimeout(disarm, 1000);
            }, true);

            $window.addEventListener('keypress', event => {
                if (event.isTrusted && windowsPasteShortcut && isPasteKey(event))
                    event.stopImmediatePropagation();
            }, true);

            $window.addEventListener('keyup', event => {
                if (!event.isTrusted)
                    return;
                if (windowsPasteShortcut && (isPasteKey(event) || event.key === 'Meta'))
                    event.stopImmediatePropagation();
                if (event.key !== 'Meta')
                    return;
                const client = pendingWindowsMeta;
                pendingWindowsMeta = null;
                windowsPasteShortcut = false;
                if (client && client === activeClient() && isRemoteTarget(event.target)) {
                    event.stopImmediatePropagation();
                    const logo = event.location === 2 ? 0xFFEC : command;
                    client.client.sendKeyEvent(1, logo);
                    client.client.sendKeyEvent(0, logo);
                }
            }, true);

            $window.addEventListener('blur', () => {
                pendingWindowsMeta = null;
                windowsPasteShortcut = false;
                disarm();
                $window.clearTimeout(pasteTimer);
            });

            $window.addEventListener('paste', event => {
                const client = activeClient();
                const target = event.target;
                const isArmedTarget = armed === client && (target === sink || target === document.body);
                if (!event.isTrusted || !client || (!isArmedTarget && !isGuacSink(target)))
                    return;

                event.preventDefault();
                event.stopImmediatePropagation();
                const text = event.clipboardData?.getData('text/plain');
                disarm();
                if (!text)
                    return;

                $window.clearTimeout(pasteTimer);
                const stream = client.client.createClipboardStream('text/plain');
                const writer = new Guacamole.StringWriter(stream);
                writer.sendText(text);
                writer.sendEnd();

                // guacd still needs to transfer the data over CLIPRDR after
                // the web stream ends. Allow that exchange to complete before
                // sending the guest's paste shortcut on this LAN setup.
                pasteTimer = $window.setTimeout(() => {
                    if (client !== activeClient())
                        return;
                    const modifier = windowsConnectionIds.has(client.id) ? control : command;
                    client.client.sendKeyEvent(1, modifier);
                    client.client.sendKeyEvent(1, 0x76);
                    client.client.sendKeyEvent(0, 0x76);
                    client.client.sendKeyEvent(0, modifier);
                }, 250);
            }, true);
        }]);
})();
