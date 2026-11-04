import { useContext, useEffect } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { GlobalStateContext } from '../components/ClientContext.jsx';
import { Events } from '../components/WebSocketClient.js';

export default function ReceiveFromComputer() {
    const { state } = useContext(GlobalStateContext);
    const { t } = useTranslation();
    const pairing = state.sharedData.pairing;
    let ip = '';
    try {
        ip = webapis.network.getIp();
    } catch (e) { }

    useEffect(() => {
        if (state.client && state.client.socket && state.client.socket.readyState === WebSocket.OPEN) {
            state.client.send({ type: Events.GetPairingInfo });
        }
    }, [state.client, state.client?.socket?.readyState]);

    return (
        <div className="flex flex-col items-center px-8 pt-12 text-center">
            <h1 className="text-4xl font-bold text-indigo-400 mb-6">{t('receive.title')}</h1>
            <p className="text-2xl text-gray-300 mb-10 max-w-[70vw]">{t('receive.description')}</p>

            {pairing && !pairing.canInstall && (
                <p className="text-2xl text-red-400 mb-8 max-w-[70vw]">{t('errors.debuggingNotEnabled')}</p>
            )}

            <div className="bg-slate-900 rounded-3xl px-16 py-10 mb-10">
                <p className="text-xl text-gray-400 mb-2">{t('receive.tvAddress')}</p>
                <p className="text-5xl font-mono text-white mb-8">{ip || '...'}</p>
                <p className="text-xl text-gray-400 mb-2">{t('receive.pairingCode')}</p>
                <p className="text-7xl font-mono font-bold tracking-widest text-indigo-300">{pairing?.code || '......'}</p>
            </div>

            <p className="text-xl text-gray-400 mb-2">{t('receive.command')}</p>
            <p className="text-2xl font-mono text-gray-200 bg-slate-900 rounded-lg px-6 py-3">
                node send-to-tv.mjs {ip || '<ip>'} app.wgt
            </p>
        </div>
    );
}
