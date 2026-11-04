import { useContext, useEffect, useRef, useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { CheckCircleIcon, CheckIcon, ExclamationTriangleIcon, ArrowPathIcon, TvIcon } from '@heroicons/react/24/outline';
import { GlobalStateContext } from '../components/ClientContext.jsx';
import { Events } from '../components/WebSocketClient.js';
import TBLogo from '../assets/tizenbrew.svg';

const INSTALLER_SOURCE = 'maikokuipers/TizenBrewInstaller';
const TIZENBREW_SOURCE = 'reisxd/TizenBrew';
const STREAMY_SOURCE = 'https://tv.streamytv.app/samsung/Streamy.wgt';

const STEPS = ['find', 'devmode', 'restart', 'install', 'reset'];

function getJson(url) {
    return fetch(url).then(res => res.json());
}

// Polls fn every interval ms while active is true.
function usePolling(active, interval, fn) {
    const saved = useRef(fn);
    saved.current = fn;
    useEffect(() => {
        if (!active) return;
        let stopped = false;
        let timer;
        const tick = () => {
            Promise.resolve(saved.current()).finally(() => {
                if (!stopped) timer = setTimeout(tick, interval);
            });
        };
        tick();
        return () => {
            stopped = true;
            clearTimeout(timer);
        };
    }, [active, interval]);
}

export default function Wizard() {
    const { state } = useContext(GlobalStateContext);
    const { t } = useTranslation();
    const client = state.client;

    const [step, setStep] = useState('find');
    const [tvs, setTvs] = useState(null);
    const [manualIp, setManualIp] = useState('');
    const [ip, setIp] = useState(null);
    const [status, setStatus] = useState(null);
    const [connectError, setConnectError] = useState(null);
    const [choices, setChoices] = useState({ tizenbrew: true, streamy: true });
    const [tasks, setTasks] = useState([]);
    const [installing, setInstalling] = useState(false);

    const tv = status?.tv;
    const computer = status?.computer;
    const newTv = tv?.year && tv.year >= 2023;

    function scan() {
        setTvs(null);
        getJson('/api/wizard/tvs').then(result => setTvs(result.tvs)).catch(() => setTvs([]));
    }

    useEffect(scan, []);
    useEffect(() => {
        document.body.style.background = '#020617';
    }, []);

    function chooseTv(address) {
        setIp(address);
        setStatus(null);
        setConnectError(null);
        setStep('devmode');
    }

    // Developer mode and restart: watch the TV until it accepts this computer.
    usePolling(step === 'devmode' || step === 'restart', 2500, () => {
        if (!ip || !client) return;
        return getJson(`/api/wizard/tv?ip=${ip}`).then(result => {
            setStatus(result);
            const ready = result.tv && result.tv.developerMode && result.tv.developerIP === result.computer;
            if (!ready) {
                if (step === 'restart') setStep('devmode');
                return;
            }
            if (step === 'devmode') setStep('restart');
            if (!result.sdbOpen) return;
            return client.request({ type: Events.ConnectToTV, payload: ip }, m => m.type === Events.ConnectToTV)
                .then(reply => {
                    if (reply.payload.success) {
                        setConnectError(null);
                        setStep('install');
                    } else {
                        setConnectError(reply.payload.error);
                    }
                });
        }).catch(() => { });
    });

    // Reset: wait until the Host PC IP is 127.0.0.1 again.
    usePolling(step === 'reset', 2500, () => {
        return getJson(`/api/wizard/tv?ip=${ip}`).then(result => {
            setStatus(result);
            if (result.tv && result.tv.developerIP === '127.0.0.1') setStep('done');
        }).catch(() => { });
    });

    // Installs one package. Waits for the Samsung sign-in on Tizen 7+ and tries again after it.
    function installOne(url) {
        const accept = m => m.type === Events.InstallPackage || m.type === Events.Error || m.type === Events.ConnectToTV;
        return client.request({ type: Events.InstallPackage, payload: { url } }, accept).then(reply => {
            if (reply.type === Events.Error) throw new Error(t(reply.payload));
            if (reply.type === Events.ConnectToTV) throw new Error(t('wizard.connectionLost'));
            if (reply.payload.response === 2) {
                return client.wait(m => m.type === Events.InstallPackage && m.payload.response === 1)
                    .then(() => installOne(url));
            }
            const result = String(reply.payload.result || '');
            const failed = result.split('\n').find(line => line.indexOf('install failed') !== -1);
            if (failed) throw new Error(failed.trim());
        });
    }

    function startInstall() {
        const list = [{ key: 'installer', url: INSTALLER_SOURCE }];
        if (choices.tizenbrew) list.push({ key: 'tizenbrew', url: TIZENBREW_SOURCE });
        if (choices.streamy) list.push({ key: 'streamy', url: STREAMY_SOURCE });
        let current = list.map(task => ({ ...task, status: 'pending', message: null }));
        setTasks(current);
        setInstalling(true);

        const update = (index, changes) => {
            current = current.map((task, i) => i === index ? { ...task, ...changes } : task);
            setTasks(current);
        };

        let chain = Promise.resolve();
        list.forEach((task, index) => {
            chain = chain.then(() => {
                update(index, { status: 'busy' });
                return installOne(task.url)
                    .then(() => update(index, { status: 'done' }))
                    .catch(err => update(index, { status: 'error', message: err.message }));
            });
        });
        chain.then(() => setInstalling(false));
    }

    const allDone = tasks.length > 0 && !installing;
    const installerOk = tasks.find(task => task.key === 'installer')?.status === 'done';

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center px-6 py-10">
            {state.sharedData.qrCodeShow && <SamsungSignIn t={t} />}

            <div className="flex items-center gap-4 mb-10">
                <img src={TBLogo} className="h-14 w-auto" />
                <span className="text-sm text-slate-400 border border-slate-700 rounded-full px-3 py-1">{t('wizard.setup')}</span>
            </div>

            <Stepper step={step} t={t} />

            <div className="w-full max-w-3xl bg-slate-900/80 ring-1 ring-white/10 rounded-3xl shadow-2xl p-10 mt-8">
                {step === 'find' && (
                    <section>
                        <h1 className="text-3xl font-bold mb-3">{t('wizard.findTitle')}</h1>
                        <p className="text-lg text-slate-400 mb-8">{t('wizard.findText')}</p>

                        {tvs === null && <Busy text={t('wizard.searching')} />}
                        {tvs && tvs.length === 0 && (
                            <Notice tone="warn" text={t('wizard.noneFound')} />
                        )}
                        <div className="flex flex-col space-y-3">
                            {tvs && tvs.map(found => (
                                <button
                                    key={found.ip}
                                    onClick={() => chooseTv(found.ip)}
                                    className="flex items-center gap-5 text-left bg-slate-800 hover:bg-slate-700 ring-1 ring-white/5 hover:ring-indigo-400 rounded-2xl px-6 py-5 transition"
                                >
                                    <TvIcon className="h-10 w-10 text-indigo-400 shrink-0" />
                                    <span className="flex-1">
                                        <span className="block text-xl font-semibold">{found.name}</span>
                                        <span className="block text-slate-400">
                                            {[found.frame ? 'The Frame' : null, found.modelName, found.year, found.ip].filter(Boolean).join(' · ')}
                                        </span>
                                    </span>
                                    {found.powerState !== 'on' && <span className="text-sm text-amber-400">{t('wizard.standby')}</span>}
                                </button>
                            ))}
                        </div>

                        <div className="flex items-center gap-3 mt-8">
                            <input
                                value={manualIp}
                                onInput={e => setManualIp(e.target.value.trim())}
                                onKeyDown={e => e.key === 'Enter' && manualIp && chooseTv(manualIp)}
                                placeholder={t('wizard.manualIp')}
                                className="flex-1 bg-slate-800 rounded-xl px-4 py-3 text-lg outline-none ring-1 ring-white/10 focus:ring-indigo-400"
                            />
                            <Button disabled={!manualIp} onClick={() => chooseTv(manualIp)}>{t('wizard.next')}</Button>
                            <Button variant="ghost" onClick={scan}><ArrowPathIcon className="h-5 w-5" /></Button>
                        </div>
                    </section>
                )}

                {step === 'devmode' && (
                    <section>
                        <TvHeader tv={tv} ip={ip} />
                        <h1 className="text-3xl font-bold mb-6">{t('wizard.devmodeTitle')}</h1>
                        <ol className="flex flex-col space-y-4 text-lg mb-8">
                            <Instruction n={1} text={t('wizard.devmode1')} />
                            <Instruction n={2} text={t('wizard.devmode2')} />
                            <Instruction n={3} text={t('wizard.devmode3')} />
                            <Instruction n={4}>
                                {t('wizard.devmode4')}
                                <span className="ml-3 font-mono text-2xl text-indigo-300 bg-slate-800 rounded-lg px-3 py-1">{computer || '...'}</span>
                            </Instruction>
                        </ol>
                        {tv === null && status && <Notice tone="warn" text={t('wizard.tvUnreachable')} />}
                        {tv && (
                            <div className="flex flex-col space-y-2">
                                <Check ok={tv.developerMode} text={t(tv.developerMode ? 'wizard.devmodeOn' : 'wizard.devmodeOff')} />
                                <Check
                                    ok={tv.developerIP === computer}
                                    text={tv.developerIP ? t('wizard.currentIp', { ip: tv.developerIP }) : t('wizard.noIp')}
                                />
                            </div>
                        )}
                        <Waiting text={t('wizard.watching')} />
                        <BackLink onClick={() => setStep('find')} t={t} />
                    </section>
                )}

                {step === 'restart' && (
                    <section>
                        <TvHeader tv={tv} ip={ip} />
                        <h1 className="text-3xl font-bold mb-4">{t('wizard.restartTitle')}</h1>
                        <p className="text-lg text-slate-300 mb-4">{t('wizard.restartText')}</p>
                        {tv?.frame && <Notice tone="info" text={t('wizard.frameHint')} />}
                        {connectError && <Notice tone="warn" text={t('wizard.notRestarted')} />}
                        <Waiting text={t('wizard.waitingForTv')} />
                        <BackLink onClick={() => setStep('devmode')} t={t} />
                    </section>
                )}

                {step === 'install' && (
                    <section>
                        <TvHeader tv={tv} ip={ip} connected />
                        <h1 className="text-3xl font-bold mb-3">{t('wizard.installTitle')}</h1>
                        <p className="text-lg text-slate-400 mb-6">{t('wizard.installText')}</p>

                        {tasks.length === 0 ? (
                            <>
                                <div className="flex flex-col space-y-3 mb-8">
                                    <Choice checked disabled title={t('wizard.appInstaller')} text={t('wizard.appInstallerText')} />
                                    <Choice
                                        checked={choices.tizenbrew}
                                        onChange={v => setChoices({ ...choices, tizenbrew: v })}
                                        title={t('wizard.appTizenBrew')}
                                        text={t('wizard.appTizenBrewText')}
                                    />
                                    <Choice
                                        checked={choices.streamy}
                                        onChange={v => setChoices({ ...choices, streamy: v })}
                                        title={t('wizard.appStreamy')}
                                        text={t('wizard.appStreamyText')}
                                    />
                                </div>
                                {newTv && <Notice tone="info" text={t('wizard.samsungAccountHint')} />}
                                <Button onClick={startInstall}>{t('wizard.installButton')}</Button>
                            </>
                        ) : (
                            <>
                                <div className="flex flex-col space-y-3 mb-8">
                                    {tasks.map(task => (
                                        <TaskRow key={task.key} task={task} title={t(`wizard.app${{ installer: 'Installer', tizenbrew: 'TizenBrew', streamy: 'Streamy' }[task.key]}`)} t={t} />
                                    ))}
                                </div>
                                {allDone && (installerOk
                                    ? <Button onClick={() => setStep('reset')}>{t('wizard.next')}</Button>
                                    : <Button onClick={startInstall}>{t('wizard.retry')}</Button>)}
                            </>
                        )}
                    </section>
                )}

                {step === 'reset' && (
                    <section>
                        <TvHeader tv={tv} ip={ip} />
                        <h1 className="text-3xl font-bold mb-6">{t('wizard.resetTitle')}</h1>
                        <ol className="flex flex-col space-y-4 text-lg mb-8">
                            <Instruction n={1} text={t('wizard.devmode1')} />
                            <Instruction n={2}>
                                {t('wizard.reset2')}
                                <span className="ml-3 font-mono text-2xl text-indigo-300 bg-slate-800 rounded-lg px-3 py-1">127.0.0.1</span>
                            </Instruction>
                            <Instruction n={3} text={t('wizard.reset3')} />
                        </ol>
                        <p className="text-slate-400 mb-4">{t('wizard.resetWhy')}</p>
                        {tv && tv.developerIP && <Check ok={tv.developerIP === '127.0.0.1'} text={t('wizard.currentIp', { ip: tv.developerIP })} />}
                        <Waiting text={t('wizard.watching')} />
                    </section>
                )}

                {step === 'done' && (
                    <section className="text-center">
                        <CheckCircleIcon className="h-20 w-20 text-emerald-400 mx-auto mb-4" />
                        <h1 className="text-3xl font-bold mb-3">{t('wizard.doneTitle')}</h1>
                        <p className="text-lg text-slate-300 mb-2">{t('wizard.doneText')}</p>
                        <p className="text-slate-400">{t('wizard.doneRestart')}</p>
                    </section>
                )}
            </div>
        </div>
    );
}

