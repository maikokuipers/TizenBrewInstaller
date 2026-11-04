import { ArrowDownIcon, ArrowPathIcon, ComputerDesktopIcon, PlayIcon } from '@heroicons/react/16/solid';
import { useContext } from 'react';
import { GlobalStateContext } from '../components/ClientContext.jsx';
import Item from '../components/Item.jsx';
import SignInQrCode from '../assets/signInQrCode.png';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'preact-iso';
import { Events } from '../components/WebSocketClient.js';
import { useEffect } from 'preact/hooks';

const STREAMY_APP_ID = 'StreamyTV1.Streamy';
const STREAMY_URL = 'https://tv.streamytv.app/samsung/Streamy.wgt';
const TIZENTUBE_MODULE = 'npm/@foxreis/tizentube';

function isInstalled(appId) {
    try {
        tizen.application.getAppInfo(appId);
        return true;
    } catch (e) {
        return false;
    }
}

function Tile({ onClick, icon: Icon, title, description }) {
    return (
        <Item onClick={onClick}>
            <h3 className='text-indigo-400 text-base/7 font-semibold'>
                <span className='flex items-center gap-2'>
                    <Icon className='h-8 w-8 text-indigo-400' />
                    {title}
                </span>
            </h3>
            {description && <p className='mt-4 text-lg text-gray-300'>{description}</p>}
        </Item>
    );
}

export default function Home() {
    // Check if Tizen API is available
    const isTizenApiAvailable = typeof tizen !== 'undefined' && tizen.application && tizen.application.getAppInfo;
    const context = useContext(GlobalStateContext);
    const { t } = useTranslation();
    const loc = useLocation();

    if (!isTizenApiAvailable) loc.route('/ui/dist/index.html/desktop');

    // Check if TizenBrew is already installed.
    const isTizenBrewInstalled = isInstalled('xvvl3S1bvH.TizenBrewStandalone');
    const isStreamyInstalled = isInstalled(STREAMY_APP_ID);


    useEffect(() => {
        if (
            context.state.client !== null &&
            context.state.client.socket &&
            context.state.client.socket.readyState === WebSocket.OPEN
        ) {
            const appInfo = tizen.application.getAppInfo();
            if (appInfo.packageId === 'xvvl3S1bTU') {
                alert(t('installer.installingAgain'));
                context.state.client.send({
                    type: Events.InstallPackage,
                    payload: {
                        url: 'reisxd/TizenBrewInstaller'
                    }
                });
            }

            try {
                if (appInfo.packageId === 'xvvl3S1bTI') {
                    tizen.application.getAppInfo('xvvl3S1bTU.TizenBrewStandalone');
                    alert(t('installer.alreadyInstalled'));
                }
            } catch (e) { }
        }
    }, [context.state.client, context.state.client?.socket?.readyState]);

    return (
        <div className="relative isolate lg:px-8">
            {context.state.sharedData.qrCodeShow && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
                    <div className="p-8 rounded-2xl shadow-2xl max-w-full">
                        <h3 className="text-3xl font-bold mb-4">{t('resigning.resigningRequired')}</h3>
                        <p className="text-xl mb-4 whitespace-pre">{t('resigning.resigningRequiredDesc')}</p>
                        <img 
                            src={SignInQrCode} 
                            alt="Sign In QR Code" 
                            className="mt-2 w-80 h-80 max-w-full max-h-[60vw] object-contain mx-auto border-8 rounded-lg"
                        />
                        <p className="mt-4 text-lg">{t('resigning.resigningRequiredAccessInfo', { ip: webapis.network.getIp() })}</p>
                        <p className="mt-4 text-lg">{t('resigning.resigningDeviceSameNetwork')}</p>
                    </div>
                </div>
            )}
            <div className="mx-auto flex flex-wrap justify-center gap-4 top-4 relative">
                <Tile
                    icon={isStreamyInstalled ? ArrowPathIcon : ArrowDownIcon}
                    title={t(isStreamyInstalled ? 'apps.updateStreamy' : 'apps.installStreamy')}
                    description={t('apps.streamyDesc')}
                    onClick={() => {
                        context.state.client.send({
                            type: Events.InstallPackage,
                            payload: { url: STREAMY_URL }
                        });
                    }}
                />
                <Tile
                    icon={PlayIcon}
                    title={t('apps.tizenTube')}
                    description={t(isTizenBrewInstalled ? 'apps.tizenTubeDesc' : 'apps.tizenTubeDescInstall')}
                    onClick={() => {
                        context.state.client.send({
                            type: Events.EnableModule,
                            payload: TIZENTUBE_MODULE
                        });
                        if (!isTizenBrewInstalled) {
                            context.state.client.send({
                                type: Events.InstallPackage,
                                payload: { url: 'reisxd/TizenBrew' }
                            });
                        }
                    }}
                />
                <Item onClick={() => {
                    context.state.client.send({
                        type: Events.InstallPackage,
                        payload: {
                            url: 'reisxd/TizenBrew'
                        }
                    })
                }}>
                    <h3 className='text-indigo-400 text-base/7 font-semibold'>
                        {isTizenBrewInstalled ? (
                            <span className='flex items-center gap-2'>
                                <ArrowPathIcon className='h-8 w-8 text-indigo-400' />
                                {t('installer.updateTB')}
                            </span>
                        ) : (
                            <span className='flex items-center gap-2'>
                                <ArrowDownIcon className='h-8 w-8 text-indigo-400' />
                                {t('installer.installTB')}
                            </span>
                        )}
                    </h3>
                </Item>
                <Item onClick={() => {
                    loc.route('/ui/dist/index.html/receive');
                }}>
                    <h3 className='text-indigo-400 text-base/7 font-semibold'>
                        <span className='flex items-center gap-2'>
                            <ComputerDesktopIcon className='h-8 w-8 text-indigo-400' />
                            {t('installer.receiveFromComputer')}
                        </span>
                    </h3>
                </Item>
                <Item onClick={() => {
                    loc.route('/ui/dist/index.html/install-from-usb');
                }}>
                    <h3 className='text-indigo-400 text-base/7 font-semibold'>
                        <span className='flex items-center gap-2'>
                            <ArrowDownIcon className='h-8 w-8 text-indigo-400' />
                            {t('installer.installFromUSB')}
                        </span>
                    </h3>
                </Item>
                <Item onClick={() => {
                    loc.route('/ui/dist/index.html/install-from-gh');
                }}>
                    <h3 className='text-indigo-400 text-base/7 font-semibold'>
                        <span className='flex items-center gap-2'>
                            <ArrowDownIcon className='h-8 w-8 text-indigo-400' />
                            {t('installer.installFromGH')}
                        </span>
                    </h3>
                </Item>
            </div>
        </div>
    );
}
