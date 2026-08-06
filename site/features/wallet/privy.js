/* Privy React SDK → opens the official Privy modal on Connect.
   A plain Connect button is always rendered first so it can never disappear;
   the React root only replaces it once it has actually mounted. */
const slot = document.getElementById('userAuth');
const APP_ID = document.querySelector('meta[name="privy-app-id"]')?.content?.trim() || '';
const CLIENT_ID = document.querySelector('meta[name="privy-client-id"]')?.content?.trim() || '';

function fallbackConnect(msg){
  if (!slot) return;
  slot.innerHTML = '<button type="button" class="wallet-btn" id="connectFallback">Connect</button>';
  const b = slot.querySelector('#connectFallback');
  if (b) b.addEventListener('click', () => alert(msg || 'Wallet connect is unavailable right now. Serve this file over http (npx serve . -p 3456) and add the origin under Privy Dashboard → Allowed origins.'));
}

if (slot) fallbackConnect(); // visible + clickable immediately

(async function(){
  if (!slot) return;
  if (!APP_ID){ fallbackConnect('Add a Privy App ID to the <meta name="privy-app-id"> tag.'); return; }
  if (location.protocol === 'file:'){ fallbackConnect('Privy needs an http origin. Run: npx serve . -p 3456  then open the served URL.'); return; }
  const D = 'react@18.3.1,react-dom@18.3.1';
  const withTimeout = (p, ms, what) => Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error('Timed out loading ' + what)), ms))
  ]);
  try {
    const React = (await import('https://esm.sh/react@18.3.1')).default;
    const { createRoot } = await import('https://esm.sh/react-dom@18.3.1/client');
    /* ?bundle collapses Privy's dependency graph into one file so the loader
       can't stall on a hanging sub-request; 25s timeout fails loudly if it does. */
    const { PrivyProvider, usePrivy } = await withTimeout(
      import('https://esm.sh/@privy-io/react-auth@1?bundle&deps=' + D),
      25000, 'Privy'
    );
    let useSolWallets = null;
    let toSolanaWalletConnectors = null;
    try {
      const solMod = await import('https://esm.sh/@privy-io/react-auth@1/solana?bundle&deps=' + D);
      useSolWallets = solMod.useSolanaWallets || solMod.useWallets;
      toSolanaWalletConnectors = solMod.toSolanaWalletConnectors;
    } catch (e) { console.warn('Privy Solana module unavailable:', e); }
    const solanaConnectors = toSolanaWalletConnectors
      ? toSolanaWalletConnectors({ shouldAutoConnect: false })
      : undefined;
    const h = React.createElement;
    const { useEffect } = React;

    const CONNECT_OPTS = {
      walletList: ['phantom', 'solflare', 'backpack', 'detected_solana_wallets'],
      description: 'Connect your Solana wallet to trade on Insidor',
    };

    function walletLabel(user, addr){
      if (addr) return addr.slice(0, 4) + '…' + addr.slice(-4);
      if (!user) return 'Account';
      if (user.google && user.google.name) return user.google.name;
      if (user.email && user.email.address) return user.email.address.split('@')[0];
      if (user.wallet && user.wallet.address) return user.wallet.address.slice(0, 4) + '…' + user.wallet.address.slice(-4);
      const la = (user.linkedAccounts || [])[0];
      if (la && la.address) return la.address.slice(0, 4) + '…' + la.address.slice(-4);
      return 'Insidor user';
    }
    const OUT_ICON = { __html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>' };

    /* Error boundary so a Privy render failure never blanks the nav */
    class Boundary extends React.Component{
      constructor(p){ super(p); this.state = { err:false }; }
      static getDerivedStateFromError(){ return { err:true }; }
      componentDidCatch(e){ console.error('Privy render error:', e); }
      render(){
        if (this.state.err) return h('button', { type:'button', className:'wallet-btn', onClick: () => alert('Wallet connect hit an error. Check the console and that this origin is allowed in the Privy Dashboard.') }, 'Connect');
        return this.props.children;
      }
    }

    function WalletBridge(){
      const { ready, authenticated, user, logout } = usePrivy();
      const solHook = useSolWallets ? useSolWallets() : { wallets: [] };
      const solWallet = (solHook.wallets || [])[0] || null;
      const addr = solWallet?.address || user?.wallet?.address || null;
      const connected = !!(authenticated || addr);
      useEffect(() => {
        window.InsidorWallet = {
          ready,
          authenticated: connected,
          address: addr,
          logout,
          async sendVersionedTransaction(vtx, conn) {
            if (!solWallet) throw new Error('No Solana wallet connected — click Connect and choose Phantom');
            const { Connection } = await import('https://esm.sh/@solana/web3.js@1');
            const connection = conn || new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
            if (typeof solWallet.signAndSendTransaction === 'function') {
              const r = await solWallet.signAndSendTransaction({ transaction: vtx, connection });
              return r?.signature || r;
            }
            if (typeof solWallet.sendTransaction === 'function') return solWallet.sendTransaction(vtx, connection);
            if (typeof solWallet.signTransaction === 'function') {
              const signed = await solWallet.signTransaction(vtx);
              return connection.sendRawTransaction(signed.serialize(), { skipPreflight: true });
            }
            throw new Error('Wallet cannot send transactions');
          },
        };
        window.dispatchEvent(new Event('insidor-wallet'));
      }, [ready, authenticated, user, solWallet, addr, connected, logout]);
      return null;
    }

    function Auth(){
      const { ready, authenticated, user, logout, login, connectWallet } = usePrivy();
      const solHook = useSolWallets ? useSolWallets() : { wallets: [] };
      const solWallet = (solHook.wallets || [])[0] || null;
      const addr = solWallet?.address || null;
      const connected = !!(authenticated || addr);
      if (!connected) {
        return h('button', {
          type: 'button',
          className: 'wallet-btn',
          onClick: () => {
            if (!ready) return;
            if (authenticated) {
              if (!solanaConnectors) {
                alert('Solana wallet support failed to load. Try disabling ad blockers and refreshing.');
                return;
              }
              connectWallet(CONNECT_OPTS);
            } else {
              login();
            }
          },
          disabled: !ready,
        }, ready ? 'Connect' : 'Loading…');
      }
      return h('div', { className: 'user-chip' },
        h('span', { className: 'user-name' }, walletLabel(user, addr)),
        h('button', {
          type: 'button',
          className: 'icon-btn user-logout',
          'aria-label': 'Disconnect',
          onClick: async () => {
            try { if (solWallet?.disconnect) await solWallet.disconnect(); } catch (_) {}
            logout();
          },
          dangerouslySetInnerHTML: OUT_ICON,
        })
      );
    }
    function App(){
      const privyConfig = {
        appearance: {
          theme: 'dark',
          accentColor: '#3DE0FF',
          walletChainType: 'solana-only',
          showWalletLoginFirst: true,
          walletList: CONNECT_OPTS.walletList,
        },
        loginMethods: ['wallet', 'email'],
        embeddedWallets: { createOnLogin: 'users-without-wallets' },
      };
      if (solanaConnectors) {
        privyConfig.externalWallets = { solana: { connectors: solanaConnectors } };
      }
      return h(Boundary, null, h(PrivyProvider, {
        appId: APP_ID,
        clientId: CLIENT_ID || undefined,
        config: privyConfig,
      }, h(WalletBridge), h(Auth)));
    }
    createRoot(slot).render(h(App));
  } catch (e) {
    console.error('Privy React SDK failed to load:', e);
    fallbackConnect('Wallet SDK failed to load (network/origin). Check the console. Ensure this origin is allowed in the Privy Dashboard.');
  }
})();