function Stepper({ step, t }) {
    const current = step === 'done' ? STEPS.length : STEPS.indexOf(step);
    return (
        <ol className="flex items-center gap-2 text-sm">
            {STEPS.map((key, index) => (
                <li key={key} className="flex items-center gap-2">
                    <span className={`flex items-center justify-center h-8 w-8 rounded-full font-semibold ${index < current ? 'bg-emerald-500 text-slate-950' : index === current ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-500'}`}>
                        {index < current ? <CheckIcon className="h-4 w-4" /> : index + 1}
                    </span>
                    <span className={index === current ? 'text-slate-100' : 'text-slate-500'}>{t(`wizard.step_${key}`)}</span>
                    {index < STEPS.length - 1 && <span className="w-8 h-px bg-slate-700 mx-1" />}
                </li>
            ))}
        </ol>
    );
}

function TvHeader({ tv, ip, connected }) {
    return (
        <div className="flex items-center gap-3 text-slate-400 mb-6">
            <TvIcon className="h-6 w-6" />
            <span>{tv ? `${tv.name} · ${ip}` : ip}</span>
            {connected && <span className="h-2 w-2 rounded-full bg-emerald-400" />}
        </div>
    );
}

function Instruction({ n, text, children }) {
    return (
        <li className="flex items-start gap-4">
            <span className="flex items-center justify-center h-8 w-8 shrink-0 rounded-full bg-slate-800 text-indigo-300 font-semibold">{n}</span>
            <span className="pt-0.5">{text}{children}</span>
        </li>
    );
}

function Check({ ok, text }) {
    return (
        <div className={`flex items-center gap-3 ${ok ? 'text-emerald-400' : 'text-amber-400'}`}>
            {ok ? <CheckCircleIcon className="h-6 w-6" /> : <ExclamationTriangleIcon className="h-6 w-6" />}
            <span>{text}</span>
        </div>
    );
}

function Notice({ tone, text }) {
    const colors = tone === 'warn' ? 'bg-amber-500/10 text-amber-300 ring-amber-500/30' : 'bg-indigo-500/10 text-indigo-200 ring-indigo-500/30';
    return <p className={`rounded-xl ring-1 px-5 py-4 mb-6 ${colors}`}>{text}</p>;
}

function Spinner() {
    return <span className="inline-block h-5 w-5 rounded-full border-2 border-slate-600 border-t-indigo-400 animate-spin" />;
}

function Busy({ text }) {
    return <div className="flex items-center gap-3 text-slate-400 mb-6"><Spinner />{text}</div>;
}

function Waiting({ text }) {
    return <div className="flex items-center gap-3 text-slate-500 mt-8"><Spinner />{text}</div>;
}

function BackLink({ onClick, t }) {
    return <button onClick={onClick} className="mt-6 text-slate-500 hover:text-slate-300">← {t('wizard.back')}</button>;
}

function Button({ children, onClick, disabled, variant }) {
    const style = variant === 'ghost'
        ? 'bg-slate-800 hover:bg-slate-700 text-slate-200'
        : 'bg-indigo-500 hover:bg-indigo-400 text-white';
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-lg font-semibold transition disabled:opacity-40 ${style}`}
        >
            {children}
        </button>
    );
}

function Choice({ checked, disabled, onChange, title, text }) {
    return (
        <label className={`flex items-start gap-4 bg-slate-800 rounded-2xl px-6 py-5 ring-1 ${checked ? 'ring-indigo-400/60' : 'ring-white/5'} ${disabled ? '' : 'cursor-pointer hover:bg-slate-700'}`}>
            <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={e => onChange && onChange(e.target.checked)}
                className="mt-1.5 h-5 w-5 accent-indigo-500"
            />
            <span>
                <span className="block text-xl font-semibold">{title}</span>
                <span className="block text-slate-400">{text}</span>
            </span>
        </label>
    );
}

function TaskRow({ task, title, t }) {
    return (
        <div className="flex items-start gap-4 bg-slate-800 rounded-2xl px-6 py-4">
            <span className="pt-1">
                {task.status === 'busy' && <Spinner />}
                {task.status === 'done' && <CheckCircleIcon className="h-6 w-6 text-emerald-400" />}
                {task.status === 'error' && <ExclamationTriangleIcon className="h-6 w-6 text-red-400" />}
                {task.status === 'pending' && <span className="inline-block h-5 w-5 rounded-full border-2 border-slate-600" />}
            </span>
            <span className="flex-1">
                <span className="block text-lg font-semibold">{title}</span>
                <span className={`block ${task.status === 'error' ? 'text-red-300' : 'text-slate-400'}`}>
                    {task.message || t(`wizard.task_${task.status}`)}
                </span>
            </span>
        </div>
    );
}

function SamsungSignIn({ t }) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-6">
            <div className="bg-slate-900 ring-1 ring-white/10 p-10 rounded-3xl shadow-2xl max-w-xl">
                <h3 className="text-2xl font-bold mb-4">{t('resigning.resigningRequired')}</h3>
                <p className="text-lg text-slate-300 mb-6 whitespace-pre-line">{t('resigning.resigningRequiredPCDesc')}</p>
                <Button onClick={() => {
                    window.open('https://account.samsung.com/mobile/account/check.do?serviceID=v285zxnl3h&actionID=StartOAuth2&accessToken=Y&redirect_uri=http://localhost:4794/signin/callback', '_blank');
                }}>
                    {t('resigning.resigningRequiredOpenAuthButton')}
                </Button>
            </div>
        </div>
    );
}
